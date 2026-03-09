import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from '../common/email.service';
import { Prisma, SolEstado } from '@prisma/client';
import { CrearSolicitudDto } from './dto/solicitudes.dto';

@Injectable()
export class SolicitudesService {
  private readonly logger = new Logger(SolicitudesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // ── Crear solicitud ───────────────────────────────────────────────────────

  async crear(dto: CrearSolicitudDto, emailCiudadano: string, ip?: string) {
    // Validar tipo de certificado
    const tipoCert = await this.prisma.tipoCertificado.findFirst({
      where: { id: dto.tipoCertId, activo: true },
    });
    if (!tipoCert) {
      throw new BadRequestException({ code: 'TIPO_CERT_INVALIDO', message: 'Tipo de certificado no encontrado o inactivo' });
    }

    // Validar adjuntos: deben existir y no estar asociados a otra solicitud
    if (dto.adjuntoIds?.length) {
      const adjuntos = await this.prisma.adjunto.findMany({
        where: { id: { in: dto.adjuntoIds }, solicitudId: null },
      });
      if (adjuntos.length !== dto.adjuntoIds.length) {
        throw new BadRequestException({ code: 'ADJUNTOS_INVALIDOS', message: 'Uno o más adjuntos no existen o ya fueron asociados' });
      }

      // Verificar tamaño total ≤ 10 MB
      const totalBytes = adjuntos.reduce((acc, a) => acc + a.tamanioBytes, 0);
      if (totalBytes > 10 * 1024 * 1024) {
        throw new BadRequestException({ code: 'ADJUNTOS_EXCEDEN_LIMITE', message: 'El total de adjuntos no puede superar 10 MB' });
      }
    }

    // Generar nro_tramite via función SQL
    const nroResult = await this.prisma.$queryRaw<[{ fn_generar_nro_tramite: string }]>`
      SELECT fn_generar_nro_tramite() AS fn_generar_nro_tramite
    `;
    const nroTramite = nroResult[0].fn_generar_nro_tramite;

    // fec_vencimiento_pago se calcula al crear (NOW() + dias según entorno)
    const isPrd = this.config.get('NODE_ENV') === 'production';
    const diasVencimiento = isPrd ? tipoCert.diasVencimientoPrd : tipoCert.diasVencimientoDev;
    const fecVencimientoPago = new Date();
    fecVencimientoPago.setDate(fecVencimientoPago.getDate() + diasVencimiento);

    // Crear solicitud en transacción
    const solicitud = await this.prisma.$transaction(async (tx) => {
      const nueva = await tx.solicitud.create({
        data: {
          nroTramite,
          cuil:               dto.cuil,
          nombreCompleto:     dto.nombreCompleto,
          email:              dto.email,
          telefono:           dto.telefono,
          tipoCertId:         dto.tipoCertId,
          solEstado:          'pendiente',
          fecVencimientoPago, // calculado aquí al crear, no al pagar
        },
        include: { tipoCert: true },
      });

      // Fase 2: asociar adjuntos a la solicitud
      if (dto.adjuntoIds?.length) {
        await tx.adjunto.updateMany({
          where: { id: { in: dto.adjuntoIds } },
          data:  { solicitudId: nueva.id },
        });
      }

      return nueva;
    });

    this.logger.log(`Solicitud creada: ${nroTramite} por ${emailCiudadano}`);

    // Email de confirmación (best-effort, no bloquea la respuesta)
    this.email
      .sendSolicitudCreada(dto.email, dto.nombreCompleto, nroTramite)
      .catch((err) => this.logger.error('Error email solicitud creada:', err.message));

    return solicitud;
  }

  // ── Listar solicitudes del ciudadano ──────────────────────────────────────

  async listarMias(emailCiudadano: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.solicitud.findMany({
        where: { email: emailCiudadano },
        include: { tipoCert: { select: { descripcion: true, precio: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.solicitud.count({ where: { email: emailCiudadano } }),
    ]);

    return { data, total, page, perPage: limit };
  }

  // ── Detalle de solicitud (ciudadano) ──────────────────────────────────────

  async detalle(id: number, emailCiudadano: string) {
    const solicitud = await this.prisma.solicitud.findUnique({
      where: { id },
      include: {
        tipoCert:  true,
        adjuntos:  { select: { id: true, tipo: true, nombreOrig: true, mimeType: true, tamanioBytes: true } },
        historial: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    if (solicitud.email !== emailCiudadano) throw new ForbiddenException('No tenés acceso a esta solicitud');

    // No exponer ruta interna del PDF al ciudadano
    const { rutaPdf: _, ...resto } = solicitud as any;
    return resto;
  }

  // ── Consulta pública por nro_tramite o CUIL (sin login) ──────────────────

  async consultaPublica(nroTramite?: string, cuil?: string) {
    if (!nroTramite && !cuil) {
      throw new BadRequestException('Debe proporcionar nro_tramite o cuil');
    }

    const where: Prisma.SolicitudWhereInput = nroTramite
      ? { nroTramite }
      : { cuil };

    const solicitudes = await this.prisma.solicitud.findMany({
      where,
      select: {
        id:            true,
        nroTramite:    true,
        solEstado:     true,
        fecPago:       true,
        fecEmision:    true,
        fecVencimiento: true,
        createdAt:     true,
        tipoCert:      { select: { descripcion: true } },
        historial:     {
          orderBy: { createdAt: 'asc' },
          select:  { estadoAnt: true, estadoNuevo: true, actor: true, observacion: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!solicitudes.length) throw new NotFoundException('No se encontraron trámites');
    return solicitudes;
  }

  // ── Iniciar pago (genera payload para PlusPagos) ──────────────────────────

  async getSolicitudParaPago(nroTramite: string, emailCiudadano: string) {
    const solicitud = await this.prisma.solicitud.findUnique({
      where: { nroTramite },
      include: { tipoCert: true },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    if (solicitud.email !== emailCiudadano) throw new ForbiddenException();
    if (solicitud.solEstado !== 'pendiente') {
      throw new BadRequestException({ code: 'ESTADO_INVALIDO', message: `La solicitud está en estado "${solicitud.solEstado}"` });
    }

    return solicitud;
  }
}
