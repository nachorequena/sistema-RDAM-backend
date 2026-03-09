import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';

export interface JwtPayload {
  sub: string | number;
  email: string;
  type: 'ciudadano' | 'interno';
  rol?: string;
  iat?: number;
  exp?: number;
}

/**
 * Estrategia JWT para ciudadanos autenticados via OTP.
 * El `sub` es el email del ciudadano.
 */
@Injectable()
export class JwtCiudadanoStrategy extends PassportStrategy(Strategy, 'jwt-ciudadano') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type !== 'ciudadano') throw new UnauthorizedException();
    return { email: payload.email, type: 'ciudadano' };
  }
}

/**
 * Estrategia JWT para usuarios internos (gestor / admin).
 * El `sub` es el id numérico del usuario_interno.
 */
@Injectable()
export class JwtInternoStrategy extends PassportStrategy(Strategy, 'jwt-interno') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type !== 'interno') throw new UnauthorizedException();

    const user = await this.prisma.usuarioInterno.findFirst({
      where: {
        id:         Number(payload.sub),
        activo:     true,
        deletedAt:  null,
      },
      select: { id: true, email: true, rol: true, nombre: true },
    });

    if (!user) throw new UnauthorizedException('Usuario inactivo o no encontrado');
    return user;
  }
}

/**
 * Estrategia para el refresh token (cookie HttpOnly).
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest:   ExtractJwt.fromExtractors([
        (req) => req?.cookies?.['refresh_token'],
      ]),
      ignoreExpiration: false,
      secretOrKey:      config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    return payload;
  }
}
