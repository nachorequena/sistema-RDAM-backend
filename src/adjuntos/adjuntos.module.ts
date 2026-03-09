import {
  Controller, Post, Delete, Param, UseGuards, UseInterceptors,
  UploadedFile, ParseIntPipe, BadRequestException, Logger, Module,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { StorageService } from '../common/storage.service';
import { JwtCiudadanoGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/auth.decorator';
import * as crypto from 'crypto';
import { fileTypeFromBuffer } from 'file-type';
import { TipoAdjunto } from '@prisma/client';

const MIME_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_SIZE_BYTES   = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class AdjuntosService {
  private readonly logger = new Logger(AdjuntosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(file: Express.Multer.File, tipo: TipoAdjunto) {
    // 1. Verificar MIME real (file magic bytes, no la extensión ni el header HTTP)
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !MIME_PERMITIDOS.includes(detected.mime)) {
      throw new BadRequestException({
        code:    'TIPO_ARCHIVO_NO_PERMITIDO',
        message: `Tipo de archivo no permitido. Permitidos: PDF, JPG, PNG. Detectado: ${detected?.mime ?? 'desconocido'}`,
      });
    }

    // 2. Verificar tamaño
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException({
        code:    'ARCHIVO_DEMASIADO_GRANDE',
        message: `El archivo excede el límite de 5 MB (${(file.size / 1024 / 1024).toFixed(1)} MB recibidos)`,
      });
    }

    // 3. Generar nombre único con UUID
    const uuid     = crypto.randomUUID();
    const ext      = detected.ext;
    const filename = `${uuid}.${ext}`;

    // 4. Subir a storage y obtener checksum
    const { ruta, checksum } = await this.storage.uploadAdjunto(
      file.buffer,
      filename,
      detected.mime,
    );

    // 5. Registrar en BD con solicitud_id = NULL (Fase 1)
    const adjunto = await this.prisma.adjunto.create({
      data: {
        solicitudId:   null,
        tipo,
        nombreOrig:    file.originalname,
        rutaStorage:   ruta,
        mimeType:      detected.mime,
        tamanioBytes:  file.size,
        checksumSha256: checksum,
      },
    });

    this.logger.debug(`Adjunto subido: id=${adjunto.id}, ruta=${ruta}`);
    return adjunto;
  }

  async eliminar(id: number) {
    const adjunto = await this.prisma.adjunto.findUnique({ where: { id } });
    if (!adjunto) throw new BadRequestException('Adjunto no encontrado');
    if (adjunto.solicitudId !== null) {
      throw new BadRequestException({
        code:    'ADJUNTO_YA_ASOCIADO',
        message: 'No se puede eliminar un adjunto ya asociado a una solicitud',
      });
    }

    await this.storage.deleteFile(adjunto.rutaStorage, 'adjuntos');
    await this.prisma.adjunto.delete({ where: { id } });
    return { eliminado: true };
  }
}

@ApiTags('adjuntos')
@Controller('adjuntos')
export class AdjuntosController {
  constructor(private readonly service: AdjuntosService) {}

  @Post('upload')
  @UseGuards(JwtCiudadanoGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Sube un archivo adjunto (Fase 1 — antes de crear la solicitud)',
    description: 'Retorna adjunto_id para usar en POST /solicitudes',
  })
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: MAX_SIZE_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() _user: any,
  ) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    // El tipo se puede inferir o enviar como campo del formulario; por simplicidad lo marcamos como 'otro'
    // y el ciudadano puede especificarlo en el body o query param
    const adjunto = await this.service.upload(file, 'otro');
    return { data: adjunto, message: 'Archivo subido. Guardá el id para asociarlo a tu solicitud.' };
  }

  @Delete(':id')
  @UseGuards(JwtCiudadanoGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elimina un adjunto no asociado a ninguna solicitud' })
  async eliminar(@Param('id', ParseIntPipe) id: number) {
    return { data: await this.service.eliminar(id) };
  }
}

@Module({
  providers: [AdjuntosService, StorageService],
  controllers: [AdjuntosController],
  exports: [AdjuntosService],
})
export class AdjuntosModule {}
