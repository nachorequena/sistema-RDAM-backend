import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * PluspagosService — TypeScript del módulo crypto.js provisto por la pasarela.
 *
 * Algoritmo: AES-256-CBC
 * Derivación de clave: SHA-256(secretKey)
 * Formato: Base64( IV[16 bytes] + Ciphertext )
 *
 * Compatible 100% con el módulo crypto.js del mock PlusPagos Campus 2026.
 * Se usa Node.js crypto nativo en lugar de CryptoJS para evitar dependencias extra.
 */
@Injectable()
export class PluspagosService {
  private readonly logger = new Logger(PluspagosService.name);
  private readonly secretKey: string;
  private readonly merchantGuid: string;
  private readonly pluspagosUrl: string;
  private readonly estadoAprobado: number;

  constructor(private readonly config: ConfigService) {
    this.secretKey = config.getOrThrow<string>('PLUSPAGOS_SECRET_KEY');
    this.merchantGuid = config.getOrThrow<string>('PLUSPAGOS_MERCHANT_GUID');
    this.pluspagosUrl = config.getOrThrow<string>('PLUSPAGOS_URL');
    // Asegurar conversión a number (viene de .env como string)
    this.estadoAprobado = Number(config.get<string>('PLUSPAGOS_ESTADO_APROBADO', '3'));
  }

  // ── Criptografía ──────────────────────────────────────────────────────────

  /**
   * Deriva la clave AES de 256 bits aplicando SHA-256 al secretKey.
   * Espeja exactamente: `const key = CryptoJS.SHA256(secretKey)` del crypto.js
   */
  private deriveKey(secretKey: string): Buffer {
    return crypto.createHash('sha256').update(secretKey, 'utf8').digest();
  }

  /**
   * Encripta un string con AES-256-CBC.
   * Salida: Base64( IV[16 bytes] + Ciphertext )
   * Espeja: encryptString() del crypto.js
   */
  encryptString(plainText: string, secretKey?: string): string {
    const key = this.deriveKey(secretKey ?? this.secretKey);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const combined = Buffer.concat([iv, encrypted]);
    return combined.toString('base64');
  }

  /**
   * Desencripta un string encriptado con encryptString.
   * Espeja: decryptString() del crypto.js
   */
  decryptString(encryptedText: string, secretKey?: string): string {
    try {
      const key = this.deriveKey(secretKey ?? this.secretKey);
      const combined = Buffer.from(encryptedText, 'base64');
      const iv = combined.subarray(0, 16);
      const ciphertext = combined.subarray(16);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Error al desencriptar payload:', msg);
      // Lanzar para que el caller pueda manejar el fallo explícitamente
      throw new Error(`Error al desencriptar payload: ${msg}`);
    }
  }

  // ── Construcción del payload para PlusPagos ───────────────────────────────

  /**
   * Construye el payload encriptado para redirigir al usuario a PlusPagos.
   * El frontend hace un POST automático (form submit) con estos campos.
   *
   * Campos encriptados (con el secretKey compartido):
   *   - Monto: en centavos, como string (ej: "250000" para $2500.00)
   *   - CallbackSuccess: URL S2S de retorno cuando el pago es aprobado
   *   - CallbackCancel: URL S2S de retorno cuando el pago es rechazado/cancelado
   *   - UrlSuccess: URL del frontend para redirigir al usuario tras pago exitoso
   *   - UrlError: URL del frontend para redirigir al usuario tras pago fallido
   *   - Informacion: JSON con datos de contexto (nro_tramite, email, etc.)
   */
  buildPaymentPayload(params: {
    nroTramite: string;
    pagoIntentoId: string;   // UUID generado por intento — usado como TransaccionComercioId
    montoCentavos: number;
    email: string;
    tipoCertificado: string;
  }): Record<string, string> {
    const { nroTramite, pagoIntentoId, montoCentavos, email, tipoCertificado } = params;
    const apiUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');

    // Validar que las URLs base incluyan host (evita URIs como "http:///?...")
    try {
      // esto lanzará si falta host o esquema inválido
      new URL(apiUrl);
      new URL(frontendUrl);
    } catch (err) {
      this.logger.error(`URLs inválidas: APP_URL=${apiUrl} FRONTEND_URL=${frontendUrl}`);
      throw new Error('Configuración inválida: APP_URL o FRONTEND_URL no están correctamente definidas');
    }

    // Validaciones básicas
    if (!Number.isInteger(montoCentavos) || montoCentavos <= 0) {
      this.logger.error(`Monto inválido en cents: ${montoCentavos}`);
      throw new Error(`Monto inválido: ${montoCentavos}`);
    }

    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(pagoIntentoId)) {
      this.logger.error(`pagoIntentoId no válido: ${pagoIntentoId}`);
      throw new Error(`pagoIntentoId no es un UUID válido: ${pagoIntentoId}`);
    }

    // URLs de callback S2S — identifican el intento por pagoIntentoId (UUID)
    // El webhook vuelve con TransaccionComercioId = pagoIntentoId, y RDAM hace
    // lookup en solicitud.pago_intento_id para identificar el trámite
    const callbackSuccess = `${apiUrl}/api/pagos/callback?intento=${encodeURIComponent(pagoIntentoId)}&status=success`;
    const callbackCancel  = `${apiUrl}/api/pagos/callback?intento=${encodeURIComponent(pagoIntentoId)}&status=cancel`;

    // URLs de redirección del navegador (para el ciudadano)
    const urlSuccess = `${frontendUrl}/tramites/confirmacion?status=success&nro=${nroTramite}`;
    const urlError   = `${frontendUrl}/tramites/confirmacion?status=error&nro=${nroTramite}`;

    return {
      Comercio: this.merchantGuid,
      // TransaccionComercioId = UUID del intento (un UUID por intento de pago)
      // Permite reintentos sin colisión y lookup inverso via solicitud.pago_intento_id
      TransaccionComercioId: pagoIntentoId,
      Monto:            this.encryptString(montoCentavos.toString()),
      CallbackSuccess:  this.encryptString(callbackSuccess),
      CallbackCancel:   this.encryptString(callbackCancel),
      UrlSuccess:       this.encryptString(urlSuccess),
      UrlError:         this.encryptString(urlError),
      Informacion:      this.encryptString(JSON.stringify({ nroTramite, pagoIntentoId, email, tipoCertificado })),
    };
  }

  // ── Procesamiento del webhook ─────────────────────────────────────────────

  /**
   * Determina si el EstadoId del webhook representa un pago aprobado.
   * DEV/mock: EstadoId "3" = REALIZADA (aprobado)
   * PRD: EstadoId "1" = APROBADO (configurable vía PLUSPAGOS_ESTADO_APROBADO)
   */
  isAprobado(estadoId: string | number): boolean {
    return Number(estadoId) === this.estadoAprobado;
  }

  /**
   * Mapea el EstadoId de PlusPagos a la descripción legible.
   * Cubre tanto el mock (3=REALIZADA) como los códigos PRD esperados.
   */
  mapEstado(estadoId: string | number): { codigo: number; descripcion: string } {
    const codigo = Number(estadoId);
    const mapa: Record<number, string> = {
      1:  'APROBADO',
      3:  'REALIZADA',    // mock
      4:  'RECHAZADA',
      7:  'EXPIRADA',
      8:  'CANCELADA',
      9:  'DEVUELTA',
      11: 'VENCIDA',
    };
    return {
      codigo,
      descripcion: mapa[codigo] ?? `DESCONOCIDO_${codigo}`,
    };
  }

  get url(): string {
    return this.pluspagosUrl;
  }
}
