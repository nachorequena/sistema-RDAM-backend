import { Module } from '@nestjs/common';
import { SolicitudesService } from './solicitudes.service';
import { SolicitudesController } from './solicitudes.controller';
import { PagosModule } from '../pagos/pagos.module';
import { EmailService } from '../common/email.service';

@Module({
  imports:     [PagosModule],
  providers:   [SolicitudesService, EmailService],
  controllers: [SolicitudesController],
  exports:     [SolicitudesService],
})
export class SolicitudesModule {}
