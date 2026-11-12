-- Menú personalizado por cliente (viaja en el token) y registro manual de pagos. Aditivo.
ALTER TABLE licenses ADD COLUMN ui TEXT;

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT NOT NULL REFERENCES licenses(key),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  method TEXT,
  paid_at INTEGER NOT NULL,
  covers_until INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_license ON payments(license_key, paid_at DESC);
