import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucketAdjuntos: string;
  private readonly bucketPdfs: string;

  constructor(private readonly config: ConfigService) {
    this.s3 = new S3Client({
      endpoint:       config.get<string>('STORAGE_ENDPOINT'),
      region:         config.get<string>('STORAGE_REGION', 'us-east-1'),
      credentials: {
        accessKeyId:     config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('STORAGE_SECRET_KEY'),
      },
      forcePathStyle: config.get<boolean>('STORAGE_FORCE_PATH_STYLE', true),
    });

    this.bucketAdjuntos = config.get<string>('STORAGE_BUCKET_ADJUNTOS', 'rdam-adjuntos');
    this.bucketPdfs     = config.get<string>('STORAGE_BUCKET_PDFS', 'rdam-pdfs');
  }

  /**
   * Sube un adjunto al bucket de adjuntos.
   * Retorna la ruta relativa para guardar en BD.
   */
  async uploadAdjunto(
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<{ ruta: string; checksum: string }> {
    const now = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day   = String(now.getDate()).padStart(2, '0');
    const ruta  = `adjuntos/${year}/${month}/${day}/${filename}`;

    const checksum = createHash('sha256').update(buffer).digest('hex');

    await this.s3.send(new PutObjectCommand({
      Bucket:      this.bucketAdjuntos,
      Key:         ruta,
      Body:        buffer,
      ContentType: mimeType,
      Metadata: {
        'sha256': checksum,
      },
    }));

    this.logger.debug(`Adjunto subido: ${ruta}`);
    return { ruta, checksum };
  }

  /**
   * Sube un PDF generado al bucket de PDFs.
   * Retorna la ruta relativa para guardar en BD.
   */
  async uploadPdf(buffer: Buffer, nroTramite: string): Promise<string> {
    const now = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const ruta  = `pdfs/${year}/${month}/${nroTramite}.pdf`;

    await this.s3.send(new PutObjectCommand({
      Bucket:      this.bucketPdfs,
      Key:         ruta,
      Body:        buffer,
      ContentType: 'application/pdf',
    }));

    this.logger.debug(`PDF subido: ${ruta}`);
    return ruta;
  }

  /**
   * Descarga un archivo del storage y retorna su contenido como Buffer.
   */
  async downloadFile(ruta: string, bucket: 'adjuntos' | 'pdfs'): Promise<Buffer> {
    const bucketName = bucket === 'pdfs' ? this.bucketPdfs : this.bucketAdjuntos;

    const response = await this.s3.send(new GetObjectCommand({
      Bucket: bucketName,
      Key:    ruta,
    }));

    const stream = response.Body as Readable;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end',  () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Genera una URL presignada para descarga directa (adjuntos en panel admin).
   * Válida por 15 minutos.
   */
  async getPresignedUrl(ruta: string, bucket: 'adjuntos' | 'pdfs'): Promise<string> {
    const bucketName = bucket === 'pdfs' ? this.bucketPdfs : this.bucketAdjuntos;
    const command = new GetObjectCommand({ Bucket: bucketName, Key: ruta });
    return getSignedUrl(this.s3, command, { expiresIn: 900 }); // 15 min
  }

  /**
   * Elimina un archivo del storage. Silencia errores si no existe.
   */
  async deleteFile(ruta: string, bucket: 'adjuntos' | 'pdfs'): Promise<void> {
    const bucketName = bucket === 'pdfs' ? this.bucketPdfs : this.bucketAdjuntos;
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: ruta }));
      this.logger.debug(`Archivo eliminado: ${ruta}`);
    } catch (error) {
      this.logger.warn(`No se pudo eliminar ${ruta}: ${error.message}`);
    }
  }

  /**
   * Verifica si un archivo existe en el storage.
   */
  async fileExists(ruta: string, bucket: 'adjuntos' | 'pdfs'): Promise<boolean> {
    const bucketName = bucket === 'pdfs' ? this.bucketPdfs : this.bucketAdjuntos;
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: ruta }));
      return true;
    } catch {
      return false;
    }
  }
}
