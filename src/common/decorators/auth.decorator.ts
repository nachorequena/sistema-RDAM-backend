import { SetMetadata } from '@nestjs/common';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RolInterno } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: RolInterno[]) => SetMetadata(ROLES_KEY, roles);

/** Extrae el usuario autenticado del request */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);

/** Extrae la IP real del cliente (considera proxies) */
export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return (
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
      request.connection.remoteAddress ??
      'unknown'
    );
  },
);
