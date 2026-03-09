import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

  // ── Seguridad ────────────────────────────────────────────────────────────
  app.use(helmet());
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // ── Pipes globales ───────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,         // elimina propiedades no declaradas en DTOs
      forbidNonWhitelisted: true,
      transform: true,         // convierte tipos automáticamente (string → number)
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Filtros e interceptores globales ─────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  app.setGlobalPrefix('api');

  // ── Swagger ──────────────────────────────────────────────────────────────
  if (configService.get('NODE_ENV') !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('RDAM API')
      .setDescription('Sistema de Gestión de Solicitudes y Certificados Digitales')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Autenticación ciudadano e interno')
      .addTag('solicitudes', 'Gestión de solicitudes ciudadano')
      .addTag('adjuntos', 'Upload de archivos adjuntos')
      .addTag('pagos', 'Webhook PlusPagos y flujo de pago')
      .addTag('gestion', 'Panel administrativo interno')
      .addTag('certificados', 'Descarga de certificados por token')
      .addTag('usuarios', 'ABM de usuarios internos')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
    console.log(`📚 Swagger: http://localhost:${port}/api/docs`);
  }

  await app.listen(port);
  console.log(`🚀 RDAM Backend corriendo en: http://localhost:${port}/api`);
}

bootstrap();
