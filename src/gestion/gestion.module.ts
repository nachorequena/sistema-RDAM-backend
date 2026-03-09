import { Module } from '@nestjs/common';
import { GestionService } from './gestion.service';
import { GestionController } from './gestion.controller';
import { EmailService } from '../common/email.service';
import { StorageService } from '../common/storage.service';
import { PdfService } from '../common/pdf.service';

@Module({
  providers:   [GestionService, EmailService, StorageService, PdfService],
  controllers: [GestionController],
  exports:     [GestionService],
})
export class GestionModule {}
