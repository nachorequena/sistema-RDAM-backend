import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './config/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SolicitudesModule } from './solicitudes/solicitudes.module';
import { AdjuntosModule } from './adjuntos/adjuntos.module';
import { PagosModule } from './pagos/pagos.module';
import { GestionModule } from './gestion/gestion.module';
import { CertificadosModule } from './certificados/certificados.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { JobsModule } from './jobs/jobs.module';
import { validate } from './config/env.validation';

@Module({
  imports: [
    // ── Configuración global ──────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Rate limiting ─────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // ── Scheduler para jobs de vencimiento ───────────────────────────────
    ScheduleModule.forRoot(),

    // ── Infraestructura ───────────────────────────────────────────────────
    PrismaModule,

    // ── Módulos de dominio ────────────────────────────────────────────────
    AuthModule,
    SolicitudesModule,
    AdjuntosModule,
    PagosModule,
    GestionModule,
    CertificadosModule,
    UsuariosModule,
    JobsModule,
  ],
})
export class AppModule {}
