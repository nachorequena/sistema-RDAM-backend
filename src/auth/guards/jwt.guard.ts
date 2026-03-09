import {
  Injectable,
  ExecutionContext,
  CanActivate,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { RolInterno } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/auth.decorator';

@Injectable()
export class JwtCiudadanoGuard extends AuthGuard('jwt-ciudadano') {}

@Injectable()
export class JwtInternoGuard extends AuthGuard('jwt-interno') {}

@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}

/**
 * Guard de roles: aplica DESPUÉS de JwtInternoGuard.
 * Ejemplo de uso:
 *   @UseGuards(JwtInternoGuard, RolesGuard)
 *   @Roles(RolInterno.admin)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RolInterno[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles.includes(user?.rol)) {
      throw new ForbiddenException('No tenés permisos para realizar esta acción');
    }
    return true;
  }
}
