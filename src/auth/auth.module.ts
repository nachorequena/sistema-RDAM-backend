import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtCiudadanoStrategy, JwtInternoStrategy, JwtRefreshStrategy } from './strategies/jwt.strategy';
import { JwtCiudadanoGuard, JwtInternoGuard, JwtRefreshGuard, RolesGuard } from './guards/jwt.guard';
import { EmailService } from '../common/email.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}), // secrets se pasan por opción en cada sign()
  ],
  providers: [
    AuthService,
    EmailService,
    JwtCiudadanoStrategy,
    JwtInternoStrategy,
    JwtRefreshStrategy,
    JwtCiudadanoGuard,
    JwtInternoGuard,
    JwtRefreshGuard,
    RolesGuard,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    JwtCiudadanoGuard,
    JwtInternoGuard,
    RolesGuard,
    EmailService,
  ],
})
export class AuthModule {}
