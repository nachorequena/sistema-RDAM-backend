# RDAM — Plan de Pruebas Completo

**96 casos de prueba: happy path, error path, concurrencia y seguridad**  
Documento de Testing y QA · Versión 2.0 · 2026

---

## Resumen de cobertura

| Módulo                   | Happy  | Error  | Total  |
| ------------------------ | :----: | :----: | :----: |
| Auth ciudadano + interno |   6    |   7    |   13   |
| Adjuntos                 |   2    |   5    |   7    |
| Solicitudes              |   5    |   7    |   12   |
| Pagos / Webhooks         |   5    |   2    |   7    |
| Gestión interna          |   7    |   6    |   13   |
| Certificados             |   1    |   3    |   4    |
| Usuarios internos        |   4    |   5    |   9    |
| Jobs internos            |   3    |   2    |   5    |
| Seguridad transversal    |   0    |   5    |   5    |
| Concurrencia             |   3    |   0    |   3    |
| Tests unitarios (Jest)   |   9    |   —    |   9    |
| **TOTAL**                | **45** | **42** | **96** |

---

## Índice

1. [Tests unitarios automatizados (Jest)](#1-tests-unitarios-automatizados-jest)
2. [Autenticación ciudadano (OTP)](#2-autenticación-ciudadano-otp)
3. [Autenticación interna (Gestor/Admin)](#3-autenticación-interna-gestoradmin)
4. [Adjuntos](#4-adjuntos)
5. [Solicitudes](#5-solicitudes)
6. [Pagos y Webhooks](#6-pagos-y-webhooks)
7. [Gestión interna](#7-gestión-interna-gestoradmin)
8. [Certificados](#8-certificados)
9. [Usuarios internos](#9-usuarios-internos-solo-admin)
10. [Jobs internos](#10-jobs-internos)
11. [Seguridad transversal](#11-seguridad-transversal)
12. [Carga y concurrencia](#12-carga-y-concurrencia)
13. [Recomendaciones de automatización](#13-recomendaciones-de-automatización)

---

## 1. Tests Unitarios Automatizados (Jest)

Los tests unitarios corren sin necesidad de base de datos ni servicios externos. Usan mocks en memoria para simular Prisma, PlusPagos y el servicio de email.

```bash
# Correr la suite principal
npx jest src/pagos/pagos.service.spec.ts --verbose

# Correr todos los tests con cobertura
npx jest --coverage
```

|  #  | Test                                  | Qué verifica                                | Resultado |
| :-: | ------------------------------------- | ------------------------------------------- | :-------: |
|  1  | Flujo aprobado — cambia a PAGADO      | Estado pendiente→pagado, fecPago seteada    |   PASS    |
|  2  | Lookup por UUID (no nroTramite)       | findUnique usa pagoIntentoId                |   PASS    |
|  3  | Flujo rechazado — EstadoId=4          | Estado pendiente→rechazado, fecPago null    |   PASS    |
|  4  | Idempotencia — webhook duplicado      | $transaction no llamado si webhookId existe |   PASS    |
|  5  | UUID inexistente — no explota         | received=true aunque solicitud no exista    |   PASS    |
|  6  | Concurrencia — 2 webhooks simultáneos | $transaction llamado exactamente 1 vez      |   PASS    |
|  7  | Payload incompleto — no explota       | received=true con campos faltantes          |   PASS    |
|  8  | Solicitud ya PAGADO — no cambia       | solicitud.update no se llama                |   PASS    |
|  9  | Callback success — mapea estadoId     | solEstado=pagado                            |   PASS    |

> ■ Resultado obtenido: **9/9 PASS**. El ERROR que aparece al inicio de la ejecución es el log del test #5 y es completamente normal.

---

## 2. Autenticación Ciudadano (OTP)

---

### CP-AUTH-01 — Solicitar OTP exitoso `■ Happy Path`

**Endpoint:** `POST /auth/otp/solicitar`

**Request:**

```json
{ "email": "juan@test.com" }
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": null, "message": "Código enviado. Revisá tu email." }
```

> ■ El código OTP llega por email — revisarlo en **Mailhog** (http://localhost:8025) o en los logs del backend con `docker compose logs backend`

**Resultado:** `PASS / FAIL`

---

### CP-AUTH-02 — OTP sin email → 400 `■ Error Path`

**Endpoint:** `POST /auth/otp/solicitar`

**Request:**

```json
{}
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "VALIDATION_ERROR", "message": "email must be an email" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-AUTH-03 — OTP con email inválido → 400 `■ Error Path`

**Endpoint:** `POST /auth/otp/solicitar`

**Request:**

```json
{ "email": "esto-no-es-un-email" }
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "VALIDATION_ERROR", "message": "email must be an email" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-AUTH-04 — Verificar OTP exitoso `■ Happy Path`

**Endpoint:** `POST /auth/otp/verificar`

**Prerequisito:** Haber ejecutado CP-AUTH-01 y obtener el código desde **Mailhog** (http://localhost:8025) o desde los logs del backend con `docker compose logs backend`

**Request:**

```json
{ "email": "juan@test.com", "codigo": "847291" }
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "access_token": "eyJhbGci...", "refresh_token": "eyJhbGci..." } }
```

> ■ El token se guarda automáticamente en la variable `CITIZEN_TOKEN` del environment RDAM - Local.

**Resultado:** `PASS / FAIL`

---

### CP-AUTH-05 — OTP incorrecto → 401 con intentos restantes `■ Error Path`

**Endpoint:** `POST /auth/otp/verificar`

**Request:**

```json
{ "email": "juan@test.com", "codigo": "000000" }
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Código incorrecto. 2 intento(s) restantes" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-AUTH-06 — OTP no solicitado / expirado → 401 `■ Error Path`

**Endpoint:** `POST /auth/otp/verificar`

**Request:**

```json
{ "email": "nadie@test.com", "codigo": "123456" }
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Código inválido o expirado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-AUTH-07 — Bloqueo tras 3 intentos fallidos → 403 `■ Error Path`

**Endpoint:** `POST /auth/otp/verificar`

**Prerequisito:** Enviar código incorrecto 3 veces seguidas con el mismo email

**Request:**

```json
{ "email": "juan@test.com", "codigo": "000000" }
```

**Respuesta esperada:**

```json
HTTP 403
{ "error": { "code": "FORBIDDEN", "message": "Cuenta bloqueada por demasiados intentos" } }
```

> ■ Para resetear el bloqueo: solicitar un nuevo OTP (elimina los anteriores).

**Resultado:** `PASS / FAIL`

---

### CP-AUTH-08 — Logout ciudadano `■ Happy Path`

**Endpoint:** `POST /auth/logout`

**Request:**

```
# Sin body
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": null, "message": "Sesión cerrada" }
```

**Resultado:** `PASS / FAIL`

---

## 3. Autenticación Interna (Gestor/Admin)

---

### CP-INT-01 — Login gestor exitoso `■ Happy Path`

**Endpoint:** `POST /auth/interno/login`

**Request:**

```json
{ "email": "gestor@rdam.gob.ar", "password": "Gestor1234!" }
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "access_token": "eyJhbGci...", "rol": "gestor", "nombre": "Gestor Ejemplo" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-INT-02 — Login admin exitoso `■ Happy Path`

**Endpoint:** `POST /auth/interno/login`

**Request:**

```json
{ "email": "admin@rdam.gob.ar", "password": "Admin1234!" }
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "access_token": "eyJhbGci...", "rol": "admin", "nombre": "Administrador" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-INT-03 — Contraseña incorrecta → 401 `■ Error Path`

**Endpoint:** `POST /auth/interno/login`

**Request:**

```json
{ "email": "gestor@rdam.gob.ar", "password": "ContraseñaWrong" }
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Credenciales inválidas" } }
```

> ■ El mensaje es genérico para no revelar si el usuario existe.

**Resultado:** `PASS / FAIL`

---

### CP-INT-04 — Usuario inexistente → 401 `■ Error Path`

**Endpoint:** `POST /auth/interno/login`

**Request:**

```json
{ "email": "fantasma@rdam.gob.ar", "password": "Password123!" }
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Credenciales inválidas" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-INT-05 — Sin body → 400 `■ Error Path`

**Endpoint:** `POST /auth/interno/login`

**Request:**

```json
{}
```

**Respuesta esperada:**

```json
HTTP 400
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": ["email must be an email", "password should not be empty"]
  }
}
```

**Resultado:** `PASS / FAIL`

---

## 4. Adjuntos

> ■ Los tests CP-ADJ-01 y CP-ADJ-02 requieren MinIO corriendo (incluido en Docker Compose).

---

### CP-ADJ-01 — Subir adjunto PDF válido `■ Happy Path`

**Endpoint:** `POST /adjuntos/upload`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
Body (form-data): archivo = [archivo PDF real < 5MB]
```

**Respuesta esperada:**

```json
HTTP 201
{ "data": { "id": 1, "tipo": "otro", "mimeType": "application/pdf", "tamanioBytes": 245760 } }
```

**Resultado:** `PASS / FAIL`

---

### CP-ADJ-02 — Upload sin autenticación → 401 `■ Error Path`

**Endpoint:** `POST /adjuntos/upload`

**Request:**

```
# Sin header Authorization
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "No autorizado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-ADJ-03 — Archivo de tipo inválido (EXE, TXT) → 400 `■ Error Path`

**Endpoint:** `POST /adjuntos/upload`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
Body (form-data): archivo = [archivo .exe o .txt]
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "BAD_REQUEST", "message": "Tipo de archivo no permitido. Solo: PDF, JPG, PNG" } }
```

> ■ Validación por magic bytes (contenido real), no solo la extensión.

**Resultado:** `PASS / FAIL`

---

### CP-ADJ-04 — Archivo mayor a 5MB → 400 `■ Error Path`

**Endpoint:** `POST /adjuntos/upload`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
Body (form-data): archivo = [PDF mayor a 5MB]
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "BAD_REQUEST", "message": "El archivo excede el tamaño máximo de 5MB" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-ADJ-05 — Eliminar adjunto huérfano `■ Happy Path`

**Endpoint:** `DELETE /adjuntos/{{ADJUNTO_ID}}`

**Prerequisito:** Adjunto sin solicitud asociada

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": null, "message": "Adjunto eliminado" }
```

**Resultado:** `PASS / FAIL`

---

### CP-ADJ-06 — Eliminar adjunto ya asociado → 400 `■ Error Path`

**Endpoint:** `DELETE /adjuntos/{{ADJUNTO_ID}}`

**Prerequisito:** Adjunto con `solicitud_id != NULL`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "BAD_REQUEST", "message": "No se puede eliminar un adjunto asociado a una solicitud" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-ADJ-07 — Eliminar adjunto inexistente → 404 `■ Error Path`

**Endpoint:** `DELETE /adjuntos/99999`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 404
{ "error": { "code": "NOT_FOUND", "message": "Adjunto no encontrado" } }
```

**Resultado:** `PASS / FAIL`

---

## 5. Solicitudes

---

### CP-SOL-01 — Crear solicitud exitosa `■ Happy Path`

**Endpoint:** `POST /solicitudes`

**Request:**

```json
// Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
{
  "cuil": "20-34567890-1",
  "nombreCompleto": "Juan Carlos Pérez",
  "email": "juan@test.com",
  "tipoCertId": 1,
  "adjuntoIds": []
}
```

**Respuesta esperada:**

```json
HTTP 201
{
  "data": {
    "nroTramite": "RDAM-20260304-0001",
    "solEstado": "pendiente",
    "fecVencimientoPago": "2026-03-19T..."
  }
}
```

> ■ `nroTramite` tiene formato `RDAM-YYYYMMDD-NNNN`
> ■ `fecVencimientoPago` se calcula al crear (~15 días en DEV, 60 días en PRD)

**Resultado:** `PASS / FAIL`

---

### CP-SOL-02 — Crear solicitud sin token → 401 `■ Error Path`

**Endpoint:** `POST /solicitudes`

**Request:**

```
# Sin header Authorization
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "No autorizado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SOL-03 — CUIL inválido → 400 `■ Error Path`

**Endpoint:** `POST /solicitudes`

**Request:**

```json
{
  "cuil": "12345678",
  "nombreCompleto": "Test",
  "email": "juan@test.com",
  "tipoCertId": 1
}
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "VALIDATION_ERROR", "message": "cuil must match /^\\d{2}-\\d{8}-\\d{1}$/" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SOL-04 — tipoCertId inexistente → 404 `■ Error Path`

**Endpoint:** `POST /solicitudes`

**Request:**

```json
{
  "cuil": "20-34567890-1",
  "nombreCompleto": "Test",
  "email": "juan@test.com",
  "tipoCertId": 9999
}
```

**Respuesta esperada:**

```json
HTTP 404
{ "error": { "code": "NOT_FOUND", "message": "Tipo de certificado no encontrado o inactivo" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SOL-05 — Sin campos requeridos → 400 `■ Error Path`

**Endpoint:** `POST /solicitudes`

**Request:**

```json
{}
```

**Respuesta esperada:**

```json
HTTP 400
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": [
      "cuil must match ...",
      "nombreCompleto should not be empty",
      "email must be an email",
      "tipoCertId must be a number"
    ]
  }
}
```

**Resultado:** `PASS / FAIL`

---

### CP-SOL-06 — Listar mis solicitudes `■ Happy Path`

**Endpoint:** `GET /solicitudes?page=1&limit=10`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "data": [...], "total": 1, "page": 1, "perPage": 10 } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SOL-07 — Listar sin token → 401 `■ Error Path`

**Endpoint:** `GET /solicitudes`

**Request:**

```
# Sin header Authorization
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "No autorizado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SOL-08 — Consulta pública por nro_tramite (sin login) `■ Happy Path`

**Endpoint:** `GET /solicitudes/estado?nroTramite={{NRO_TRAMITE}}`

**Request:**

```
# Sin Authorization — endpoint público
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": [{ "nroTramite": "RDAM-...", "solEstado": "pagado", "historial": [...] }] }
```

**Resultado:** `PASS / FAIL`

---

### CP-SOL-09 — Consulta pública — nro_tramite inexistente `■ Happy Path`

**Endpoint:** `GET /solicitudes/estado?nroTramite=RDAM-20200101-9999`

**Request:**

```
# Sin Authorization
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": [] }
```

> ■ Devuelve array vacío (no 404) para no revelar existencia de trámites.

**Resultado:** `PASS / FAIL`

---

### CP-SOL-10 — Iniciar pago — genera UUID `■ Happy Path`

**Endpoint:** `POST /solicitudes/{{NRO_TRAMITE}}/iniciar-pago`

**Prerequisito:** `solEstado = "pendiente"`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{
  "data": {
    "TransaccionComercioId": "550e8400-e29b-41d4-a716-446655440000",
    "Comercio": "test-merchant-001",
    "Monto": "...",
    "pluspagosUrl": "http://localhost:3000"
  }
}
```

> ■ `TransaccionComercioId` es un UUID v4 — se guarda automáticamente en `PAGO_INTENTO_ID`.

**Resultado:** `PASS / FAIL`

---

### CP-SOL-11 — Iniciar pago para solicitud ya pagada → 400 `■ Error Path`

**Endpoint:** `POST /solicitudes/{{NRO_TRAMITE}}/iniciar-pago`

**Prerequisito:** `solEstado = "pagado"`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "ESTADO_INVALIDO", "message": "La solicitud está en estado \"pagado\", no se puede iniciar pago" } }
```

**Resultado:** `PASS / FAIL`

---

## 6. Pagos y Webhooks

> ■ El sistema siempre responde HTTP 200 a PlusPagos (incluso en errores internos) para evitar reintentos indefinidos.

---

### CP-PAG-01 — Webhook pago aprobado (EstadoId=3) `■ Happy Path`

**Endpoint:** `POST /pagos/webhook`

**Prerequisito:** Haber ejecutado iniciar-pago — `{{PAGO_INTENTO_ID}}` debe estar seteado

**Request:**

```json
{
  "Tipo": "PAGO",
  "TransaccionPlataformaId": "{{$guid}}",
  "TransaccionComercioId": "{{PAGO_INTENTO_ID}}",
  "Monto": "1200.00",
  "EstadoId": "3",
  "Estado": "REALIZADA",
  "FechaProcesamiento": "2026-03-04T10:00:00.000Z"
}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "received": true } }
```

> ■ Usar `{{$guid}}` en `TransaccionPlataformaId` para garantizar unicidad en cada prueba
> ■ Verificar que `solEstado` cambie a `"pagado"` consultando CP-SOL-08

**Resultado:** `PASS / FAIL`

---

### CP-PAG-02 — Webhook pago rechazado (EstadoId=4) `■ Happy Path`

**Endpoint:** `POST /pagos/webhook`

**Prerequisito:** `solEstado = "pendiente"` con `pagoIntentoId` válido

**Request:**

```json
{
  "Tipo": "PAGO",
  "TransaccionPlataformaId": "{{$guid}}",
  "TransaccionComercioId": "{{PAGO_INTENTO_ID}}",
  "Monto": "1200.00",
  "EstadoId": "4",
  "Estado": "RECHAZADA",
  "FechaProcesamiento": "2026-03-04T10:00:00.000Z"
}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "received": true } }
```

> ■ Verificar: `solEstado` cambia a `"rechazado"` con `observacionRechazo` auto-generada.

**Resultado:** `PASS / FAIL`

---

### CP-PAG-03 — Webhook duplicado — idempotencia `■ Happy Path`

**Endpoint:** `POST /pagos/webhook`

**Prerequisito:** Haber enviado CP-PAG-01 con un `TransaccionPlataformaId` fijo (no `{{$guid}}`)

**Request:**

```
# Mismo body que CP-PAG-01 con el mismo TransaccionPlataformaId
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "received": true } }
```

> ■ En los logs del servidor: `WARN [PagosService] Duplicado ignorado: <id>`
> ■ En la BD: sigue habiendo UN SOLO registro con ese `webhook_id`

**Resultado:** `PASS / FAIL`

---

### CP-PAG-04 — UUID de intento inexistente → received:true `■ Happy Path`

**Endpoint:** `POST /pagos/webhook`

**Request:**

```json
{
  "TransaccionPlataformaId": "{{$guid}}",
  "TransaccionComercioId": "00000000-0000-0000-0000-000000000000",
  "EstadoId": "3"
}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "received": true } }
```

> ■ Nunca devuelve 500 aunque el UUID no exista.

**Resultado:** `PASS / FAIL`

---

### CP-PAG-05 — Payload incompleto → received:true `■ Error Path`

**Endpoint:** `POST /pagos/webhook`

**Request:**

```json
{ "Tipo": "PAGO" }
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "received": true } }
```

> ■ El sistema nunca devuelve 5xx a PlusPagos.

**Resultado:** `PASS / FAIL`

---

### CP-PAG-06 — Callback S2S — success `■ Happy Path`

**Endpoint:** `POST /pagos/callback?intento={{PAGO_INTENTO_ID}}&status=success`

**Request:**

```json
{ "transaccionId": "200001", "monto": "1200.00" }
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "received": true } }
```

**Resultado:** `PASS / FAIL`

---

### CP-PAG-07 — Callback S2S — cancel `■ Happy Path`

**Endpoint:** `POST /pagos/callback?intento={{PAGO_INTENTO_ID}}&status=cancel`

**Request:**

```json
{ "transaccionId": "200002", "monto": "1200.00" }
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "received": true } }
```

> ■ Verificar: `solEstado` cambia a `"rechazado"`.

**Resultado:** `PASS / FAIL`

---

## 7. Gestión Interna (Gestor/Admin)

> ■ Todos los endpoints `/gestion/*` requieren: `Authorization: Bearer {{INTERNAL_TOKEN}}` (gestor o admin).

---

### CP-GES-01 — Listar solicitudes con filtro `■ Happy Path`

**Endpoint:** `GET /gestion/solicitudes?estado=pagado&page=1&limit=20`

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "data": [...], "total": 1, "page": 1 } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-02 — Listar con token ciudadano → 403 `■ Error Path`

**Endpoint:** `GET /gestion/solicitudes`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 403
{ "error": { "code": "FORBIDDEN", "message": "Acceso denegado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-03 — Listar sin token → 401 `■ Error Path`

**Endpoint:** `GET /gestion/solicitudes`

**Request:**

```
# Sin Authorization
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "No autorizado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-04 — Tomar solicitud (PAGADO → EN_REVISION) `■ Happy Path`

**Endpoint:** `PATCH /gestion/solicitudes/{{SOLICITUD_ID}}/tomar`

**Prerequisito:** `solEstado = "pagado"`

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "solEstado": "en_revision" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-05 — Tomar solicitud en estado incorrecto → 400 `■ Error Path`

**Endpoint:** `PATCH /gestion/solicitudes/{{SOLICITUD_ID}}/tomar`

**Prerequisito:** `solEstado = "pendiente"` (sin pago)

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 400
{
  "error": {
    "code": "ESTADO_INVALIDO",
    "message": "Solo se pueden tomar solicitudes en estado \"pagado\". Estado actual: \"pendiente\""
  }
}
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-06 — Rechazar con observación válida `■ Happy Path`

**Endpoint:** `PATCH /gestion/solicitudes/{{SOLICITUD_ID}}/rechazar`

**Prerequisito:** `solEstado = "en_revision"` o `"pagado"`

**Request:**

```json
// Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
{
  "observacion": "La documentación adjunta no es legible. Por favor reenvíe una copia clara del DNI."
}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "solEstado": "rechazado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-07 — Rechazar con observación corta → 400 `■ Error Path`

**Endpoint:** `PATCH /gestion/solicitudes/{{SOLICITUD_ID}}/rechazar`

**Request:**

```json
// Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
{ "observacion": "Mal." }
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "OBSERVACION_INVALIDA", "message": "La observación debe tener al menos 20 caracteres" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-08 — Rechazar solicitud en estado incorrecto → 400 `■ Error Path`

**Endpoint:** `PATCH /gestion/solicitudes/{{SOLICITUD_ID}}/rechazar`

**Prerequisito:** `solEstado = "pendiente"`

**Request:**

```json
// Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
{ "observacion": "Observación válida con más de veinte caracteres." }
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "ESTADO_INVALIDO", "message": "No se puede rechazar una solicitud en estado \"pendiente\"" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-09 — Publicar certificado `■ Happy Path`

**Endpoint:** `PATCH /gestion/solicitudes/{{SOLICITUD_ID}}/publicar`

**Prerequisito:** `solEstado = "en_revision"` + MinIO corriendo

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{
  "data": {
    "solEstado": "publicado",
    "tokenPdf": "a3f8d92e1b4c...64 chars hex",
    "fecEmision": "2026-03-04T...",
    "fecVencimiento": "2026-06-07T..."
  }
}
```

> ■ `tokenPdf` es exactamente 64 caracteres hexadecimales.

**Resultado:** `PASS / FAIL`

---

### CP-GES-10 — Publicar solicitud pendiente → 400 `■ Error Path`

**Endpoint:** `PATCH /gestion/solicitudes/{{SOLICITUD_ID}}/publicar`

**Prerequisito:** `solEstado = "pendiente"`

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 400
{ "error": { "code": "ESTADO_INVALIDO", "message": "No se puede publicar una solicitud en estado \"pendiente\"" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-GES-11 — Dashboard de métricas `■ Happy Path`

**Endpoint:** `GET /gestion/dashboard`

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "porEstado": [{ "estado": "pendiente", "total": 3 }], "nuevasHoy": 2 } }
```

**Resultado:** `PASS / FAIL`

---

## 8. Certificados

---

### CP-CERT-01 — Descargar PDF por token válido `■ Happy Path`

**Endpoint:** `GET /certificados/{{PDF_TOKEN}}`

**Prerequisito:** Haber publicado un certificado (CP-GES-09)

**Request:**

```
# Sin Authorization — endpoint público
```

**Respuesta esperada:**

```
HTTP 200
Content-Type: application/pdf
Content-Disposition: attachment; filename="RDAM-XXXXXXXX-XXXX.pdf"
[bytes del PDF]
```

**Resultado:** `PASS / FAIL`

---

### CP-CERT-02 — Token inexistente → 404 `■ Error Path`

**Endpoint:** `GET /certificados/0000000000000000000000000000000000000000000000000000000000000000`

**Request:**

```
# Sin Authorization
```

**Respuesta esperada:**

```json
HTTP 404
{ "error": { "code": "NOT_FOUND", "message": "Certificado no encontrado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-CERT-03 — Token con longitud incorrecta → 404 `■ Error Path`

**Endpoint:** `GET /certificados/abc123`

**Request:**

```
# Sin Authorization
```

**Respuesta esperada:**

```json
HTTP 404
{ "error": { "code": "NOT_FOUND", "message": "Certificado no encontrado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-CERT-04 — Certificado vencido → 410 Gone `■ Error Path`

**Endpoint:** `GET /certificados/{{PDF_TOKEN}}`

**Prerequisito:** `solEstado = "publicado_vencido"` — simular con:

```bash
docker compose exec postgres psql -U rdam -d rdamdb -c \
  "UPDATE solicitudes SET fec_vencimiento = '2025-01-01' WHERE sol_estado = 'publicado' LIMIT 1;"
```

**Request:**

```
# Sin Authorization
```

**Respuesta esperada:**

```json
HTTP 410
{ "error": { "code": "GONE", "message": "El certificado ha vencido" } }
```

**Resultado:** `PASS / FAIL`

---

## 9. Usuarios Internos (solo Admin)

> ■ Todos los endpoints `/usuarios` requieren rol `admin`.

---

### CP-USR-01 — Listar usuarios `■ Happy Path`

**Endpoint:** `GET /usuarios`

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}} (admin)
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": [{ "id": 1, "nombre": "...", "rol": "admin" }] }
```

**Resultado:** `PASS / FAIL`

---

### CP-USR-02 — Listar usuarios con rol gestor → 403 `■ Error Path`

**Endpoint:** `GET /usuarios`

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}} (gestor)
```

**Respuesta esperada:**

```json
HTTP 403
{ "error": { "code": "FORBIDDEN", "message": "Requiere rol: admin" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-USR-03 — Crear nuevo usuario gestor `■ Happy Path`

**Endpoint:** `POST /usuarios`

**Request:**

```json
// Headers: Authorization: Bearer {{INTERNAL_TOKEN}} (admin)
{
  "nombre": "María García",
  "email": "mgarcia@rdam.gob.ar",
  "password": "Temporal1234!",
  "rol": "gestor"
}
```

**Respuesta esperada:**

```json
HTTP 201
{ "data": { "id": 3, "nombre": "María García", "rol": "gestor", "activo": true } }
```

> ■ La respuesta **NO** incluye `passwordHash`.

**Resultado:** `PASS / FAIL`

---

### CP-USR-04 — Crear usuario con email duplicado → 409 `■ Error Path`

**Endpoint:** `POST /usuarios`

**Request:**

```json
// Headers: Authorization: Bearer {{INTERNAL_TOKEN}} (admin)
{
  "email": "admin@rdam.gob.ar",
  "nombre": "...",
  "password": "Admin1234!",
  "rol": "admin"
}
```

**Respuesta esperada:**

```json
HTTP 409
{ "error": { "code": "CONFLICT", "message": "El email ya está en uso" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-USR-05 — Borrado lógico de usuario `■ Happy Path`

**Endpoint:** `DELETE /usuarios/{{USER_ID}}`

**Request:**

```
Headers: Authorization: Bearer {{INTERNAL_TOKEN}} (admin)
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": null, "message": "Usuario eliminado" }
```

> ■ El usuario no aparece en `GET /usuarios` pero sigue en la BD con `deletedAt` seteado.

**Resultado:** `PASS / FAIL`

---

### CP-USR-06 — Usuario borrado no puede hacer login → 401 `■ Error Path`

**Endpoint:** `POST /auth/interno/login`

**Prerequisito:** Ejecutar CP-USR-05 primero

**Request:**

```json
{ "email": "mgarcia@rdam.gob.ar", "password": "Temporal1234!" }
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Credenciales inválidas" } }
```

**Resultado:** `PASS / FAIL`

---

## 10. Jobs Internos

---

### CP-JOB-01 — Health check `■ Happy Path`

**Endpoint:** `GET /internal/health`

**Request:**

```
# Sin Authorization
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "status": "ok", "db": "ok" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-JOB-02 — Job: vencer pagados (trigger manual) `■ Happy Path`

**Endpoint:** `POST /internal/jobs/vencer-pagados`

**Request:**

```
Headers: X-Internal-Token: INTERNAL_TOKEN_SECRET
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "actualizadas": 0, "mensaje": "Job ejecutado" } }
```

> ■ Devuelve `actualizadas=0` si no hay solicitudes con `fecVencimientoPago` < ahora.
> ■ Para simular un vencimiento:
>
> ```bash
> docker compose exec postgres psql -U rdam -d rdamdb -c \
>   "UPDATE solicitudes SET fec_vencimiento_pago = '2025-01-01' WHERE sol_estado = 'pagado' LIMIT 1;"
> ```

**Resultado:** `PASS / FAIL`

---

### CP-JOB-03 — Job: vencer publicados (trigger manual) `■ Happy Path`

**Endpoint:** `POST /internal/jobs/vencer-publicados`

**Request:**

```
Headers: X-Internal-Token: INTERNAL_TOKEN_SECRET
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": { "actualizadas": 0, "mensaje": "Job ejecutado" } }
```

> ■ Devuelve `actualizadas=0` si no hay certificados con `fecVencimiento` < ahora.
> ■ Para simular:
>
> ```bash
> docker compose exec postgres psql -U rdam -d rdamdb -c \
>   "UPDATE solicitudes SET fec_vencimiento = '2025-01-01' WHERE sol_estado = 'publicado' LIMIT 1;"
> ```

**Resultado:** `PASS / FAIL`

---

### CP-JOB-04 — Jobs sin token → 401 `■ Error Path`

**Endpoint:** `POST /internal/jobs/vencer-pagados`

**Request:**

```
# Sin header X-Internal-Token
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Token interno requerido" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-JOB-05 — Jobs con token incorrecto → 401 `■ Error Path`

**Endpoint:** `POST /internal/jobs/vencer-pagados`

**Request:**

```
Headers: X-Internal-Token: token-equivocado
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "Token interno inválido" } }
```

**Resultado:** `PASS / FAIL`

---

## 11. Seguridad Transversal

---

### CP-SEG-01 — Token JWT completamente inválido → 401 `■ Error Path`

**Endpoint:** `GET /solicitudes`

**Request:**

```
Headers: Authorization: Bearer esto-no-es-un-jwt
```

**Respuesta esperada:**

```json
HTTP 401
{ "error": { "code": "UNAUTHORIZED", "message": "No autorizado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SEG-02 — Token ciudadano en endpoint interno → 403 `■ Error Path`

**Endpoint:** `GET /gestion/solicitudes`

**Request:**

```
Headers: Authorization: Bearer {{CITIZEN_TOKEN}}
```

**Respuesta esperada:**

```json
HTTP 403
{ "error": { "code": "FORBIDDEN", "message": "Acceso denegado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SEG-03 — Token interno en endpoint ciudadano → 403 `■ Error Path`

**Endpoint:** `POST /solicitudes`

**Request:**

```json
// Headers: Authorization: Bearer {{INTERNAL_TOKEN}}
{ "cuil": "20-34567890-1" }
```

**Respuesta esperada:**

```json
HTTP 403
{ "error": { "code": "FORBIDDEN", "message": "Acceso denegado" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SEG-04 — Rate limiting OTP — más de 3 solicitudes/10min → 429 `■ Error Path`

**Endpoint:** `POST /auth/otp/solicitar`

**Prerequisito:** Enviar el mismo request 4 veces seguidas rápido

**Request:**

```json
{ "email": "juan@test.com" }
```

**Respuesta esperada:**

```json
HTTP 429
{ "error": { "code": "TOO_MANY_REQUESTS", "message": "ThrottlerException: Too Many Requests" } }
```

**Resultado:** `PASS / FAIL`

---

### CP-SEG-05 — SQL injection en búsqueda → array vacío `■ Happy Path`

**Endpoint:** `GET /solicitudes/estado?nroTramite='; DROP TABLE solicitud; --`

**Request:**

```
# Sin Authorization
```

**Respuesta esperada:**

```json
HTTP 200
{ "data": [] }
```

> ■ Prisma usa prepared statements — la inyección no se ejecuta nunca.

**Resultado:** `PASS / FAIL`

---

## 12. Carga y Concurrencia

### 1 — Múltiples solicitudes simultáneas del mismo ciudadano

Abrir el request "4a. Crear solicitud" en Postman → clic en `...` → Run → poner 5 iteraciones con delay 0.

**Resultado esperado:** 5 solicitudes con `nroTramite` únicos y secuenciales (`RDAM-YYYYMMDD-0001` a `0005`). Ningún número duplicado.

---

### 2 — Webhook duplicado simultáneo (race condition)

Abrir dos pestañas de Postman y enviar el mismo webhook (mismo `TransaccionPlataformaId`) al mismo tiempo.

**Resultado esperado:** solo 1 registro en tabla `pago`. El segundo webhook responde `received=true` sin error.

Verificar en BD:

```bash
docker compose exec postgres psql -U rdam -d rdamdb -c \
  "SELECT COUNT(*) FROM pago WHERE webhook_id = '100001';"
# Debe devolver: 1
```

---

### 3 — Múltiples intentos de pago para la misma solicitud

Solo el último intento de pago es válido:

| Paso | Acción                                   | Resultado esperado                    |
| :--: | ---------------------------------------- | ------------------------------------- |
|  1   | Crear solicitud                          | `solEstado=pendiente`                 |
|  2   | Llamar `/iniciar-pago` → UUID-1          | UUID-1 guardado en `pago_intento_id`  |
|  3   | Llamar `/iniciar-pago` de nuevo → UUID-2 | UUID-2 reemplaza UUID-1               |
|  4   | Webhook con UUID-1                       | `received=true` pero estado NO cambia |
|  5   | Webhook con UUID-2                       | `solEstado=pagado` ✅                 |

---

## 13. Recomendaciones de Automatización

### Cobertura de código con Jest

```bash
npx jest --coverage --coverageReporters=html
# Abrir coverage/lcov-report/index.html en el navegador
```

Los módulos con más oportunidad de cobertura adicional son `gestion.service.ts` y `auth.service.ts`.

---

### Variables del environment "RDAM - Local"

El environment de Postman contiene todas las variables necesarias. Los scripts Post-response de cada request actualizan automáticamente los valores a medida que se avanza en el flujo:

| Variable          | Seteada en                           | Usada en                         |
| ----------------- | ------------------------------------ | -------------------------------- |
| `BASE_URL`        | Manual (`http://localhost:3001/api`) | Todos los requests               |
| `CITIZEN_TOKEN`   | 1b. Verificar OTP                    | Todos los endpoints de ciudadano |
| `INTERNAL_TOKEN`  | 2b. Login interno                    | Todos los endpoints de gestión   |
| `ADJUNTO_ID`      | 3a. Subir adjunto                    | 4a. Crear solicitud              |
| `NRO_TRAMITE`     | 4a. Crear solicitud                  | 4e. Iniciar pago, consultas      |
| `SOLICITUD_ID`    | 4a. Crear solicitud                  | 6c, 6d, 6e. Gestión              |
| `PAGO_INTENTO_ID` | 4e. Iniciar pago                     | 5a. Webhook aprobado             |
| `PDF_TOKEN`       | 6d. Publicar certificado             | 7a. Descargar PDF                |
