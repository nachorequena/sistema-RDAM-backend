import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from '../common/email.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  // ── OTP Ciudadano ─────────────────────────────────────────────────────────

  async solicitarOtp(emailCiudadano: string): Promise<void> {
    // Eliminar OTPs anteriores del mismo email para evitar acumulación
    await this.prisma.otpCiudadano.deleteMany({
      where: { email: emailCiudadano, usado: false },
    });

    const codigo = String(Math.floor(100000 + Math.random() * 900000)); // 6 dígitos
    const expiraAt = new Date(Date.now() + (this.config.get<number>('OTP_EXPIRY_MINUTES', 10)) * 60_000);

    await this.prisma.otpCiudadano.create({
      data: { email: emailCiudadano, codigo, expiraAt },
    });

    await this.email.sendOtp(emailCiudadano, codigo);
    this.logger.debug(`OTP enviado a ${emailCiudadano} — código: ${codigo}`);
  }

  async verificarOtp(
    emailCiudadano: string,
    codigo: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const otp = await this.prisma.otpCiudadano.findFirst({
      where: {
        email: emailCiudadano,
        usado: false,
        expiraAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new UnauthorizedException('Código inválido o expirado');
    }

    const maxIntentos = this.config.get<number>('OTP_MAX_ATTEMPTS', 3);
    if (otp.intentos >= maxIntentos) {
      throw new ForbiddenException('Cuenta bloqueada por demasiados intentos');
    }

    if (otp.codigo !== codigo) {
      await this.prisma.otpCiudadano.update({
        where: { id: otp.id },
        data:  { intentos: { increment: 1 } },
      });
      const restantes = maxIntentos - otp.intentos - 1;
      throw new UnauthorizedException(`Código incorrecto. ${restantes} intento(s) restantes`);
    }

    // Marcar como usado
    await this.prisma.otpCiudadano.update({
      where: { id: otp.id },
      data:  { usado: true },
    });

    return this.emitirTokenesCiudadano(emailCiudadano);
  }

  private emitirTokenesCiudadano(email: string) {
    const payload = { sub: email, email, type: 'ciudadano' };

    const access_token = this.jwtService.sign(payload, {
      secret:    this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRY_CITIZEN', '2h'),
    });

    const refresh_token = this.jwtService.sign(payload, {
      secret:    this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRY', '7d'),
    });

    return { access_token, refresh_token };
  }

  // ── Login Interno ─────────────────────────────────────────────────────────

  async loginInterno(
    emailUsuario: string,
    password: string,
  ): Promise<{ access_token: string; refresh_token: string; rol: string; nombre: string }> {
    const user = await this.prisma.usuarioInterno.findFirst({
      where: { email: emailUsuario, activo: true, deletedAt: null },
    });

    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Credenciales inválidas');

    // Registrar último login
    await this.prisma.usuarioInterno.update({
      where: { id: user.id },
      data:  { ultimoLogin: new Date() },
    });

    const payload = { sub: user.id, email: user.email, type: 'interno', rol: user.rol };

    const access_token = this.jwtService.sign(payload, {
      secret:    this.config.get('JWT_SECRET'),
      expiresIn: this.config.get('JWT_EXPIRY_INTERNAL', '8h'),
    });

    const refresh_token = this.jwtService.sign(payload, {
      secret:    this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_EXPIRY', '7d'),
    });

    return { access_token, refresh_token, rol: user.rol, nombre: user.nombre };
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  async refreshToken(payload: any): Promise<{ access_token: string }> {
    const secret = payload.type === 'interno'
      ? this.config.get('JWT_SECRET')
      : this.config.get('JWT_SECRET');

    const expiry = payload.type === 'interno'
      ? this.config.get('JWT_EXPIRY_INTERNAL', '8h')
      : this.config.get('JWT_EXPIRY_CITIZEN', '2h');

    const access_token = this.jwtService.sign(
      { sub: payload.sub, email: payload.email, type: payload.type, rol: payload.rol },
      { secret, expiresIn: expiry },
    );

    return { access_token };
  }
}
