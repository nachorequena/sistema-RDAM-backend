// ── DTOs ─────────────────────────────────────────────────────────────────────
import { IsString, IsEmail, IsInt, IsOptional, IsArray, Matches, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CrearSolicitudDto {
  @ApiProperty({ example: '20-34567890-1' })
  @IsString()
  @Matches(/^\d{2}-\d{8}-\d{1}$/, { message: 'CUIL debe tener formato XX-XXXXXXXX-X' })
  cuil: string;

  @ApiProperty({ example: 'Juan Carlos Pérez' })
  @IsString()
  nombreCompleto: string;

  @ApiProperty({ example: 'juan@ejemplo.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: '+54911234567' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiProperty({ example: 1, description: 'ID del tipo de certificado' })
  @IsInt()
  @Min(1)
  tipoCertId: number;

  @ApiPropertyOptional({ type: [Number], description: 'IDs de adjuntos previamente subidos' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  adjuntoIds?: number[];
}

export class ConsultaPublicaDto {
  @ApiPropertyOptional({ example: 'RDAM-20250320-0001' })
  @IsOptional()
  @IsString()
  nroTramite?: string;

  @ApiPropertyOptional({ example: '20-34567890-1' })
  @IsOptional()
  @IsString()
  cuil?: string;
}

export class PaginacionDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
