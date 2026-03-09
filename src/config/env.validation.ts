import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsString() DATABASE_URL: string;
  @IsString() JWT_SECRET: string;
  @IsString() JWT_REFRESH_SECRET: string;
  @IsString() PLUSPAGOS_SECRET_KEY: string;
  @IsString() PLUSPAGOS_MERCHANT_GUID: string;
  @IsEnum(Environment) NODE_ENV: Environment;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`❌ Configuración de entorno inválida:\n${errors.toString()}`);
  }
  return validatedConfig;
}
