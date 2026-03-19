import {
  Controller, Get, Post, Body, Param, Query,
  UseGuards, ParseIntPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SolicitudesService } from './solicitudes.service';
import { PagosService } from '../pagos/pagos.service';
import { PrismaService } from '../config/prisma.service';
import { JwtCiudadanoGuard } from '../auth/guards/jwt.guard';
import { CurrentUser } from '../common/decorators/auth.decorator';
import { CrearSolicitudDto, ConsultaPublicaDto, PaginacionDto } from './dto/solicitudes.dto';

@ApiTags('solicitudes')
@Controller('solicitudes')
export class SolicitudesController {
  constructor(
    private readonly solicitudesService: SolicitudesService,
    private readonly pagosService: PagosService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @UseGuards(JwtCiudadanoGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crea una nueva solicitud (ciudadano autenticado)' })
  async crear(@Body() dto: CrearSolicitudDto, @CurrentUser() user: any) {
    const solicitud = await this.solicitudesService.crear(dto, user.email);
    return {
      data:    solicitud,
      message: 'Solicitud creada correctamente. Procedé al pago para continuar.',
    };
  }

  @Get()
  @UseGuards(JwtCiudadanoGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lista las solicitudes del ciudadano autenticado' })
  async listarMias(@CurrentUser() user: any, @Query() query: PaginacionDto) {
    return this.solicitudesService.listarMias(user.email, query.page, query.limit);
  }

  @Get('estado')
  @ApiOperation({ summary: 'Consulta pública de estado por nro_tramite o cuil' })
  async consultaPublica(@Query() query: ConsultaPublicaDto) {
    return {
      data: await this.solicitudesService.consultaPublica(query.nroTramite, query.cuil),
    };
  }

  @Get('tipos-certificado')
  async tiposCertificado() {
    const tipos = await this.prisma.tipoCertificado.findMany({
      where: { activo: true },
      orderBy: { id: 'asc' },
    });
    return { data: tipos };
  }

  @Get(':id')
  @UseGuards(JwtCiudadanoGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalle de una solicitud del ciudadano' })
  async detalle(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return { data: await this.solicitudesService.detalle(id, user.email) };
  }

  /**
   * Retorna el payload encriptado para que el frontend
   * haga POST automático (form submit) a PlusPagos.
   */
  @Post(':nroTramite/iniciar-pago')
  @UseGuards(JwtCiudadanoGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Genera el payload encriptado para redirigir a PlusPagos' })
  async iniciarPago(
    @Param('nroTramite') nroTramite: string,
    @CurrentUser() user: any,
  ) {
    const payload = await this.pagosService.generarPayloadPago(nroTramite, user.email);
    return { data: payload };
  }
}
