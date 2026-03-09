import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SolicitarOtpDto {
  @ApiProperty({ example: 'juan@ejemplo.com' })
  @IsEmail({}, { message: 'El email no tiene un formato válido' })
  email: string;
}

export class VerificarOtpDto {
  @ApiProperty({ example: 'juan@ejemplo.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '123456', description: 'Código OTP de 6 dígitos' })
  @IsString()
  @Length(6, 6, { message: 'El código debe tener exactamente 6 dígitos' })
  @Matches(/^\d{6}$/, { message: 'El código debe ser numérico' })
  codigo: string;
}

export class LoginInternoDto {
  @ApiProperty({ example: 'gestor@rdam.gob.ar' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Admin1234!' })
  @IsString()
  @Length(8, 100)
  password: string;
}
