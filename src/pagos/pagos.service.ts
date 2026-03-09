import {
  Injectable, Logger, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../config/prisma.service';
import { PluspagosService } from './pluspagos.service';
import { EmailService } from '../common/email.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';

/**
 * Flujo de pago completo:
 *
 * 1. generarPayloadPago():
 *    - Genera un UUID fresco (pagoIntentoId) y lo persiste en solicitud.pago_intento_id
 *    - Ese UUID se envía como TransaccionComercioId a PlusPagos
 *    - Los callback URLs contienen ?intento=<UUID>&status=success|cancel
 *
 * 2. procesarNotificacion() — webhook global o callback S2S:
 *    - Recibe TransaccionComercioId = UUID del intento
 *    - Busca la solicitud WHERE pago_intento_id = UUID (lookup inverso)
 *    - fec_vencimiento_pago YA fue calculada al CREAR la solicitud, no se toca aquí
 *    - Garantiza idempotencia: INSERT pago falla si webhook_id ya existe (UNIQUE)
 */

@Injectable()
export class PagosService {
  private readonly logger = new Logger(PagosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluspagos: PluspagosService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // ── Genera payload encriptado para redirigir al ciudadano a PlusPagos ────

  async generarPayloadPago(nroTramite: string, emailCiudadano: string) {
    const solicitud = await this.prisma.solicitud.findUnique({
      where: { nroTramite },
      include: { tipoCert: true },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    if (solicitud.email !== emailCiudadano) throw new BadRequestException('No autorizado');
    if (solicitud.solEstado !== 'pendiente') {
      throw new BadRequestException({
        code:    'ESTADO_INVALIDO',
        message: `La solicitud está en estado "${solicitud.solEstado}", no se puede iniciar pago`,
      });
    }

    // UUID único por intento — permite reintentos sin colisión
    const pagoIntentoId = crypto.randomUUID();

    // Persistir para el lookup inverso cuando llegue el webhook
    await this.prisma.solicitud.update({
      where: { id: solicitud.id },
      data:  { pagoIntentoId },
    });

    const montoCentavos = Math.round(Number(solicitud.tipoCert.precio) * 100);

    const payload = this.pluspagos.buildPaymentPayload({
      nroTramite,
      pagoIntentoId,
      montoCentavos,
      email:           solicitud.email,
      tipoCertificado: solicitud.tipoCert.descripcion,
    });

    this.logger.debug(`Intento generado: ${pagoIntentoId} → ${nroTramite}`);
    return { ...payload, pluspagosUrl: this.pluspagos.url };
  }

  // ── Webhook global (Dashboard PlusPagos → Webhook URL) ────────────────────

  async procesarWebhook(payload: Record<string, any>): Promise<{ received: boolean }> {
    this.logger.log('Webhook global:', JSON.stringify(payload));

    const {
      TransaccionPlataformaId: plataformaId,
      TransaccionComercioId:   pagoIntentoId,
      Monto:                   montoStr,
      EstadoId:                estadoId,
    } = payload;

    if (!plataformaId || !pagoIntentoId || !estadoId) {
      this.logger.warn('Webhook incompleto, ignorado');
      return { received: true }; // 200 siempre — PlusPagos no debe reintentar
    }

    return this.procesarNotificacion({
      webhookId:     String(plataformaId),
      pagoIntentoId: String(pagoIntentoId),
      monto:         parseFloat(montoStr) || 0,
      estadoId,
      payloadRaw:    payload,
      fuente:        'webhook_global',
    });
  }

  // ── Callback S2S por transacción (CallbackSuccess / CallbackCancel) ────────

  async procesarCallback(
    pagoIntentoId: string,
    status: 'success' | 'cancel',
    payload: Record<string, any>,
  ): Promise<{ received: boolean }> {
    this.logger.log(`Callback ${status} para intento ${pagoIntentoId}`);

    const transaccionId = payload.transaccionId
      ?? payload.TransaccionPlataformaId
      ?? `cb_${pagoIntentoId}`;

    const estadoId = status === 'success'
      ? this.config.get<number>('PLUSPAGOS_ESTADO_APROBADO', 3)
      : 4;

    return this.procesarNotificacion({
      webhookId:     `callback_${transaccionId}`,
      pagoIntentoId,
      monto:         parseFloat(payload.monto ?? payload.Monto ?? '0') || 0,
      estadoId,
      payloadRaw:    payload,
      fuente:        'callback',
    });
  }

  // ── Lógica central (compartida) ────────────────────────────────────────────

  private async procesarNotificacion(params: {
    webhookId:     string;
    pagoIntentoId: string;
    monto:         number;
    estadoId:      string | number;
    payloadRaw:    Record<string, any>;
    fuente:        string;
  }): Promise<{ received: boolean }> {
    const { webhookId, pagoIntentoId, monto, estadoId, payloadRaw, fuente } = params;
    const { codigo, descripcion } = this.pluspagos.mapEstado(estadoId);
    const aprobado = this.pluspagos.isAprobado(estadoId);

    // Lookup por UUID del intento
    const solicitud = await this.prisma.solicitud.findUnique({
      where: { pagoIntentoId },
      include: { tipoCert: true },
    });

    if (!solicitud) {
      this.logger.error(`[${fuente}] Sin solicitud para pagoIntentoId=${pagoIntentoId}`);
      return { received: true };
    }

    // IDEMPOTENCIA: si webhook_id ya existe, puede ser exactamente el mismo evento
    // o una actualización del estado para la misma transacción. En lugar de
    // ignorar ciegamente, comprobamos si el estado cambió y en ese caso
    // actualizamos el registro y aplicamos la transición si corresponde.
    const existente = await this.prisma.pago.findUnique({ where: { webhookId } });
    if (existente) {
      // Si no hay cambio de estado, ignoramos como antes
      if (existente.codigoPp === codigo && existente.estadoPp === descripcion) {
        this.logger.warn(`[${fuente}] Duplicado ignorado: ${webhookId}`);
        return { received: true };
      }

      this.logger.log(`[${fuente}] Duplicado con cambio de estado: actualizando pago ${webhookId} (${existente.estadoPp} → ${descripcion})`);
    }

    const { nroTramite } = solicitud;
    this.logger.log(`[${fuente}] ${nroTramite} | estado=${solicitud.solEstado} | EstadoId=${estadoId} (${descripcion})`);

    await this.prisma.$transaction(async (tx) => {
      // 1. Registrar o actualizar el evento de pago
      if (!existente) {
        await tx.pago.create({
          data: {
            solicitudId: solicitud.id,
            webhookId,
            monto,
            codigoPp:    codigo,
            estadoPp:    descripcion,
            payloadRaw:  payloadRaw as Prisma.InputJsonValue,
            procesado:   true,
          },
        });
      } else {
        await tx.pago.update({
          where: { webhookId },
          data: {
            monto,
            codigoPp:   codigo,
            estadoPp:   descripcion,
            payloadRaw: payloadRaw as Prisma.InputJsonValue,
            procesado:  true,
            errorMsg:   null,
            procesadoAt: new Date(),
          },
        });
      }

      // 2. Transición de estado solo desde 'pendiente'
      if (solicitud.solEstado === 'pendiente') {
        const nuevoEstado = aprobado ? 'pagado' : 'rechazado';
        const updateData: Prisma.SolicitudUpdateInput = {
          solEstado:     nuevoEstado,
          pagoIntentoId: null, // limpiar — evita reuso del UUID
        };

        if (aprobado) {
          updateData.fecPago = new Date();
        } else {
          updateData.observacionRechazo =
            `Pago rechazado automáticamente por la pasarela: ${descripcion} (código ${codigo})`;
        }

        await tx.solicitud.update({ where: { id: solicitud.id }, data: updateData });
        this.logger.log(`${nroTramite}: pendiente → ${nuevoEstado}`);
      } else {
        this.logger.warn(
          `${nroTramite} en estado "${solicitud.solEstado}": notificación registrada sin cambio de estado`,
        );
      }
    });

    // Email post-transacción (best-effort)
    if (solicitud.solEstado === 'pendiente' && aprobado) {
      this.email
        .sendPagoConfirmado(solicitud.email, solicitud.nombreCompleto, nroTramite, monto.toFixed(2))
        .catch((e) => this.logger.error('Email pago:', e.message));
    }

    return { received: true };
  }
}
