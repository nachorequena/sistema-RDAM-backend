import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PagosService } from './pagos.service';
import { PluspagosService } from './pluspagos.service';
import { PrismaService } from '../config/prisma.service';
import { EmailService } from '../common/email.service';

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockPrisma: any;
let mockPluspagos: any;
let mockEmail: any;
let mockConfig: any;

// ── Datos de prueba ───────────────────────────────────────────────────────────

// Solicitud con fec_vencimiento_pago ya calculada al crear (decisión #3)
const fecVencimientoPago = new Date();
fecVencimientoPago.setDate(fecVencimientoPago.getDate() + 15); // DEV = 15 días desde creación

const solicitudMock = {
  id:                 1,
  nroTramite:         'RDAM-20260101-0001',
  email:              'juan@test.com',
  nombreCompleto:     'Juan Pérez',
  solEstado:          'pendiente',
  // UUID del intento de pago guardado al llamar iniciarPago
  pagoIntentoId:      'abc12345-1111-2222-3333-def456789012',
  // fec_vencimiento_pago calculada al CREAR la solicitud, no al pagar
  fecVencimientoPago,
  tipoCert: {
    descripcion:        'Certificado de Domicilio',
    precio:             1200.00,
    diasVencimientoPrd: 60,
    diasVencimientoDev: 15,
  },
};

// El webhook de PlusPagos mock (EstadoId 3 = REALIZADA = aprobado)
// Nota: TransaccionComercioId es el UUID del intento, no el nroTramite
const webhookAprobado = {
  Tipo:                    'PAGO',
  TransaccionPlataformaId: '654321',
  TransaccionComercioId:   'abc12345-1111-2222-3333-def456789012',
  Monto:                   '1200.00',
  EstadoId:                '3',
  Estado:                  'REALIZADA',
  FechaProcesamiento:      '2026-01-21T15:30:00.000Z',
};

const webhookRechazado = { ...webhookAprobado, EstadoId: '4', Estado: 'RECHAZADA' };

// ── Suite de tests ────────────────────────────────────────────────────────────

describe('PagosService', () => {
  let service: PagosService;

  beforeEach(async () => {
    jest.resetAllMocks();

    // Crear mocks frescos por test para evitar estado compartido
    mockPrisma = {
      solicitud: {
        findUnique: jest.fn(),
        update:     jest.fn(),
      },
      pago: {
        findUnique: jest.fn(),
        create:     jest.fn(),
      },
      $transaction: jest.fn(),
    };

    mockPluspagos = {
      isAprobado:          jest.fn(),
      mapEstado:           jest.fn(),
      buildPaymentPayload: jest.fn(),
      get url() { return 'http://localhost:3000'; },
    };

    mockEmail = {
      sendPagoConfirmado: jest.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      get: jest.fn((key: string, def?: any) => {
        const values: Record<string, any> = {
          NODE_ENV:                  'test',
          PLUSPAGOS_ESTADO_APROBADO: 3,
          APP_URL:                   'http://localhost:3001',
          FRONTEND_URL:              'http://localhost:3000',
        };
        return values[key] ?? def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PagosService,
        { provide: PrismaService,    useValue: mockPrisma },
        { provide: PluspagosService, useValue: mockPluspagos },
        { provide: ConfigService,    useValue: mockConfig },
        { provide: EmailService,     useValue: mockEmail },
      ],
    }).compile();

    service = module.get<PagosService>(PagosService);
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('FLUJO APROBADO', () => {

    it('cambia la solicitud a PAGADO y registra el pago', async () => {
      // ARRANGE
      mockPrisma.solicitud.findUnique.mockResolvedValue(solicitudMock);
      mockPrisma.pago.findUnique.mockResolvedValue(null); // primera vez
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 3, descripcion: 'REALIZADA' });
      mockPluspagos.isAprobado.mockReturnValue(true);

      let pagoCreado: any;
      let solicitudActualizada: any;

      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          pago: {
            create: jest.fn().mockImplementation((args) => {
              pagoCreado = args.data;
              return args.data;
            }),
          },
          solicitud: {
            update: jest.fn().mockImplementation((args) => {
              solicitudActualizada = args.data;
              return { ...solicitudMock, ...args.data };
            }),
          },
        };
        return cb(tx);
      });

      // ACT
      const resultado = await service.procesarWebhook(webhookAprobado);

      // ASSERT — respuesta siempre 200 para PlusPagos
      expect(resultado).toEqual({ received: true });

      // El pago se registra con el webhook_id correcto
      expect(pagoCreado.webhookId).toBe('654321');
      expect(pagoCreado.codigoPp).toBe(3);
      expect(pagoCreado.procesado).toBe(true);

      // La solicitud pasa a PAGADO
      expect(solicitudActualizada.solEstado).toBe('pagado');

      // fecPago se registra al confirmar el pago
      expect(solicitudActualizada.fecPago).toBeInstanceOf(Date);

      // CRÍTICO: fec_vencimiento_pago NO se toca en el webhook.
      // Fue calculada al crear la solicitud (decisión #3).
      expect(solicitudActualizada.fecVencimientoPago).toBeUndefined();

      // UUID del intento se limpia después de procesar
      expect(solicitudActualizada.pagoIntentoId).toBeNull();

      // Email de confirmación enviado
      expect(mockEmail.sendPagoConfirmado).toHaveBeenCalledWith(
        'juan@test.com',
        'Juan Pérez',
        'RDAM-20260101-0001',
        expect.any(String),
      );
    });

    it('lookup se hace por pagoIntentoId (UUID), no por nroTramite', async () => {
      // ARRANGE: el mock de findUnique responde al lookup por UUID
      mockPrisma.solicitud.findUnique.mockImplementation((args) => {
        // Debe buscar por pagoIntentoId, no por nroTramite
        if (args.where.pagoIntentoId === webhookAprobado.TransaccionComercioId) {
          return Promise.resolve(solicitudMock);
        }
        return Promise.resolve(null);
      });
      mockPrisma.pago.findUnique.mockResolvedValue(null);
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 3, descripcion: 'REALIZADA' });
      mockPluspagos.isAprobado.mockReturnValue(true);
      mockPrisma.$transaction.mockResolvedValue({});

      const resultado = await service.procesarWebhook(webhookAprobado);
      expect(resultado).toEqual({ received: true });
      // Verificar que el lookup fue por UUID
      expect(mockPrisma.solicitud.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pagoIntentoId: webhookAprobado.TransaccionComercioId }),
        }),
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('FLUJO RECHAZADO', () => {

    it('cambia la solicitud a RECHAZADO cuando el pago falla (EstadoId=4)', async () => {
      mockPrisma.solicitud.findUnique.mockResolvedValue(solicitudMock);
      mockPrisma.pago.findUnique.mockResolvedValue(null);
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 4, descripcion: 'RECHAZADA' });
      mockPluspagos.isAprobado.mockReturnValue(false);

      let solicitudActualizada: any;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          pago:      { create: jest.fn().mockResolvedValue({}) },
          solicitud: {
            update: jest.fn().mockImplementation((args) => {
              solicitudActualizada = args.data;
              return { ...solicitudMock, ...args.data };
            }),
          },
        };
        return cb(tx);
      });

      const resultado = await service.procesarWebhook(webhookRechazado);

      expect(resultado).toEqual({ received: true });
      expect(solicitudActualizada.solEstado).toBe('rechazado');
      // No debe setearse fecPago en rechazo
      expect(solicitudActualizada.fecPago).toBeUndefined();
      // Observación de rechazo auto-generada
      expect(solicitudActualizada.observacionRechazo).toContain('RECHAZADA');
      // No se envía email de pago confirmado
      expect(mockEmail.sendPagoConfirmado).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('IDEMPOTENCIA', () => {

    it('ignora un webhook ya procesado (mismo webhook_id)', async () => {
      mockPrisma.solicitud.findUnique.mockResolvedValue(solicitudMock);
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 3, descripcion: 'REALIZADA' });
      mockPluspagos.isAprobado.mockReturnValue(true);
      // Simular que ya existe en BD (incluyendo estado previo para entrar en rama "duplicado sin cambio")
      mockPrisma.pago.findUnique.mockResolvedValue({ id: 99, webhookId: '654321', codigoPp: 3, estadoPp: 'REALIZADA' });

      const resultado = await service.procesarWebhook(webhookAprobado);

      expect(resultado).toEqual({ received: true });
      // NO ejecuta la transacción
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockEmail.sendPagoConfirmado).not.toHaveBeenCalled();
    });

    it('retorna received=true para solicitud con UUID inexistente (sin lanzar error)', async () => {
      // El UUID no corresponde a ninguna solicitud
      mockPrisma.solicitud.findUnique.mockResolvedValue(null);
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 3, descripcion: 'REALIZADA' });
      mockPluspagos.isAprobado.mockReturnValue(true);

      const resultado = await service.procesarWebhook({
        ...webhookAprobado,
        TransaccionComercioId: 'uuid-que-no-existe-en-bd',
      });

      expect(resultado).toEqual({ received: true }); // nunca 500 para PlusPagos
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('solo procesa la primera cuando llegan dos webhooks simultáneos del mismo pago', async () => {
      let llamadas = 0;
      mockPrisma.solicitud.findUnique.mockResolvedValue(solicitudMock);
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 3, descripcion: 'REALIZADA' });
      mockPluspagos.isAprobado.mockReturnValue(true);

      // Primera llamada: no existe; segunda: ya existe (simulando race condition)
      mockPrisma.pago.findUnique.mockImplementation(() => {
        llamadas++;
        return llamadas === 1
          ? Promise.resolve(null)
          : Promise.resolve({ id: 1, webhookId: '654321', codigoPp: 3, estadoPp: 'REALIZADA' });
      });
      mockPrisma.$transaction.mockResolvedValue({});

      const [r1, r2] = await Promise.all([
        service.procesarWebhook(webhookAprobado),
        service.procesarWebhook(webhookAprobado),
      ]);

      expect(r1).toEqual({ received: true });
      expect(r2).toEqual({ received: true });
      // Transacción solo una vez
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  describe('VALIDACIONES Y EDGE CASES', () => {

    it('retorna received=true con payload incompleto (sin lanzar error)', async () => {
      const resultado = await service.procesarWebhook({
        Tipo: 'PAGO',
        // Faltan TransaccionPlataformaId, TransaccionComercioId, EstadoId
      });

      expect(resultado).toEqual({ received: true });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('registra el pago pero NO cambia estado para solicitud ya en PAGADO', async () => {
      const solicitudPagada = { ...solicitudMock, solEstado: 'pagado' };
      mockPrisma.solicitud.findUnique.mockResolvedValue(solicitudPagada);
      mockPrisma.pago.findUnique.mockResolvedValue(null);
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 3, descripcion: 'REALIZADA' });
      mockPluspagos.isAprobado.mockReturnValue(true);

      let solicitudUpdateLlamada = false;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          pago:      { create: jest.fn().mockResolvedValue({}) },
          solicitud: {
            update: jest.fn().mockImplementation(() => {
              solicitudUpdateLlamada = true;
            }),
          },
        };
        return cb(tx);
      });

      const resultado = await service.procesarWebhook(webhookAprobado);

      expect(resultado).toEqual({ received: true });
      // El pago se registra (log inmutable) pero la solicitud NO se toca
      expect(solicitudUpdateLlamada).toBe(false);
      expect(mockEmail.sendPagoConfirmado).not.toHaveBeenCalled();
    });

    it('procesarCallback mapea status=success al estadoId aprobado configurado', async () => {
      mockPrisma.solicitud.findUnique.mockResolvedValue(solicitudMock);
      mockPrisma.pago.findUnique.mockResolvedValue(null);
      mockPluspagos.mapEstado.mockReturnValue({ codigo: 3, descripcion: 'REALIZADA' });
      mockPluspagos.isAprobado.mockReturnValue(true);

      let solicitudActualizada: any;
      mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        const tx = {
          pago: { create: jest.fn().mockResolvedValue({}) },
          solicitud: {
            update: jest.fn().mockImplementation((args) => {
              solicitudActualizada = args.data;
              return args.data;
            }),
          },
        };
        return cb(tx);
      });

      const resultado = await service.procesarCallback(
        solicitudMock.pagoIntentoId,
        'success',
        { transaccionId: '99999', monto: '1200.00' },
      );

      expect(resultado).toEqual({ received: true });
      expect(solicitudActualizada.solEstado).toBe('pagado');
    });
  });
});
