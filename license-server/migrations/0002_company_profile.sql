-- Datos de la empresa del cliente. Viajan dentro del token firmado para que el programa
-- los reconozca al activarse y llene solo el asistente inicial. Columnas opcionales (aditivo).
ALTER TABLE licenses ADD COLUMN legal_name TEXT;
ALTER TABLE licenses ADD COLUMN tax_id TEXT;
ALTER TABLE licenses ADD COLUMN company_phone TEXT;
ALTER TABLE licenses ADD COLUMN company_email TEXT;
ALTER TABLE licenses ADD COLUMN company_address TEXT;
