-- Servidor de licencias de Cartucho ERP — esquema inicial.
-- Las licencias y equipos nunca se borran: se desactivan (status = 'revoked').

CREATE TABLE IF NOT EXISTS licenses (
  key           TEXT PRIMARY KEY,                -- CE-XXXX-XXXX-XXXX-XXXX
  customer      TEXT NOT NULL,                   -- nombre del negocio
  contact       TEXT,                            -- teléfono / correo del cliente
  plan          TEXT NOT NULL,                   -- basico | tienda | completo | personalizado
  modules       TEXT NOT NULL,                   -- JSON: ["invoices", ...]
  max_devices   INTEGER NOT NULL CHECK (max_devices BETWEEN 1 AND 5),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at    INTEGER,                         -- segundos Unix; NULL = no vence
  support       TEXT,                            -- contacto de soporte propio de esta licencia
  notes         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key   TEXT NOT NULL REFERENCES licenses(key),
  device_code   TEXT NOT NULL,                   -- XXXX-XXXX-XXXX-XXXX (huella del equipo)
  device_name   TEXT,
  os            TEXT,
  app_version   TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  first_seen    INTEGER NOT NULL,
  last_seen     INTEGER NOT NULL,
  last_ip       TEXT,
  last_country  TEXT,
  UNIQUE (license_key, device_code)
);

CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key   TEXT,
  device_code   TEXT,
  kind          TEXT NOT NULL,                   -- activate | checkin | rejected | admin_*
  detail        TEXT,
  ip            TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_license ON events(license_key, created_at);
