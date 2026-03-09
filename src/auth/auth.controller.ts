import {
  Controller, Post, Body, Res, UseGuards, HttpCode, HttpStatus, Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtRefreshGuard } from './guards/jwt.guard';
import { CurrentUser } from '../common/decorators/auth.decorator';
import {
  SolicitarOtpDto, VerificarOtpDto, LoginInternoDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── OTP Ciudadano ─────────────────────────────────────────────────────────

  @Post('otp/solicitar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 600_000 } }) // máx 3 por 10 min
  @ApiOperation({ summary: 'Solicita un código OTP por email (ciudadano)' })
  @ApiResponse({ status: 200, description: 'OTP enviado al email' })
  async solicitarOtp(@Body() dto: SolicitarOtpDto) {
    await this.authService.solicitarOtp(dto.email);
    return { data: null, message: 'Código enviado. Revisá tu email.' };
  }

  @Post('otp/verificar')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({ summary: 'Verifica el OTP y emite JWT ciudadano' })
  async verificarOtp(
    @Body() dto: VerificarOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.verificarOtp(dto.email, dto.codigo);
    this.setRefreshCookie(res, tokens.refresh_token);
    return {
      data: { access_token: tokens.access_token, expires_in: 7200 },
      message: 'Sesión iniciada correctamente',
    };
  }

  // ── Login Interno ─────────────────────────────────────────────────────────

  @Post('interno/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login para gestores y admins internos' })
  async loginInterno(
    @Body() dto: LoginInternoDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginInterno(dto.email, dto.password);
    this.setRefreshCookie(res, result.refresh_token);
    return {
      data: {
        access_token: result.access_token,
        rol:    result.rol,
        nombre: result.nombre,
        expires_in: 28800,
      },
    };
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renueva el access token usando el refresh token (cookie)' })
  async refresh(
    @CurrentUser() payload: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refreshToken(payload);
    return { data: { access_token: result.access_token } };
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cierra la sesión (limpia el refresh token cookie)' })
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('refresh_token');
    return { data: null, message: 'Sesión cerrada' };
  }

  // ── Helper ────────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie('refresh_token', token, {
      httpOnly:  true,
      secure:    process.env.NODE_ENV === 'production',
      sameSite:  'strict',
      maxAge:    7 * 24 * 60 * 60 * 1000, // 7 días en ms
      path:      '/api/auth/refresh',
    });
  }
}
