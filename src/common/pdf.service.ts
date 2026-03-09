import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as puppeteer from 'puppeteer';

export interface CertificadoData {
  nroTramite:       string;
  nombreCompleto:   string;
  cuil:             string;
  tipoCertificado:  string;
  fecEmision:       Date;
  fecVencimiento:   Date;
  tokenPdf:         string;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Genera un PDF del certificado usando Puppeteer.
   * Retorna el buffer del PDF generado.
   */
  async generarCertificado(data: CertificadoData): Promise<Buffer> {
    this.logger.debug(`Generando PDF para ${data.nroTramite}`);

    const html = this.buildTemplate(data);

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format:            'A4',
        printBackground:   true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });

      this.logger.debug(`PDF generado: ${pdfBuffer.length} bytes`);
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  // ── Plantilla HTML del certificado ───────────────────────────────────────

  private buildTemplate(data: CertificadoData): string {
    const emision     = this.formatDate(data.fecEmision);
    const vencimiento = this.formatDate(data.fecVencimiento);
    const appUrl      = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const verifyUrl   = `${appUrl}/api/certificados/${data.tokenPdf}`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certificado Digital — ${data.nroTramite}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      background: #ffffff;
      color: #1a1a2e;
      padding: 20px;
    }

    /* ── Encabezado institucional ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #1d4ed8;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header-logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #1d4ed8, #7c3aed);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 28px;
      font-weight: bold;
    }
    .org-name h1 { font-size: 1.4rem; color: #1d4ed8; font-weight: bold; }
    .org-name p  { font-size: 0.8rem; color: #64748b; }
    .header-right { text-align: right; font-size: 0.75rem; color: #64748b; }
    .nro-tramite  { font-size: 0.85rem; font-weight: bold; color: #1d4ed8; }

    /* ── Título principal ── */
    .cert-title {
      text-align: center;
      padding: 20px 0;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 28px;
      background: linear-gradient(to right, #eff6ff, #f8fafc);
    }
    .cert-title h2 { font-size: 1.6rem; color: #1e40af; letter-spacing: 2px; text-transform: uppercase; }
    .cert-title p  { color: #64748b; font-size: 0.9rem; margin-top: 4px; }

    /* ── Cuerpo del certificado ── */
    .cert-body {
      text-align: center;
      font-size: 1rem;
      line-height: 1.8;
      padding: 0 20px;
      margin-bottom: 28px;
    }
    .cert-body .intro { color: #374151; font-size: 1rem; }
    .cert-body .nombre {
      font-size: 1.5rem;
      font-weight: bold;
      color: #1d4ed8;
      border-bottom: 2px dotted #93c5fd;
      display: inline-block;
      padding: 4px 20px;
      margin: 8px 0;
    }
    .cert-body .cuil { font-size: 0.95rem; color: #475569; }
    .cert-body .tipo-cert {
      font-size: 1.15rem;
      font-weight: bold;
      color: #1e40af;
      background: #dbeafe;
      padding: 6px 16px;
      border-radius: 4px;
      display: inline-block;
      margin: 8px 0;
    }

    /* ── Datos ── */
    .datos-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 28px;
    }
    .dato-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px 16px;
    }
    .dato-card .label { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 1px; }
    .dato-card .value { font-size: 1rem; font-weight: bold; color: #1e293b; margin-top: 2px; }

    /* ── Sello y firma ── */
    .footer-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-bottom: 24px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
    }
    .sello {
      width: 100px;
      height: 100px;
      border: 4px solid #1d4ed8;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #1d4ed8;
      font-size: 0.6rem;
      font-weight: bold;
      text-transform: uppercase;
      text-align: center;
      padding: 8px;
    }
    .firma { text-align: center; }
    .firma .linea-firma { border-top: 1px solid #475569; width: 200px; margin-bottom: 6px; }
    .firma .cargo { font-size: 0.8rem; color: #64748b; }

    /* ── QR / Verificación ── */
    .verificacion {
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 0.75rem;
      color: #0369a1;
      text-align: center;
    }
    .verificacion .url { font-family: monospace; font-size: 0.7rem; word-break: break-all; margin-top: 4px; }

    /* ── Pie de página ── */
    .page-footer {
      position: fixed;
      bottom: 10mm;
      left: 10mm;
      right: 10mm;
      font-size: 0.65rem;
      color: #94a3b8;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      padding-top: 6px;
    }
  </style>
</head>
<body>

  <!-- Encabezado -->
  <div class="header">
    <div class="header-logo">
      <div class="logo-icon">R</div>
      <div class="org-name">
        <h1>RDAM</h1>
        <p>Registro Digital de Actos y Movimientos</p>
      </div>
    </div>
    <div class="header-right">
      <div class="nro-tramite">${data.nroTramite}</div>
      <div>Emisión: ${emision}</div>
      <div>Válido hasta: ${vencimiento}</div>
    </div>
  </div>

  <!-- Título -->
  <div class="cert-title">
    <h2>Certificado Digital</h2>
    <p>Documento oficial emitido por medios electrónicos — Ley 25.506 de Firma Digital</p>
  </div>

  <!-- Cuerpo -->
  <div class="cert-body">
    <p class="intro">Por medio del presente se certifica que</p>
    <div class="nombre">${data.nombreCompleto}</div>
    <p class="cuil">CUIL: ${data.cuil}</p>
    <p class="intro" style="margin: 12px 0 6px">ha solicitado y se le extiende el siguiente certificado:</p>
    <div class="tipo-cert">${data.tipoCertificado}</div>
  </div>

  <!-- Datos del certificado -->
  <div class="datos-grid">
    <div class="dato-card">
      <div class="label">Número de Trámite</div>
      <div class="value">${data.nroTramite}</div>
    </div>
    <div class="dato-card">
      <div class="label">CUIL del Titular</div>
      <div class="value">${data.cuil}</div>
    </div>
    <div class="dato-card">
      <div class="label">Fecha de Emisión</div>
      <div class="value">${emision}</div>
    </div>
    <div class="dato-card">
      <div class="label">Válido Hasta</div>
      <div class="value">${vencimiento}</div>
    </div>
  </div>

  <!-- Sello y firma -->
  <div class="footer-section">
    <div class="sello">
      <div>✦</div>
      <div>Organismo</div>
      <div>Oficial</div>
      <div>RDAM</div>
      <div>✦</div>
    </div>
    <div class="firma">
      <div class="linea-firma"></div>
      <div class="cargo">Autoridad Certificante</div>
      <div class="cargo">Sistema RDAM</div>
    </div>
  </div>

  <!-- Verificación -->
  <div class="verificacion">
    <strong>🔒 Verificación Digital</strong>
    <p>Este certificado puede verificarse en:</p>
    <div class="url">${verifyUrl}</div>
    <p style="margin-top:6px; font-size:0.65rem; color:#64748b">
      El enlace de verificación es único e intransferible. Vence el ${vencimiento}.
    </p>
  </div>

  <!-- Pie fijo -->
  <div class="page-footer">
    Documento generado digitalmente por el Sistema RDAM · ${data.nroTramite} ·
    Este documento tiene validez legal según Ley 25.506 de Firma Digital de la República Argentina
  </div>

</body>
</html>`;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('es-AR', {
      day:   '2-digit',
      month: 'long',
      year:  'numeric',
    });
  }
}
