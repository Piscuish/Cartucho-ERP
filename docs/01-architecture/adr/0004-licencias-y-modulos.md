# ADR 0004 — Licencias y módulos por cliente

- **Estado:** Aceptada. Servidor listo para publicar; aún no conectado a Cloudflare.
- **Fecha:** 2026-11-11

## Contexto

El propietario venderá Cartucho ERP a distintos negocios y quiere: (1) activar o desactivar módulos por
cliente, (2) evitar copias no autorizadas, (3) ver quién está conectado y (4) cerrar instalaciones
duplicadas. Decisiones del propietario: Cloudflare (Workers + D1), de 1 a 5 equipos por licencia,
activación con clave o código dado por el proveedor, **30 días sin Internet**, y al desactivar
**solo ver facturas** con el inicio indicando **«Contacta a soporte»**.

## Decisión

1. **Licencia fuera de la base de datos.** `license.json` vive en la carpeta de datos del sistema
   operativo (no en SQLite), así que restaurar o mover la base no la afecta. No hay migración de esquema.
2. **Token firmado Ed25519.** El servidor firma `{cliente, plan, módulos, equipos, código de equipo,
   estado, emisión, vence}`; el programa verifica con la clave pública incrustada al compilar
   (`license_public_key.txt`). Funciona sin conexión hasta `exp` = última validación + 30 días.
3. **Código de equipo** = SHA-256 del identificador de la máquina, en 16 caracteres sin ambigüedades.
   Un token copiado a otra PC no sirve (`other_device`).
4. **Compuertas en Rust.** Cada comando IPC pasa por `AppState::gated(Gate, …)`:
   `Core`, `CoreWrite`, `Read(m)`, `Write(m)`, `License`, `DataExport`, `DataAdmin`. React solo oculta lo que
   Rust rechazaría. Módulos desactivados también cambian reglas: sin Inventario no se descuenta stock,
   sin Clientes/Catálogo no se enlazan, sin Gastos una compra no crea gasto.
5. **Modo restringido** (licencia o equipo desactivado, licencia vencida, >30 días sin validar, reloj
   atrasado): solo `Read("invoices")`, `Core`, `License` y `DataExport`. Ningún dato se borra.
6. **Validación periódica**: al iniciar (5 s) y cada hora; evento `license-changed` si cambia el modo o los módulos.
7. **Servidor** (`license-server/`): Worker con `/v1/activate`, `/v1/checkin` y API de administración
   protegida con `ADMIN_TOKEN`; D1 con `licenses`, `devices`, `events`; panel web estático.
   Las licencias y equipos nunca se borran, solo se desactivan.
8. **Desarrollo:** compilaciones debug sin clave pública → modo `dev` con todos los módulos.

## Consecuencias

- Un instalador de producción **requiere** clave pública y URL del servidor configuradas.
- Si se pierde la clave privada no se pueden renovar tokens; cambiarla invalida todas las licencias.
- Es una protección para binarios distribuidos: con el código fuente público, alguien puede compilar sin licencia.
