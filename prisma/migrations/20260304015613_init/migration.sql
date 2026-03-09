-- CreateEnum
CREATE TYPE "sol_estado_enum" AS ENUM ('pendiente', 'pagado', 'en_revision', 'publicado', 'publicado_vencido', 'vencido', 'rechazado');

-- CreateEnum
CREATE TYPE "rol_interno_enum" AS ENUM ('gestor', 'admin');

-- CreateEnum
CREATE TYPE "tipo_adjunto_enum" AS ENUM ('dni', 'comprobante', 'otro');

-- CreateTable
CREATE TABLE "usuario_interno" (
    "id" SERIAL NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "rol" "rol_interno_enum" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login" TIMESTAMPTZ,
    "updated_by" INTEGER,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_interno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_certificado" (
    "id" SERIAL NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "descripcion" VARCHAR(200) NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "dias_vencimiento_prd" INTEGER NOT NULL DEFAULT 60,
    "dias_vencimiento_dev" INTEGER NOT NULL DEFAULT 15,
    "dias_pdf_prd" INTEGER NOT NULL DEFAULT 65,
    "dias_pdf_dev" INTEGER NOT NULL DEFAULT 90,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipo_certificado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitud" (
    "id" SERIAL NOT NULL,
    "nro_tramite" VARCHAR(30) NOT NULL,
    "cuil" VARCHAR(13) NOT NULL,
    "nombre_completo" VARCHAR(200) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "telefono" VARCHAR(30),
    "tipo_cert_id" INTEGER NOT NULL,
    "sol_estado" "sol_estado_enum" NOT NULL DEFAULT 'pendiente',
    "operador_id" INTEGER,
    "observacion_rechazo" TEXT,
    "token_pdf" CHAR(64),
    "ruta_pdf" VARCHAR(500),
    "pago_intento_id" VARCHAR(36),
    "fec_vencimiento_pago" TIMESTAMPTZ,
    "fec_pago" TIMESTAMPTZ,
    "fec_emision" TIMESTAMPTZ,
    "fec_vencimiento" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitud_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pago" (
    "id" SERIAL NOT NULL,
    "solicitud_id" INTEGER NOT NULL,
    "webhook_id" VARCHAR(100) NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "codigo_pp" INTEGER NOT NULL,
    "estado_pp" VARCHAR(30) NOT NULL,
    "payload_raw" JSONB NOT NULL,
    "procesado" BOOLEAN NOT NULL DEFAULT false,
    "error_msg" TEXT,
    "procesado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjunto" (
    "id" SERIAL NOT NULL,
    "solicitud_id" INTEGER,
    "tipo" "tipo_adjunto_enum" NOT NULL,
    "nombre_orig" VARCHAR(255) NOT NULL,
    "ruta_storage" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "tamanio_bytes" INTEGER NOT NULL,
    "checksum_sha256" CHAR(64),
    "expira_huerfano_at" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjunto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_estado" (
    "id" SERIAL NOT NULL,
    "solicitud_id" INTEGER NOT NULL,
    "estado_ant" "sol_estado_enum",
    "estado_nuevo" "sol_estado_enum" NOT NULL,
    "operador_id" INTEGER,
    "actor" VARCHAR(50) NOT NULL DEFAULT 'sistema',
    "observacion" TEXT,
    "ip_origen" VARCHAR(45),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_estado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_ciudadano" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "codigo" CHAR(6) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "max_intentos" INTEGER NOT NULL DEFAULT 3,
    "expira_at" TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_ciudadano_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_interno_email_key" ON "usuario_interno"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_certificado_codigo_key" ON "tipo_certificado"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_nro_tramite_key" ON "solicitud"("nro_tramite");

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_token_pdf_key" ON "solicitud"("token_pdf");

-- CreateIndex
CREATE UNIQUE INDEX "solicitud_pago_intento_id_key" ON "solicitud"("pago_intento_id");

-- CreateIndex
CREATE UNIQUE INDEX "pago_webhook_id_key" ON "pago"("webhook_id");

-- AddForeignKey
ALTER TABLE "usuario_interno" ADD CONSTRAINT "usuario_interno_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "usuario_interno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_interno" ADD CONSTRAINT "usuario_interno_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "usuario_interno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud" ADD CONSTRAINT "solicitud_tipo_cert_id_fkey" FOREIGN KEY ("tipo_cert_id") REFERENCES "tipo_certificado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitud" ADD CONSTRAINT "solicitud_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuario_interno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pago" ADD CONSTRAINT "pago_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjunto" ADD CONSTRAINT "adjunto_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado" ADD CONSTRAINT "historial_estado_solicitud_id_fkey" FOREIGN KEY ("solicitud_id") REFERENCES "solicitud"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado" ADD CONSTRAINT "historial_estado_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuario_interno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Funciones y trigger adicionales (movidas desde migration_funciones_sql.sql)
-- ============================================================================

ALTER TABLE solicitud
    ADD COLUMN IF NOT EXISTS pago_intento_id VARCHAR(36) UNIQUE;

CREATE OR REPLACE FUNCTION fn_generar_nro_tramite()
RETURNS VARCHAR AS $$
DECLARE
    v_fecha     VARCHAR(8);
    v_prefijo   VARCHAR(14);
    v_ultimo    VARCHAR(30);
    v_secuencia INT;
    v_resultado VARCHAR(30);
BEGIN
    v_fecha   := TO_CHAR(NOW(), 'YYYYMMDD');
    v_prefijo := 'RDAM-' || v_fecha || '-';

    SELECT nro_tramite INTO v_ultimo
    FROM solicitud
    WHERE nro_tramite LIKE v_prefijo || '%'
    ORDER BY nro_tramite DESC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_ultimo IS NULL THEN
        v_secuencia := 1;
    ELSE
        v_secuencia := CAST(SUBSTRING(v_ultimo FROM 15 FOR 4) AS INT) + 1;
    END IF;

    v_resultado := v_prefijo || LPAD(v_secuencia::TEXT, 4, '0');

    RETURN v_resultado;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_auditoria_cambio_estado()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.sol_estado IS DISTINCT FROM NEW.sol_estado) THEN
        INSERT INTO historial_estado (
            solicitud_id,
            estado_ant,
            estado_nuevo,
            operador_id,
            actor,
            created_at
        ) VALUES (
            NEW.id,
            OLD.sol_estado,
            NEW.sol_estado,
            NEW.operador_id,
            CASE
                WHEN NEW.operador_id IS NOT NULL THEN 'operador'
                ELSE 'sistema'
            END,
            NOW()
        );
    END IF;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO historial_estado (
            solicitud_id,
            estado_ant,
            estado_nuevo,
            operador_id,
            actor,
            created_at
        ) VALUES (
            NEW.id,
            NULL,
            NEW.sol_estado,
            NULL,
            'sistema',
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_estado ON solicitud;

CREATE TRIGGER trg_auditoria_estado
    AFTER INSERT OR UPDATE OF sol_estado
    ON solicitud
    FOR EACH ROW
    EXECUTE FUNCTION fn_auditoria_cambio_estado();

CREATE OR REPLACE FUNCTION fn_vencer_solicitudes_pagadas()
RETURNS INT AS $$
DECLARE
    v_actualizadas INT;
BEGIN
    UPDATE solicitud
    SET
        sol_estado = 'vencido',
        updated_at = NOW()
    WHERE
        sol_estado = 'pagado'
        AND fec_vencimiento_pago IS NOT NULL
        AND fec_vencimiento_pago < NOW();

    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
    RETURN v_actualizadas;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_vencer_certificados_publicados()
RETURNS INT AS $$
DECLARE
    v_actualizadas INT;
BEGIN
    UPDATE solicitud
    SET
        sol_estado = 'publicado_vencido',
        updated_at = NOW()
    WHERE
        sol_estado = 'publicado'
        AND fec_vencimiento IS NOT NULL
        AND fec_vencimiento < NOW();

    GET DIAGNOSTICS v_actualizadas = ROW_COUNT;
    RETURN v_actualizadas;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_limpiar_otp_expirados()
RETURNS INT AS $$
DECLARE
    v_eliminados INT;
BEGIN
    DELETE FROM otp_ciudadano
    WHERE
        expira_at < NOW()
        OR usado = TRUE;

    GET DIAGNOSTICS v_eliminados = ROW_COUNT;
    RETURN v_eliminados;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_limpiar_adjuntos_huerfanos()
RETURNS TABLE (
    id              INT,
    ruta_storage    VARCHAR
) AS $$
BEGIN
    RETURN QUERY
        DELETE FROM adjunto
        WHERE
            solicitud_id IS NULL
            AND expira_huerfano_at < NOW()
        RETURNING
            adjunto.id,
            adjunto.ruta_storage;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    RAISE NOTICE '✅ fn_generar_nro_tramite         — OK';
    RAISE NOTICE '✅ fn_auditoria_cambio_estado      — OK (trigger trg_auditoria_estado)';
    RAISE NOTICE '✅ fn_vencer_solicitudes_pagadas   — OK';
    RAISE NOTICE '✅ fn_vencer_certificados_publicados — OK';
    RAISE NOTICE '✅ fn_limpiar_otp_expirados        — OK';
    RAISE NOTICE '✅ fn_limpiar_adjuntos_huerfanos   — OK';
    RAISE NOTICE '✅ columna pago_intento_id         — OK (ADD IF NOT EXISTS)';
END $$;
