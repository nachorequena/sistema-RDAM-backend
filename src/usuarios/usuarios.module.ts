import {
  Controller, Get, Post, Patch, Param, Body, Query, Delete,
  UseGuards, ParseIntPipe, HttpCode, HttpStatus,
  Injectable, BadRequestException, NotFoundException,
  Logger, ForbiddenException, Module,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsEmail, IsEnum, IsOptional, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../config/prisma.service';
import { JwtInternoGuard, RolesGuard } from '../auth/guards/jwt.guard';
import { CurrentUser, Roles } from '../common/decorators/auth.decorator';
import { RolInterno } from '@prisma/client';

// ── DTOs ────────────────────────────────────────────────────────────────────

class CrearUsuarioDto {
  @ApiProperty({ example: 'María González' })
  @IsString()
  nombre: string;

  @ApiProperty({ example: 'maria@rdam.gob.ar' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Pass1234!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ enum: RolInterno })
  @IsEnum(RolInterno)
  rol: RolInterno;
}

class ActualizarUsuarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ enum: RolInterno })
  @IsOptional()
  @IsEnum(RolInterno)
  rol?: RolInterno;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  activo?: boolean;
}

class CambiarPasswordDto {
  @ApiProperty({ example: 'NuevaPass456!' })
  @IsString()
  @MinLength(8)
  nuevaPassword: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class UsuariosService {
  private readonly logger = new Logger(UsuariosService.name);

  constructor(private readonly prisma: PrismaService) {}

  private readonly SELECT_SEGURO = {
    id:         true,
    nombre:     true,
    email:      true,
    rol:        true,
    activo:     true,
    ultimoLogin: true,
    updatedBy:  true,
    deletedAt:  true,
    deletedById: true,
    createdAt:  true,
    updatedAt:  true,
    // passwordHash: NUNCA se expone
  };

  async listar(soloActivos = true) {
    return this.prisma.usuarioInterno.findMany({
      where:   soloActivos ? { activo: true, deletedAt: null } : {},
      select:  this.SELECT_SEGURO,
      orderBy: { nombre: 'asc' },
    });
  }

  async crear(dto: CrearUsuarioDto, adminId: number) {
    const existente = await this.prisma.usuarioInterno.findUnique({
      where: { email: dto.email },
    });
    if (existente) {
      throw new BadRequestException({
        code:    'EMAIL_DUPLICADO',
        message: `Ya existe un usuario con el email ${dto.email}`,
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const usuario = await this.prisma.usuarioInterno.create({
      data: {
        nombre: dto.nombre,
        email:  dto.email,
        passwordHash,
        rol:    dto.rol,
        updatedById: adminId,
      },
      select: this.SELECT_SEGURO,
    });

    this.logger.log(`Usuario creado: ${dto.email} (admin: ${adminId})`);
    return usuario;
  }

  async actualizar(id: number, dto: ActualizarUsuarioDto, adminId: number) {
    const usuario = await this.prisma.usuarioInterno.findUnique({ where: { id } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    // Protección: el admin no puede desactivarse a sí mismo
    if (id === adminId && dto.activo === false) {
      throw new ForbiddenException('No podés desactivar tu propia cuenta');
    }

    const actualizado = await this.prisma.usuarioInterno.update({
      where: { id },
      data:  { ...dto, updatedById: adminId },
      select: this.SELECT_SEGURO,
    });

    this.logger.log(`Usuario ${id} actualizado por admin ${adminId}`);
    return actualizado;
  }

  async cambiarPassword(id: number, dto: CambiarPasswordDto, adminId: number) {
    const usuario = await this.prisma.usuarioInterno.findUnique({ where: { id } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    const passwordHash = await bcrypt.hash(dto.nuevaPassword, 12);
    await this.prisma.usuarioInterno.update({
      where: { id },
      data:  { passwordHash, updatedById: adminId },
    });

    this.logger.log(`Password de usuario ${id} cambiada por admin ${adminId}`);
    return { cambiada: true };
  }

  async eliminar(id: number, adminId: number) {
    const usuario = await this.prisma.usuarioInterno.findUnique({ where: { id } });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    if (id === adminId) {
      throw new ForbiddenException('No podés eliminar tu propia cuenta');
    }

    // Soft delete
    await this.prisma.usuarioInterno.update({
      where: { id },
      data:  {
        activo:     false,
        deletedAt:  new Date(),
        deletedById: adminId,
        updatedById: adminId,
      },
    });

    this.logger.log(`Usuario ${id} eliminado (soft) por admin ${adminId}`);
    return { eliminado: true };
  }
}

// ── Controller ───────────────────────────────────────────────────────────────

@ApiTags('usuarios')
@Controller('usuarios')
@UseGuards(JwtInternoGuard, RolesGuard)
@Roles(RolInterno.admin)
@ApiBearerAuth()
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Get()
  @ApiOperation({ summary: 'Lista usuarios internos (solo admin)' })
  async listar(@Query('todos') todos?: string) {
    return { data: await this.service.listar(todos !== 'true') };
  }

  @Post()
  @ApiOperation({ summary: 'Crea un nuevo usuario interno (solo admin)' })
  async crear(@Body() dto: CrearUsuarioDto, @CurrentUser() user: any) {
    return { data: await this.service.crear(dto, user.id), message: 'Usuario creado' };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualiza datos o rol de un usuario (solo admin)' })
  async actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarUsuarioDto,
    @CurrentUser() user: any,
  ) {
    return { data: await this.service.actualizar(id, dto, user.id) };
  }

  @Patch(':id/cambiar-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fuerza cambio de contraseña (solo admin)' })
  async cambiarPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CambiarPasswordDto,
    @CurrentUser() user: any,
  ) {
    return { data: await this.service.cambiarPassword(id, dto, user.id) };
  }

  @Patch(':id/eliminar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete de usuario (solo admin)' })
  async eliminar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return { data: await this.service.eliminar(id, user.id), message: 'Usuario dado de baja' };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alias: Soft delete de usuario (DELETE) (solo admin)' })
  async eliminarDelete(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return { data: await this.service.eliminar(id, user.id), message: 'Usuario dado de baja' };
  }
}

// ── Module ───────────────────────────────────────────────────────────────────

@Module({
  providers:   [UsuariosService],
  controllers: [UsuariosController],
})
export class UsuariosModule {}
