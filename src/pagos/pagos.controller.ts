import {
  Controller, Post, Get, Body, Query, HttpCode, HttpStatus, Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { PagosService } from './pagos.service';

@ApiTags('pagos')
@Controller('pagos')
export class PagosController {
  private readonly logger = new Logger(PagosController.name);

  constructor(private readonly pagosService: PagosService) {}

  /**
   * POST /api/pagos/webhook
   * Endpoint global configurado en el Dashboard de PlusPagos.
   * Recibe notificaciones JSON sin autenticación de cliente.
   * SIEMPRE responde 200 para que PlusPagos no reintente.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook global de PlusPagos',
    description: 'Configurar esta URL en el Dashboard de PlusPagos → Webhook URL',
  })
  async webhookGlobal(@Body() payload: Record<string, any>) {
    this.logger.log(`Webhook recibido: ${JSON.stringify(payload)}`);
    return this.pagosService.procesarWebhook(payload);
  }

  /**
   * GET /api/pagos/callback
   * Callback por transacción — PlusPagos llama a CallbackSuccess o CallbackCancel.
   * La URL se encriptó en el payload del checkout y contiene ?nro=NRO_TRAMITE&status=success|cancel
   *
   * PlusPagos puede enviar esto como GET o POST; soportamos ambos.
   */
  @Get('callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Callback S2S por transacción (éxito o cancelación)',
    description: 'URL encriptada en CallbackSuccess/CallbackCancel al iniciar pago',
  })
  async callbackGet(
    @Query('intento') pagoIntentoId: string,
    @Query('status') status: 'success' | 'cancel',
    @Query()         queryParams: Record<string, any>,
  ) {
    return this.pagosService.procesarCallback(pagoIntentoId, status, queryParams);
  }

  @Post('callback')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // mismo endpoint para POST
  async callbackPost(
    @Query('intento') pagoIntentoId: string,
    @Query('status') status: 'success' | 'cancel',
    @Body()          body: Record<string, any>,
  ) {
    return this.pagosService.procesarCallback(pagoIntentoId, status, body);
  }
}
