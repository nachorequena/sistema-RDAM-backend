import {
  Controller, Get, Param, Res, NotFoundException,
  GoneException, Logger, Injectable, Module,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../config/prisma.service';
import { StorageService } from '../common/storage.service';

@Injectable()
export class CertificadosService {
  private readonly logger = new Logger(CertificadosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async descargar(token: string): Promise<{ buffer: Buffer; nroTramite: string }> {
    // NUNCA loguear el token completo — seguridad
    this.logger.debug(`Descarga solicitada para token: ${token.substring(0, 8)}...`);

    const solicitud = await this.prisma.solicitud.findFirst({
      where: { tokenPdf: token },
      select: {
        id:            true,
        nroTramite:    true,
        solEstado:     true,
        rutaPdf:       true,
        fecVencimiento: true,
        tokenPdf:      true,
      },
    });

    if (!solicitud || !solicitud.rutaPdf) {
      throw new NotFoundException('Certificado no encontrado');
    }

    // Verificar que no esté vencido
    if (solicitud.solEstado === 'publicado_vencido') {
      throw new GoneException({
        code:    'CERTIFICADO_VENCIDO',
        message: 'El enlace de descarga ha vencido. Contactate con el organismo para regenerarlo.',
      });
    }

    if (solicitud.solEstado !== 'publicado') {
      throw new NotFoundException('Certificado no disponible');
    }

    // Doble verificación de vencimiento (por si el job aún no corrió)
    if (solicitud.fecVencimiento && new Date() > solicitud.fecVencimiento) {
      this.logger.warn(`Token vencido pero sol_estado aún es publicado: ${solicitud.nroTramite}`);
      throw new GoneException({
        code:    'CERTIFICADO_VENCIDO',
        message: 'El enlace de descarga ha vencido.',
      });
    }

    const buffer = await this.storage.downloadFile(solicitud.rutaPdf, 'pdfs');
    return { buffer, nroTramite: solicitud.nroTramite };
  }
}

@ApiTags('certificados')
@Controller('certificados')
export class CertificadosController {
  constructor(private readonly service: CertificadosService) {}

  /**
   * GET /api/certificados/:token
   * Endpoint público — el ciudadano accede con el token del email.
   * Retorna el PDF directamente como descarga.
   * No requiere autenticación: el token es la credencial.
   */
  @Get(':token')
  @ApiOperation({
    summary: 'Descarga pública de certificado por token seguro',
    description:
      'Retorna el PDF del certificado. El token es único y vence según la configuración del tipo de certificado. ' +
      'Nunca se loguea el token completo por seguridad.',
  })
  async descargar(@Param('token') token: string, @Res() res: Response) {
    const { buffer, nroTramite } = await this.service.descargar(token);

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${nroTramite}.pdf"`,
      'Content-Length':      buffer.length,
      'Cache-Control':       'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });

    res.send(buffer);
  }
}

@Module({
  providers:   [CertificadosService, StorageService],
  controllers: [CertificadosController],
})
export class CertificadosModule {}
