# RDAM Backend

**Sistema de Gestión de Solicitudes y Certificados Digitales**  
Stack: NestJS · TypeScript · Prisma · PostgreSQL · PlusPagos · Puppeteer · MinIO

---

## Prerequisitos

| Herramienta    | Para qué                     | Dónde conseguirla                              |
| -------------- | ---------------------------- | ---------------------------------------------- |
| Docker Desktop | Levantar todos los servicios | https://www.docker.com/products/docker-desktop |
| Postman        | Probar los endpoints         | https://www.postman.com/downloads              |

---

## Qué levanta Docker

Un solo comando `docker compose up -d` levanta **todo**:

| Contenedor            | Servicio                             | Puerto      |
| --------------------- | ------------------------------------ | ----------- |
| `rdam_postgres`       | Base de datos PostgreSQL             | 5432        |
| `rdam_minio`          | Storage de archivos (MinIO)          | 9000 / 9001 |
| `rdam_mailhog`        | Bandeja de emails de desarrollo      | 1025 / 8025 |
| `rdam_pluspagos_mock` | Simulador de pasarela de pagos       | 3000        |
| `rdam_backend`        | API NestJS + migraciones automáticas | 3001        |

---

## Paso a paso para levantar el proyecto

### 1. Verificar que Docker Desktop está corriendo

Abrir Docker Desktop y esperar que el ícono quede en **verde**.

```cmd
docker --version
docker compose version
```

### 2. Levantar todos los servicios

Antes de levantar, crear el archivo de entorno a partir del ejemplo (obligatorio):

```bash
cp .env.docker.example .env.docker
# o en PowerShell:
Copy-Item .env.docker.example .env.docker
```

Edite `.env.docker` si necesitás ajustar claves o poner `RUN_PRISMA_SEED=1` la primera vez.


Desde la carpeta raíz del proyecto (donde está `docker-compose.yml`) ejecutá (recomendado):

```cmd
docker compose --env-file .env.docker up -d --build
```

Este comando garantiza que las variables definidas en `.env.docker` se usen durante el arranque de Compose (útil para `RUN_PRISMA_SEED=1`).

Alternativa (si no querés usar `--env-file`):

```cmd
docker compose up -d --build
```

La **primera vez** descarga las imágenes y construye la imagen del backend. Puede tardar 5-10 minutos. Las siguientes veces son más rápidas.

Al levantar, el backend ejecuta automáticamente las migraciones de base de datos. El seed con los datos iniciales (tipos de certificado y usuarios) se ejecuta si en `.env.docker` tenés `RUN_PRISMA_SEED=1`.

Nota: Para hacer el seed en la primera ejecución pon `RUN_PRISMA_SEED=1` en `.env.docker` antes de levantar los servicios. Tras confirmar que el seed corrió correctamente, cambiá `RUN_PRISMA_SEED` a `0` y recreá/reiniciá el contenedor `backend` para evitar que el seed se ejecute de nuevo en arranques posteriores.

Configurar webhook en el dashboard de PlusPagos

Si preferís revisar o cambiar la URL del webhook manualmente, abrí el dashboard del mock en http://localhost:3000/dashboard y pegá la URL del webhook en el campo correspondiente. Usar:

- Si el mock corre fuera de Docker (ej. con `npm start` en `pluspagos-mock-simple`): `http://host.docker.internal:3001/api/pagos/webhook`
- Si levantaste todo con `docker compose up -d`: no deberías necesitar hacer nada — `docker-compose.yml` inyecta `WEBHOOK_URL` en el servicio del mock apuntando a `http://backend:3001/api/pagos/webhook` automáticamente.

Después de pegar la URL, clic en **Guardar** en el dashboard para activarla.

Generar claves y secretos (comandos rápidos)

Si querés generar claves seguras localmente, podés usar los siguientes comandos.

- Unix / Git Bash / WSL (openssl):

```bash
# JWT secret (32 bytes → 64 hex chars)
openssl rand -hex 32

# JWT refresh secret (32 bytes)
openssl rand -hex 32

# API / HMAC secret (base64)
openssl rand -base64 48
```

- Node (cualquiera):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- PowerShell (Windows):

```powershell
[Convert]::ToHexString((New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes(32)).ToLower()
```

Ejemplo para crear el archivo de entorno local a partir del ejemplo:

```bash
cp .env.docker.example .env.docker
# o en PowerShell:
Copy-Item .env.docker.example .env.docker
```

Recordá reemplazar las claves del ejemplo por las generadas antes de usar en entornos públicos.

Verificar que todo levantó:

```cmd
docker compose ps
```

Resultado esperado:

```
NAME                   STATUS
rdam_postgres          running (healthy)
rdam_minio             running
rdam_mailhog           running
rdam_pluspagos_mock    running
rdam_backend           running
```

Ver los logs del backend para confirmar que arrancó:

```cmd
docker compose logs backend
```

Health check rápido:

```cmd
curl http://localhost:3001/api/internal/health
# → {"data":{"status":"ok","db":"ok"}}
```

O abrir directamente http://localhost:3001/api/docs para ver el Swagger.

### 3. ¡Listo!

No hay pasos adicionales. Todo quedó configurado automáticamente (recuerda la nota sobre `RUN_PRISMA_SEED` arriba).

---

## URLs disponibles

| URL                             | Descripción                          | Credenciales            |
| ------------------------------- | ------------------------------------ | ----------------------- |
| http://localhost:3001/api       | API del backend                      | —                       |
| http://localhost:3001/api/docs  | Swagger interactivo                  | —                       |
| http://localhost:9001           | Consola MinIO                        | minioadmin / minioadmin |
| http://localhost:8025           | Bandeja de emails (Mailhog)          | —                       |
| http://localhost:3000           | Mock PlusPagos                       | —                       |
| http://localhost:3000/dashboard | Dashboard del mock con transacciones | —                       |

**Usuarios del seed:**

- `admin@rdam.gob.ar` / `Admin1234!`
- `gestor@rdam.gob.ar` / `Gestor1234!`

---

## Importar la colección en Postman

1. Abrir Postman → clic en **Import**
2. Arrastrar `RDAM_Backend_API_v2.postman_collection.json`
3. Importar también el environment `RDAM - Local` (archivo `.postman_environment.json`)
4. Seleccionar el environment **RDAM - Local** en el selector de la esquina superior derecha de Postman

El environment ya tiene `BASE_URL = http://localhost:3001/api` y el resto de las variables preconfiguradas. Los scripts de cada request actualizan automáticamente los tokens y IDs a medida que avanzás en el flujo.

---

## Flujo de prueba completo

Ejecutar los requests en este orden:

| Request | Endpoint                                | Descripción                                                                                                                  |
| ------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1a      | POST /auth/otp/solicitar                | Pedir OTP → llega a Mailhog (http://localhost:8025)                                                                          |
|         |                                         | Alternativas para ver el código OTP:                                                                                         |
|         |                                         | - Abrir la UI de Mailhog: http://localhost:8025                                                                              |
|         |                                         | - Ver logs en vivo por terminal: `docker compose logs -f backend` si preferís revisar el log del servicio que envía el email |
| 1b      | POST /auth/otp/verificar                | Verificar OTP con el código del email                                                                                        |
| 2b      | POST /auth/interno/login                | Login como admin o gestor                                                                                                    |
| 3a      | POST /adjuntos/upload                   | Subir un PDF                                                                                                                 |
| 4a      | POST /solicitudes                       | Crear solicitud con tipoCertId: 1                                                                                            |
| 4e      | POST /solicitudes/:nro/iniciar-pago     | Generar payload de pago                                                                                                      |
| 5a      | POST /pagos/webhook                     | Simular pago aprobado                                                                                                        |
| 6c      | PATCH /gestion/solicitudes/:id/tomar    | PAGADO → EN_REVISION                                                                                                         |
| 6d      | PATCH /gestion/solicitudes/:id/publicar | EN_REVISION → PUBLICADO + PDF                                                                                                |
| 7a      | GET /certificados/:token                | Descargar PDF público                                                                                                        |

**Tarjetas de prueba** (usarlas en el formulario de pago del mock):

| Número                | Resultado    |
| --------------------- | ------------ |
| `4242 4242 4242 4242` | ✅ Aprobada  |
| `4000 0000 0000 0002` | ❌ Rechazada |
| `5555 5555 5555 4444` | ✅ Aprobada  |
| `5105 1051 0510 5100` | ❌ Rechazada |

---

## Comandos del día a día

```cmd
docker compose up -d                     # levantar todos los servicios
docker compose down                      # bajar (los datos se conservan)
docker compose down -v                   # bajar + borrar todos los datos (reset total)
docker compose ps                        # ver estado de cada contenedor
docker compose logs -f backend           # logs del backend en tiempo real
docker compose logs -f pluspagos-mock    # logs del mock de PlusPagos
docker compose restart backend           # reiniciar solo el backend
docker compose build --no-cache backend  # reconstruir imagen tras cambios de código
```

Nota sobre `--build` / uso habitual:

- `docker compose up -d --build` se utiliza cuando querés forzar la reconstrucción de las imágenes (cambios en `src/`, `package.json`, `Dockerfile`, o nuevos archivos que deben ser incluidos en la imagen). Usalo la primera vez o cada vez que modifiques código que requiere rebuild.
- Una vez que la imagen ya está construida y no hiciste cambios que afecten la imagen, basta con `docker compose up -d` (más rápido).
- Para reconstruir solo el `backend` tras cambios puntuales:

```cmd
docker compose up -d --build backend
```

- Si cambiaste `.env.docker` y querés que el contenedor lea las nuevas variables, recrealo:

```cmd
docker compose up -d --force-recreate backend
# o bajar y subir:
docker compose down && docker compose up -d --build
```

> Con `docker compose down -v` se borran todos los datos (BD y archivos de MinIO). El seed vuelve a correr automáticamente la próxima vez que levantes.

---

## Migraciones

Las migraciones de Prisma se aplican **automáticamente** al levantar el backend. Si necesitás forzarlas manualmente:

```cmd
docker compose exec backend npx prisma migrate deploy
```

---

## Tests unitarios

Los tests corren en tu máquina (no en Docker):

```cmd
npm install
npx jest src/pagos/pagos.service.spec.ts --verbose
```

Resultado esperado: **9/9 PASS**

Ver `PLAN_PRUEBAS_COMPLETO.md` para los 96 casos de prueba manuales.

---

## Troubleshooting

| Error                                   | Causa                       | Solución                                                                 |
| --------------------------------------- | --------------------------- | ------------------------------------------------------------------------ |
| Backend se reinicia en bucle            | PostgreSQL todavía no listo | Esperar 30s y `docker compose up -d` de nuevo                            |
| `fn_generar_nro_tramite() no existe`    | Migración no se aplicó      | `docker compose exec backend npx prisma migrate deploy`                  |
| `TIPO_CERT_INVALIDO` al crear solicitud | Seed no corrió              | Ejecutar el Paso 4 (seed)                                                |
| `Could not find Chrome`                 | Imagen desactualizada       | `docker compose build --no-cache backend`                                |
| OTP no llega a Mailhog                  | Mailhog no levantó          | `docker compose up -d mailhog`                                           |
| MinIO no levanta con `latest`           | Incompatibilidad de versión | El compose ya usa `RELEASE.2024-01-16T16-07-38Z` — no cambiar a `latest` |
| `docker compose` se cuelga              | Docker Desktop no iniciado  | Abrir Docker Desktop, esperar ícono verde                                |

| `NoSuchBucket` al subir adjuntos        | Buckets de MinIO no existen aún | Re-ejecutar el init de MinIO para crear los buckets: `docker compose run --rm minio-init`. Verificar en la consola MinIO (http://localhost:9001) que `rdam-adjuntos` y `rdam-pdfs` existen. |
| `fn_generar_nro_tramite() no existe` (caso raro) | Funciones PL/pgSQL separadas no aplicadas | Si las migraciones no incluyeron las funciones (caso antiguo) ejecutar manualmente: `docker compose exec postgres psql -U rdam -d rdamdb -f prisma/migrations/20260304015613_init/migration_funciones_sql.sql` o forzar `docker compose exec backend npx prisma migrate deploy`. |

### Nota importante sobre el seed y variables de entorno

El seed (`prisma:seed`) solo se ejecuta si `RUN_PRISMA_SEED=1` está presente en el entorno que ve `docker compose` al arrancar. Para asegurarte de que Compose use `.env.docker` durante el proceso de arranque ejecutá:

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker up -d --build
```

Si usás simplemente `docker compose up -d` es posible que `RUN_PRISMA_SEED` no esté disponible para la interpolación de Compose y por lo tanto el seed no se ejecute automáticamente.

Si ves problemas relacionados con falta de datos (ej. tipos de certificado faltantes), ejecutá el seed manualmente dentro del contenedor `backend`:

```bash
docker compose exec backend npm run prisma:seed
```


---

## Estructura de módulos

```
src/
├── auth/          OTP ciudadano, JWT, login interno, guards
├── solicitudes/   Crear, listar, consulta pública, iniciar pago
├── pagos/         Webhook global, callback S2S, PlusPagos crypto
├── adjuntos/      Upload con validación MIME real (file-type)
├── gestion/       Panel admin: tomar, rechazar, publicar, dashboard
├── certificados/  Descarga pública por token
├── usuarios/      ABM usuarios internos (solo admin)
├── jobs/          Cron jobs: vencimientos + limpieza
└── common/        Storage, Email, PDF, filtros, interceptores
```

---

## Endpoints principales

| Método   | Ruta                                | Auth          | Descripción            |
| -------- | ----------------------------------- | ------------- | ---------------------- |
| POST     | `/auth/otp/solicitar`               | —             | Solicitar OTP          |
| POST     | `/auth/otp/verificar`               | —             | Verificar OTP → JWT    |
| POST     | `/auth/interno/login`               | —             | Login gestor/admin     |
| POST     | `/auth/refresh`                     | Cookie        | Renovar token          |
| POST     | `/auth/logout`                      | —             | Cerrar sesión          |
| POST     | `/solicitudes`                      | JWT ciudadano | Crear solicitud        |
| GET      | `/solicitudes`                      | JWT ciudadano | Listar mis solicitudes |
| GET      | `/solicitudes/estado`               | —             | Consulta pública       |
| POST     | `/solicitudes/:nro/iniciar-pago`    | JWT ciudadano | Payload PlusPagos      |
| POST     | `/adjuntos/upload`                  | JWT ciudadano | Subir archivo          |
| DELETE   | `/adjuntos/:id`                     | JWT ciudadano | Eliminar adjunto       |
| POST     | `/pagos/webhook`                    | —             | Webhook PlusPagos      |
| GET/POST | `/pagos/callback`                   | —             | Callback S2S           |
| GET      | `/certificados/:token`              | —             | Descargar PDF          |
| GET      | `/gestion/solicitudes`              | JWT interno   | Listar con filtros     |
| PATCH    | `/gestion/solicitudes/:id/tomar`    | JWT gestor+   | → en_revision          |
| PATCH    | `/gestion/solicitudes/:id/publicar` | JWT gestor+   | → publicado + PDF      |
| PATCH    | `/gestion/solicitudes/:id/rechazar` | JWT gestor+   | → rechazado            |
| GET      | `/gestion/dashboard`                | JWT interno   | Métricas               |
| GET      | `/usuarios`                         | JWT admin     | Listar usuarios        |
| POST     | `/usuarios`                         | JWT admin     | Crear usuario          |
| PATCH    | `/usuarios/:id`                     | JWT admin     | Actualizar             |
| DELETE   | `/usuarios/:id`                     | JWT admin     | Borrado lógico         |
| GET      | `/internal/health`                  | —             | Health check           |
