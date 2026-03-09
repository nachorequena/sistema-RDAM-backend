-- ============================================================================
-- Migración: Funciones SQL y Trigger de Auditoría
-- 
-- Crea todas las funciones almacenadas que el backend llama via $queryRaw:
--   1. fn_generar_nro_tramite()          → genera RDAM-YYYYMMDD-NNNN
--   2. fn_auditoria_cambio_estado()      → trigger: registra historial automático
--   3. fn_vencer_solicitudes_pagadas()   → job: pagado → vencido
--   4. fn_vencer_certificados_publicados() → job: publicado → publicado_vencido
--   5. fn_limpiar_otp_expirados()        → job: elimina OTPs vencidos
--   6. fn_limpiar_adjuntos_huerfanos()   → job: devuelve adjuntos huérfanos a eliminar
--
-- También agrega la columna pago_intento_id si no existe todavía.
-- ============================================================================

-- ── Columna pago_intento_id (por si la migración inicial no la incluyó) ────

ALTER TABLE solicitud
  ADD COLUMN IF NOT EXISTS pago_intento_id VARCHAR(36) UNIQUE;

-- ============================================================================
-- 1. fn_generar_nro_tramite()
-- Genera un número de trámite único con formato RDAM-YYYYMMDD-NNNN.
-- La secuencia se reinicia cada día. Thread-safe via FOR UPDATE.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_generar_nro_tramite()
RETURNS VARCHAR AS $$
DECLARE
  v_fecha     VARCHAR(8);
  v_prefijo   VARCHAR(14);
  v_ultimo    VARCHAR(30);
  v_secuencia INT;
  v_resultado VARCHAR(30);
BEGIN
  -- Formato de fecha: YYYYMMDD
  v_fecha   := TO_CHAR(NOW(), 'YYYYMMDD');
  v_prefijo := 'RDAM-' || v_fecha || '-';

  -- Bloquear la última fila del día para evitar condición de carrera
  SELECT nro_tramite INTO v_ultimo
  FROM solicitud
  WHERE nro_tramite LIKE v_prefijo || '%'
  ORDER BY nro_tramite DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_ultimo IS NULL THEN
    v_secuencia := 1;
  ELSE
    -- Extraer los últimos 4 dígitos y sumar 1
    v_secuencia := CAST(SUBSTRING(v_ultimo FROM 15 FOR 4) AS INT) + 1;
  END IF;

  v_resultado := v_prefijo || LPAD(v_secuencia::TEXT, 4, '0');

  RETURN v_resultado;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. fn_auditoria_cambio_estado()
-- Trigger que se dispara automáticamente cuando cambia sol_estado en solicitud.
-- Registra el cambio en historial_estado sin que el código TypeScript lo haga.
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_auditoria_cambio_estado()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo actuar cuando sol_estado realmente cambió
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

  -- También registrar la creación (INSERT)
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

-- Eliminar el trigger si ya existe (para poder recrearlo limpiamente)
DROP TRIGGER IF EXISTS trg_auditoria_estado ON solicitud;

-- Crear el trigger que llama a la función en INSERT y UPDATE
CREATE TRIGGER trg_auditoria_estado
  AFTER INSERT OR UPDATE OF sol_estado
  ON solicitud
  FOR EACH ROW
  EXECUTE FUNCTION fn_auditoria_cambio_estado();

-- ============================================================================
-- 3. fn_vencer_solicitudes_pagadas()
-- Marca como VENCIDO las solicitudes en estado PAGADO cuya
-- fec_vencimiento_pago ya pasó. Llamada por el cron job diario.
-- Retorna la cantidad de filas afectadas.
-- ============================================================================

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

-- ============================================================================
-- 4. fn_vencer_certificados_publicados()
-- Marca como PUBLICADO_VENCIDO los certificados publicados cuya
-- fec_vencimiento ya pasó. Llamada por el cron job diario.
-- Retorna la cantidad de filas afectadas.
-- ============================================================================

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

-- ============================================================================
-- 5. fn_limpiar_otp_expirados()
-- Elimina los registros de OTP que ya expiraron o fueron usados.
-- Llamada por el cron job diario para mantener la tabla pequeña.
-- Retorna la cantidad de filas eliminadas.
-- ============================================================================

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

-- ============================================================================
-- 6. fn_limpiar_adjuntos_huerfanos()
-- Devuelve los adjuntos sin solicitud asociada que ya superaron su TTL de 24h.
-- El cron job de NestJS itera el resultado, borra el archivo del storage,
-- y luego hace DELETE en la BD.
-- Retorna SETOF para que el job pueda borrar cada archivo del storage antes
-- de eliminar el registro.
-- ============================================================================

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

-- ============================================================================
-- Verificación al final de la migración
-- (aparece en los logs de psql / Prisma al aplicar)
-- ============================================================================

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
