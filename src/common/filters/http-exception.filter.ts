import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

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
