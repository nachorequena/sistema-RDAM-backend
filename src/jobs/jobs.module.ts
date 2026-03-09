import { Injectable, Logger, Module, Controller, Get, Post, HttpCode, HttpStatus, Headers, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../config/prisma.service';
import { StorageService } from '../common/storage.service';

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Job 1: PAGADO → VENCIDO
   * Solicitudes cuyo fec_vencimiento_pago ya pasó y nadie las gestionó.
   * Corre cada hora.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async vencerSolicitudesPagadas(): Promise<number> {
    this.logger.debug('Job: verificando solicitudes PAGADO para vencer...');

    const resultado = await this.prisma.$queryRaw<[{ fn_vencer_solicitudes_pagadas: number }]>`
      SELECT fn_vencer_solicitudes_pagadas() AS fn_vencer_solicitudes_pagadas
    `;
    const actualizadas = Number(resultado[0]?.fn_vencer_solicitudes_pagadas ?? 0);

    if (actualizadas > 0) {
      this.logger.warn(`Job vencimiento pagadas: ${actualizadas} solicitud(es) → VENCIDO`);
    }
    return actualizadas;
  }

  /**
   * Job 2: PUBLICADO → PUBLICADO_VENCIDO
   * Certificados publicados cuyo fec_vencimiento ya pasó.
   * Corre cada hora. Además limpia los binarios PDF del storage.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async vencerCertificadosPublicados(): Promise<number> {
    this.logger.debug('Job: verificando certificados PUBLICADO para vencer...');

    // Obtener rutas de PDFs antes de vencerlos para poder eliminarlos
    const aVencer = await this.prisma.solicitud.findMany({
      where: {
        solEstado:     'publicado',
        fecVencimiento: { lt: new Date() },
      },
      select: { id: true, nroTramite: true, rutaPdf: true },
    });

    if (aVencer.length === 0) return 0;

    // Ejecutar la función SQL que actualiza el estado y limpia ruta_pdf
    const resultado = await this.prisma.$queryRaw<[{ fn_vencer_certificados_publicados: number }]>`
      SELECT fn_vencer_certificados_publicados() AS fn_vencer_certificados_publicados
    `;
    const actualizadas = Number(resultado[0]?.fn_vencer_certificados_publicados ?? 0);

    // Eliminar los binarios del storage
    for (const s of aVencer) {
      if (s.rutaPdf) {
        await this.storage.deleteFile(s.rutaPdf, 'pdfs').catch((e) =>
          this.logger.error(`Error eliminando PDF ${s.rutaPdf}: ${e.message}`),
        );
      }
    }

    this.logger.warn(`Job vencimiento publicados: ${actualizadas} certificado(s) → PUBLICADO_VENCIDO, ${aVencer.length} PDF(s) eliminados`);
    return actualizadas;
  }

  /**
   * Job 3: Limpieza de OTPs expirados.
   * Corre cada hora.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async limpiarOtps(): Promise<number> {
    const resultado = await this.prisma.$queryRaw<[{ fn_limpiar_otp_expirados: number }]>`
      SELECT fn_limpiar_otp_expirados() AS fn_limpiar_otp_expirados
    `;
    const eliminados = Number(resultado[0]?.fn_limpiar_otp_expirados ?? 0);
    if (eliminados > 0) {
      this.logger.debug(`Job OTP: ${eliminados} OTP(s) expirados eliminados`);
    }
    return eliminados;
  }

  /**
   * Job 4: Limpieza de adjuntos huérfanos (sin solicitud_id y TTL vencido).
   * Corre cada 6 horas.
   */
  @Cron('0 */6 * * *')
  async limpiarAdjuntosHuerfanos(): Promise<number> {
    this.logger.debug('Job: limpiando adjuntos huérfanos...');

    // La función SQL retorna las rutas a eliminar
    const huerfanos = await this.prisma.$queryRaw<Array<{ id: number; ruta_storage: string }>>`
      SELECT * FROM fn_limpiar_adjuntos_huerfanos()
    `;

    // Eliminar los binarios del storage primero
    for (const h of huerfanos) {
      await this.storage.deleteFile(h.ruta_storage, 'adjuntos').catch((e) =>
        this.logger.error(`Error eliminando adjunto huérfano ${h.ruta_storage}: ${e.message}`),
      );
    }

    if (huerfanos.length > 0) {
      this.logger.debug(`Job adjuntos huérfanos: ${huerfanos.length} eliminados`);
    }
    return huerfanos.length;
  }

  // ── Health check ──────────────────────────────────────────────────────────

  async healthCheck() {
    const [dbOk, storageOk] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.storage.fileExists('health-check-probe', 'adjuntos').then(() => true).catch(() => true), // always ok si no existe
    ]);

    return {
      status:    dbOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk     ? 'ok' : 'error',
        storage:  storageOk ? 'ok' : 'error',
      },
    };
  }
}

// ── Controller (endpoints manuales + health) ─────────────────────────────────

@ApiTags('internal')
@Controller('internal')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
  ) {}

  private verificarToken(headers: Record<string, string>): void {
    const expected = this.config.get<string>('INTERNAL_TOKEN');
    const received = headers['x-internal-token'];
    if (expected && received !== expected) {
      throw new UnauthorizedException('Token interno inválido');
    }
  }

  @Post('jobs/vencer-pagados')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecuta manualmente el job PAGADO → VENCIDO' })
  async vencerPagados(@Headers() headers: Record<string, string>) {
    this.verificarToken(headers);
    const count = await this.jobsService.vencerSolicitudesPagadas();
    return { data: { actualizadas: count } };
  }

  @Post('jobs/vencer-publicados')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecuta manualmente el job PUBLICADO → PUBLICADO_VENCIDO' })
  async vencerPublicados(@Headers() headers: Record<string, string>) {
    this.verificarToken(headers);
    const count = await this.jobsService.vencerCertificadosPublicados();
    return { data: { actualizadas: count } };
  }

  @Post('jobs/limpiar-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecuta manualmente el job de limpieza de OTPs' })
  async limpiarOtp(@Headers() headers: Record<string, string>) {
    this.verificarToken(headers);
    const count = await this.jobsService.limpiarOtps();
    return { data: { eliminados: count } };
  }

  @Post('jobs/limpiar-adjuntos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecuta manualmente el job de adjuntos huérfanos' })
  async limpiarAdjuntos(@Headers() headers: Record<string, string>) {
    this.verificarToken(headers);
    const count = await this.jobsService.limpiarAdjuntosHuerfanos();
    return { data: { eliminados: count } };
  }

  @Post('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check de la aplicación' })
  async health() {
    return { data: await this.jobsService.healthCheck() };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check de la aplicación (GET)' })
  async healthGet() {
    return { data: await this.jobsService.healthCheck() };
  }
}

// ── Module ───────────────────────────────────────────────────────────────────

@Module({
  providers:   [JobsService, StorageService],
  controllers: [JobsController],
  exports:     [JobsService],
})
export class JobsModule {}
