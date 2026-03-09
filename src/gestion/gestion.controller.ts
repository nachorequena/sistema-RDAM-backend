import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, ParseIntPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GestionService } from './gestion.service';
import { JwtInternoGuard, RolesGuard } from '../auth/guards/jwt.guard';
import { CurrentUser, Roles } from '../common/decorators/auth.decorator';
import { ListarSolicitudesInternoDto, RechazarDto, PublicarDto } from './dto/gestion.dto';
import { RolInterno } from '@prisma/client';

@ApiTags('gestion')
@Controller('gestion')
@UseGuards(JwtInternoGuard)
@ApiBearerAuth()
export class GestionController {
  constructor(private readonly gestionService: GestionService) {}

  @Get('solicitudes')
  @ApiOperation({ summary: 'Lista solicitudes con filtros — panel administrativo' })
  async listar(@Query() dto: ListarSolicitudesInternoDto) {
    return this.gestionService.listar(dto);
  }

  @Get('solicitudes/:id')
  @ApiOperation({ summary: 'Detalle completo de una solicitud con adjuntos y historial' })
  async detalle(@Param('id', ParseIntPipe) id: number) {
    return { data: await this.gestionService.detalle(id) };
  }

  @Patch('solicitudes/:id/tomar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toma una solicitud para revisión (PAGADO → EN_REVISION)' })
  async tomar(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return {
      data:    await this.gestionService.tomar(id, user.id),
      message: 'Solicitud tomada para revisión',
    };
  }

  @Patch('solicitudes/:id/rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechaza una solicitud con observación obligatoria' })
  async rechazar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RechazarDto,
    @CurrentUser() user: any,
  ) {
    return {
      data:    await this.gestionService.rechazar(id, dto, user.id),
      message: 'Solicitud rechazada. El ciudadano fue notificado por email.',
    };
  }

  @Patch('solicitudes/:id/publicar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Genera el PDF y publica el certificado (EN_REVISION → PUBLICADO)' })
  async publicar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublicarDto,
    @CurrentUser() user: any,
  ) {
    return {
      data:    await this.gestionService.publicar(id, dto, user.id),
      message: 'Certificado generado y enviado al ciudadano por email.',
    };
  }

  @Post('solicitudes/:id/regenerar-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Regenera el token PDF para un certificado vencido (PUBLICADO_VENCIDO → PUBLICADO)' })
  async regenerarToken(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return {
      data:    await this.gestionService.regenerarToken(id, user.id),
      message: 'Token regenerado. El ciudadano recibió el nuevo enlace por email.',
    };
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Métricas del dashboard por estado' })
  async dashboard() {
    return { data: await this.gestionService.getDashboard() };
  }
}
