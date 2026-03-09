import { Module } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { PagosController } from './pagos.controller';
import { PluspagosService } from './pluspagos.service';
import { EmailService } from '../common/email.service';

@Module({
  providers: [PagosService, PluspagosService, EmailService],
  controllers: [PagosController],
  exports: [PagosService, PluspagosService],
})
export class PagosModule {}
