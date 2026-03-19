import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    // Mapeo específico para errores de Prisma (DB) a respuestas amigables
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Known DB constraint or related errors
      let statusPrisma = HttpStatus.BAD_REQUEST;
      let msg = 'Error en la base de datos';
      let code = 'DB_ERROR';
      let fields: Record<string, string> | undefined;

      switch ((exception as any).code) {
        case 'P2002': // Unique constraint
          statusPrisma = HttpStatus.BAD_REQUEST;
          msg = 'Ya existe un registro con el valor proporcionado.';
          code = 'DB_UNIQUE_CONSTRAINT';
          // Prisma suele exponer target (campos) en meta
          if ((exception as any).meta?.target) {
            const target = (exception as any).meta.target as string[];
            fields = {};
            target.forEach((t: string) => (fields![t] = 'valor duplicado'));
          }
          break;
        case 'P2003': // Foreign key constraint
          statusPrisma = HttpStatus.BAD_REQUEST;
          msg = 'Registro relacionado no encontrado (clave externa inválida).';
          code = 'DB_FOREIGN_KEY';
          break;
        case 'P2025': // Record not found for action
          statusPrisma = HttpStatus.NOT_FOUND;
          msg = 'Registro no encontrado.';
          code = 'DB_RECORD_NOT_FOUND';
          break;
        default:
          statusPrisma = HttpStatus.INTERNAL_SERVER_ERROR;
          msg = 'Error interno de base de datos.';
          code = 'DB_ERROR';
      }

      // Loguear como error crítico cuando sea 5xx
      if (statusPrisma >= 500) {
        this.logger.error(
          `${request.method} ${request.url} → ${statusPrisma} (Prisma)`,
          exception instanceof Error ? exception.stack : String(exception),
        );
      }

      response.status(statusPrisma).json({
        error: { code, message: msg, ...(fields ? { fields } : {}) },
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Error interno del servidor';
    let code    = 'INTERNAL_ERROR';
    let fields: Record<string, string> | undefined;

    if (exception instanceof HttpException) {
      const res = exception.getResponse() as any;
      if (typeof res === 'string') {
        message = res;
      } else {
        message = res.message ?? message;
        code    = res.code ?? code;
        fields  = res.fields;

        // class-validator devuelve array de errores
        if (Array.isArray(message)) {
          fields  = {};
          message = 'Errores de validación';
          code    = 'VALIDATION_ERROR';
          (res.message as string[]).forEach((m) => {
            const [field, ...rest] = m.split(' ');
            fields![field] = rest.join(' ');
          });
        }
      }
    }

    // No loguear 401/403 como errores — son flujos normales
    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
      },
      path:      request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
