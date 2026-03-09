import { IsString, IsOptional, IsInt, IsEnum, MinLength, Min, Max } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { SolEstado } from '@prisma/client';

export class ListarSolicitudesInternoDto {
  @ApiPropertyOptional({ enum: SolEstado })
  @IsOptional()
  @IsEnum(SolEstado)
  estado?: SolEstado;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  tipoCertId?: number;

  @ApiPropertyOptional({ example: '20-34567890-1' })
  @IsOptional()
  @IsString()
  cuil?: string;

  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2025-12-31' })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class RechazarDto {
  @ApiProperty({
    example: 'La documentación adjuntada no es válida porque no cumple con los requisitos mínimos.',
    description: 'Mínimo 20 caracteres',
  })
  @IsString()
  @MinLength(20, { message: 'La observación debe tener al menos 20 caracteres' })
  observacion: string;
}

export class PublicarDto {
  // Por el momento no requiere body adicional.
  // Extendible para agregar campos como observación del operador.
}
