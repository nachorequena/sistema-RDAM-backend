import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from '../common/email.service';
import { StorageService } from '../common/storage.service';
import { PdfService } from '../common/pdf.service';
import { Prisma, SolEstado } from '@prisma/client';
import * as crypto from 'crypto';
import { ListarSolicitudesInternoDto, RechazarDto, PublicarDto } from './dto/gestion.dto';

@Injectable()
export class GestionService {
  private readonly logger = new Logger(GestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
  ) {}

  // ── Listar solicitudes para el panel ────────────────────────────────────

  async listar(dto: ListarSolicitudesInternoDto) {
    const { estado, tipoCertId, cuil, fechaDesde, fechaHasta, page = 1, limit = 20 } = dto;
    const skip = (page - 1) * limit;

    const where: Prisma.SolicitudWhereInput = {};
    if (estado)      where.solEstado  = estado as SolEstado;
    if (tipoCertId)  where.tipoCertId = tipoCertId;
    if (cuil)        where.cuil       = { contains: cuil };
    if (fechaDesde || fechaHasta) {
      where.createdAt = {
        ...(fechaDesde ? { gte: new Date(fechaDesde) } : {}),
        ...(fechaHasta ? { lte: new Date(fechaHasta) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.solicitud.findMany({
        where,
        include: {
          tipoCert: { select: { descripcion: true, precio: true } },
          operador: { select: { id: true, nombre: true } },
          _count:   { select: { adjuntos: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.solicitud.count({ where }),
    ]);

    return { data, total, page, perPage: limit };
  }

  // ── Detalle completo para el panel ──────────────────────────────────────

  async detalle(id: number) {
    const solicitud = await this.prisma.solicitud.findUnique({
      where: { id },
      include: {
        tipoCert: true,
        operador: { select: { id: true, nombre: true, email: true } },
        adjuntos: true,
        historial: {
          orderBy: { createdAt: 'asc' },
          include: { operador: { select: { nombre: true } } },
        },
        pagos: {
          orderBy: { procesadoAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');

    // Generar URLs presignadas para los adjuntos (válidas 15 min)
    const adjuntosConUrl = await Promise.all(
      solicitud.adjuntos.map(async (a) => ({
        ...a,
        urlDescarga: await this.storage.getPresignedUrl(a.rutaStorage, 'adjuntos'),
      })),
    );

    return { ...solicitud, adjuntos: adjuntosConUrl };
  }

  // ── Tomar solicitud para revisión ────────────────────────────────────────

  async tomar(id: number, operadorId: number) {
    const solicitud = await this.getSolicitudOFail(id);

    if (solicitud.solEstado !== 'pagado') {
      throw new BadRequestException({
        code:    'ESTADO_INVALIDO',
        message: `Solo se pueden tomar solicitudes en estado "pagado". Estado actual: "${solicitud.solEstado}"`,
      });
    }

    if (solicitud.operadorId !== null) {
      throw new BadRequestException({
        code:    'YA_TOMADA',
        message: `La solicitud ya fue tomada por otro operador`,
      });
    }

    const actualizada = await this.prisma.solicitud.update({
      where: { id },
      data:  { solEstado: 'en_revision', operadorId },
      include: { tipoCert: true },
    });

    this.logger.log(`Solicitud ${solicitud.nroTramite} tomada por operador ${operadorId}`);
    return actualizada;
  }

  // ── Rechazar solicitud ────────────────────────────────────────────────────

  async rechazar(id: number, dto: RechazarDto, operadorId: number) {
    const solicitud = await this.getSolicitudOFail(id);

    if (!['pagado', 'en_revision'].includes(solicitud.solEstado)) {
      throw new BadRequestException({
        code:    'ESTADO_INVALIDO',
        message: `No se puede rechazar una solicitud en estado "${solicitud.solEstado}"`,
      });
    }

    if (dto.observacion.trim().length < 20) {
      throw new BadRequestException({
        code:    'OBSERVACION_CORTA',
        message: 'La observación de rechazo debe tener al menos 20 caracteres',
      });
    }

    const actualizada = await this.prisma.solicitud.update({
      where: { id },
      data:  {
        solEstado:           'rechazado',
        observacionRechazo:  dto.observacion.trim(),
        operadorId,
      },
    });

    this.email
      .sendSolicitudRechazada(
        solicitud.email,
        solicitud.nombreCompleto,
        solicitud.nroTramite,
        dto.observacion.trim(),
      )
      .catch((e) => this.logger.error('Email rechazo:', e.message));

    this.logger.log(`Solicitud ${solicitud.nroTramite} rechazada por operador ${operadorId}`);
    return actualizada;
  }

  // ── Publicar certificado ──────────────────────────────────────────────────

  async publicar(id: number, _dto: PublicarDto, operadorId: number) {
    const solicitud = await this.getSolicitudOFail(id);

    if (solicitud.solEstado !== 'en_revision') {
      throw new BadRequestException({
        code:    'ESTADO_INVALIDO',
        message: `Solo se pueden publicar solicitudes en estado "en_revision". Estado actual: "${solicitud.solEstado}"`,
      });
    }

    // ── 1. Calcular fechas de vencimiento ───────────────────────────────────
    const isPrd          = this.config.get('NODE_ENV') === 'production';
    const diasPdf        = isPrd
      ? solicitud.tipoCert.diasPdfPrd
      : solicitud.tipoCert.diasPdfDev;

    const fecEmision     = new Date();
    const fecVencimiento = new Date(fecEmision);
    fecVencimiento.setDate(fecVencimiento.getDate() + diasPdf);

    // ── 2. Generar token PDF criptográficamente seguro (64 chars hex = 32 bytes) ─
    const tokenPdf = crypto.randomBytes(32).toString('hex');

    // ── 3. Generar PDF con Puppeteer ────────────────────────────────────────
    this.logger.debug(`Generando PDF para ${solicitud.nroTramite}...`);
    const pdfBuffer = await this.pdf.generarCertificado({
      nroTramite:      solicitud.nroTramite,
      nombreCompleto:  solicitud.nombreCompleto,
      cuil:            solicitud.cuil,
      tipoCertificado: solicitud.tipoCert.descripcion,
      fecEmision,
      fecVencimiento,
      tokenPdf,
    });

    // ── 4. Subir PDF a storage ────────────────────────────────────────────
    const rutaPdf = await this.storage.uploadPdf(pdfBuffer, solicitud.nroTramite);

    // ── 5. Actualizar solicitud en BD ─────────────────────────────────────
    const actualizada = await this.prisma.solicitud.update({
      where: { id },
      data:  {
        solEstado:      'publicado',
        tokenPdf,
        rutaPdf,
        fecEmision,
        fecVencimiento,
        operadorId,
      },
    });

    // ── 6. Notificar al ciudadano ─────────────────────────────────────────
    this.email
      .sendCertificadoPublicado(
        solicitud.email,
        solicitud.nombreCompleto,
        solicitud.nroTramite,
        tokenPdf,
        fecVencimiento,
      )
      .catch((e) => this.logger.error('Email certificado publicado:', e.message));

    this.logger.log(`Solicitud ${solicitud.nroTramite} publicada por operador ${operadorId}`);
    return actualizada;
  }

  // ── Regenerar token PDF ────────────────────────────────────────────────

  async regenerarToken(id: number, operadorId: number) {
    const solicitud = await this.getSolicitudOFail(id);

    if (solicitud.solEstado !== 'publicado_vencido') {
      throw new BadRequestException({
        code:    'ESTADO_INVALIDO',
        message: 'Solo se puede regenerar el token de un certificado en estado "publicado_vencido"',
      });
    }

    const isPrd          = this.config.get('NODE_ENV') === 'production';
    const diasPdf        = isPrd
      ? solicitud.tipoCert.diasPdfPrd
      : solicitud.tipoCert.diasPdfDev;

    const nuevoToken     = crypto.randomBytes(32).toString('hex');
    const nuevaFecVenc   = new Date();
    nuevaFecVenc.setDate(nuevaFecVenc.getDate() + diasPdf);

    // Re-generar el PDF con el nuevo token y nueva fecha de vencimiento
    const pdfBuffer = await this.pdf.generarCertificado({
      nroTramite:      solicitud.nroTramite,
      nombreCompleto:  solicitud.nombreCompleto,
      cuil:            solicitud.cuil,
      tipoCertificado: solicitud.tipoCert.descripcion,
      fecEmision:      solicitud.fecEmision ?? new Date(),
      fecVencimiento:  nuevaFecVenc,
      tokenPdf:        nuevoToken,
    });

    const rutaPdf = await this.storage.uploadPdf(pdfBuffer, solicitud.nroTramite);

    const actualizada = await this.prisma.solicitud.update({
      where: { id },
      data:  {
        solEstado:     'publicado',
        tokenPdf:      nuevoToken,
        rutaPdf,
        fecVencimiento: nuevaFecVenc,
        operadorId,
      },
    });

    this.email
      .sendCertificadoPublicado(
        solicitud.email,
        solicitud.nombreCompleto,
        solicitud.nroTramite,
        nuevoToken,
        nuevaFecVenc,
      )
      .catch((e) => this.logger.error('Email token regenerado:', e.message));

    this.logger.log(`Token regenerado para ${solicitud.nroTramite} por operador ${operadorId}`);
    return actualizada;
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async getDashboard() {
    const [metricas, ultimasSolicitudes] = await Promise.all([
      this.prisma.solicitud.groupBy({
        by:    ['solEstado'],
        _count: { id: true },
      }),
      this.prisma.solicitud.findMany({
        orderBy: { createdAt: 'desc' },
        take:    10,
        include: { tipoCert: { select: { descripcion: true } } },
      }),
    ]);

    const porEstado: Record<string, number> = {};
    for (const m of metricas) {
      porEstado[m.solEstado] = m._count.id;
    }

    return { porEstado, ultimasSolicitudes };
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  private async getSolicitudOFail(id: number) {
    const s = await this.prisma.solicitud.findUnique({
      where: { id },
      include: { tipoCert: true },
    });
    if (!s) throw new NotFoundException('Solicitud no encontrada');
    return s;
  }
}
