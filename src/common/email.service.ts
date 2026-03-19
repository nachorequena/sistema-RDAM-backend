import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    const transportOptions: any = {
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<string>('SMTP_SECURE', 'false') === 'true',
    };

    const smtpUser = this.config.get<string>('SMTP_USER');
    const smtpPass = this.config.get<string>('SMTP_PASS');
    if (smtpUser) {
      transportOptions.auth = { user: smtpUser, pass: smtpPass };
    }

    this.transporter = nodemailer.createTransport(transportOptions);
  }

  private get from(): string {
    return `"${this.config.get('EMAIL_FROM_NAME', 'RDAM')}" <${this.config.get('EMAIL_FROM')}>`;
  }

  async sendSolicitudCreada(to: string, nombre: string, nroTramite: string): Promise<void> {
    await this.send(to, `Tu trámite ${nroTramite} fue recibido`, `
      <h2>¡Hola ${nombre}!</h2>
      <p>Tu solicitud fue registrada con el número de trámite:</p>
      <h3 style="color:#1d4ed8">${nroTramite}</h3>
      <p>Guardá este número para hacer seguimiento de tu trámite.</p>
      <p>El próximo paso es realizar el pago para que comencemos a procesarlo.</p>
    `);
  }

  async sendPagoConfirmado(to: string, nombre: string, nroTramite: string, monto: string): Promise<void> {
    await this.send(to, `Pago confirmado — Trámite ${nroTramite}`, `
      <h2>¡Pago recibido, ${nombre}!</h2>
      <p>Confirmamos el pago de <strong>$${monto}</strong> para el trámite <strong>${nroTramite}</strong>.</p>
      <p>Un operador comenzará a revisar tu documentación en breve.</p>
    `);
  }

  async sendCertificadoPublicado(
    to: string,
    nombre: string,
    nroTramite: string,
    token: string,
    fecVencimiento: Date,
  ): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const linkDescarga = `${appUrl}/api/certificados/${token}`;
    const vencimiento  = fecVencimiento.toLocaleDateString('es-AR');

    await this.send(to, `Tu certificado está disponible — ${nroTramite}`, `
      <h2>¡Tu certificado está listo, ${nombre}!</h2>
      <p>Trámite: <strong>${nroTramite}</strong></p>
      <p>Podés descargarlo desde el siguiente enlace seguro:</p>
      <p><a href="${linkDescarga}" style="background:#1d4ed8;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block">
        📄 Descargar Certificado
      </a></p>
      <p style="color:#64748b;font-size:0.9em">Este enlace vence el ${vencimiento}.</p>
    `);
  }

  async sendSolicitudRechazada(
    to: string,
    nombre: string,
    nroTramite: string,
    observacion: string,
  ): Promise<void> {
    await this.send(to, `Tu solicitud fue rechazada — ${nroTramite}`, `
      <h2>Hola ${nombre},</h2>
      <p>Lamentablemente tu solicitud <strong>${nroTramite}</strong> no pudo ser procesada.</p>
      <p><strong>Motivo:</strong></p>
      <blockquote style="border-left:4px solid #ef4444;padding-left:16px;color:#374151">${observacion}</blockquote>
      <p>Si tenés dudas, podés contactar a la administración para más información.</p>
    `);
  }

  async sendOtp(to: string, codigo: string): Promise<void> {
    await this.send(to, 'Tu código de acceso — RDAM', `
      <h2>Código de verificación</h2>
      <p>Tu código de acceso al portal RDAM es:</p>
      <h1 style="letter-spacing:8px;color:#1d4ed8;font-size:3rem">${codigo}</h1>
      <p style="color:#64748b">Este código vence en 10 minutos y solo puede usarse una vez.</p>
    `);
  }

  private async send(to: string, subject: string, htmlBody: string): Promise<boolean> {
    // Reintentos simples con backoff exponencial (3 intentos)
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.transporter.sendMail({
          from:    this.from,
          to,
          subject,
          html: `
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"></head>
            <body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b">
              ${htmlBody}
              <hr style="margin-top:40px;border-color:#e2e8f0">
              <p style="color:#94a3b8;font-size:0.8em">
                Sistema de Gestión de Certificados Digitales — RDAM<br>
                Este es un correo automático, por favor no respondas.
              </p>
            </body>
            </html>
          `,
        });
        this.logger.debug(`Email enviado a ${to}: ${subject}`);
        return true;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Intento ${attempt} - No se pudo enviar email a ${to}: ${errMsg}`);
        if (attempt < maxAttempts) {
          // backoff
          await new Promise((r) => setTimeout(r, 300 * attempt));
          continue;
        }
        // último intento fallido
        this.logger.error(`Error enviando email a ${to} después de ${maxAttempts} intentos: ${errMsg}`);
        // No propagamos para no romper la operación principal; retornamos false para quien quiera actuar
        return false;
      }
    }
    return false;
  }
}
