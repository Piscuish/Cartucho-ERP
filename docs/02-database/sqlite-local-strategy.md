# Estrategia de Base de Datos SQLite Local, Respaldos Verificados y Migraciones

## 1. Motor de Base de Datos

**SQLite 3** (`3.46.0` embebido mediante `rusqlite` con las features `bundled` y `backup`) es la fuente única de verdad local de **Cartucho ERP**.
- En cada apertura de conexión se configuran y verifican:
  - `PRAGMA journal_mode = WAL;` (Write-Ahead Logging).
  - `PRAGMA foreign_keys = ON;` (Integridad referencial activa).
  - `PRAGMA synchronous = NORMAL;`
  - `PRAGMA busy_timeout = 5000;` (espera hasta 5 s si la base está ocupada en lugar de fallar de inmediato).

---

## 2. Ubicación del Archivo de Base de Datos y Copias de Seguridad

El archivo `cartucho_erp.sqlite3` y sus copias de seguridad (`backups/`) se almacenan fuera de la carpeta de instalación y fuera del repositorio Git:

| Sistema Operativo | Ruta del Archivo SQLite | Carpeta de Copias de Seguridad |
| :--- | :--- | :--- |
| **Windows 10 / 11** | `C:\Users\<Usuario>\AppData\Local\cartucho\cartucho-erp\data\cartucho_erp.sqlite3` | `...\data\backups\` |
| **Linux** | `/home/<usuario>/.local/share/cartucho-erp/cartucho_erp.sqlite3` | `~/.local/share/cartucho-erp/backups/` |
| **macOS** | `/Users/<Usuario>/Library/Application Support/com.cartucho.cartucho-erp/cartucho_erp.sqlite3` | `.../com.cartucho.cartucho-erp/backups/` |

---

## 3. Respaldo Automático Verificado Antes de Migraciones

Siguiendo las reglas obligatorias de `AGENTS.md` (§3, §4 y §9):
1. Cuando `LocalDatabase::initialize_and_migrate()` detecta una base de datos existente (`current_version > 0`) con migraciones pendientes (`current_version < target_version`), ejecuta `create_verified_backup()` **antes** de modificar el esquema.
2. El respaldo utiliza la **API Online Backup de SQLite** (`rusqlite::backup::Backup`), garantizando una copia consistente incluso con modo `WAL` activo.
3. Una vez creada la copia en `<AppDataDir>/backups/cartucho_erp_pre_migration_vX_to_vY_<timestamp>.sqlite3`, se abre una conexión de verificación y se ejecuta `PRAGMA integrity_check`.
4. Si el respaldo o `PRAGMA integrity_check` fallan, el proceso de migración se aborta sin tocar los datos del usuario.

---

## 4. Historial de Migraciones Versionadas (`v1` a `v4`)

Las migraciones publicadas jamás se editan ni eliminan; toda evolución se realiza mediante una nueva migración transaccional:

### Migración `v1`: `0001_init_system_metadata_preferences_and_persistence_checks`
- `_app_metadata`: Pares clave-valor del ciclo de vida (`first_initialized_at`, `startup_count`, `last_opened_at`, `theme_preference`).
- `_persistence_checks`: Tabla técnica para verificar la persistencia en disco entre reinicios.

### Migración `v2`: `0002_create_company_profile_and_installation_entitlements`
- `company_profile` (`CHECK (id = 1)`): Almacena la identidad de la única empresa de la instalación (`trade_name`, `legal_name`, `tax_id`, `address`, `phone`, `email`, `business_profile_key`) y su logotipo como `logo_blob BLOB` + `logo_mime_type TEXT` (`image/png`, `image/jpeg`, `image/webp`, validados en Rust por firma mágica y tamaño máximo de 2 MB). Al estar en SQLite, todo respaldo incluye automáticamente el logotipo.
- `installation_entitlements` (`CHECK (id = 1)`): Almacena de forma desacoplada `commercial_plan_key` (`'local-standard'`), `enabled_modules_json` (`DEFAULT '[]'`) y `enabled_addons_json` (`DEFAULT '[]'`).

### Migración `v3`: `0003_create_app_users_and_permissions`
- `app_users`: Almacena las cuentas de acceso local (`id`, `username UNIQUE COLLATE NOCASE`, `full_name`, `password_hash`, `role_key`, `permissions_json`, `is_active`, `created_at`, `updated_at`, `last_login_at`).
- Las contraseñas se almacenan exclusivamente como hashes **Argon2id** (`$argon2id$v=19$...`).


### Migración `v4`: `0004_create_business_modules_catalog_sales_finance`
Agrega los módulos de negocio sin modificar ninguna tabla anterior (solo `CREATE TABLE IF NOT EXISTS` e inserciones de catálogos base con `INSERT OR IGNORE`):

| Tabla | Propósito | Restricciones clave |
| :--- | :--- | :--- |
| `categories` | Categorías de productos y de gastos | `kind IN ('product','expense')`, `UNIQUE(kind, name COLLATE NOCASE)` |
| `customers` | Directorio de clientes | `name` no vacío, `is_active IN (0,1)` (se archivan, no se borran) |
| `products` | Catálogo con foto (`image_blob` + `image_mime`), precio, costo y existencias | `sku UNIQUE COLLATE NOCASE`, `price/cost >= 0`, MIME permitido |
| `inventory_movements` | Historial de cada cambio de existencias (inicial, compra, ajuste, venta, anulación) | FK a `products ON DELETE RESTRICT` |
| `document_sequences` | Prefijo y consecutivo de facturas y cotizaciones | `next_number >= 1`; solo puede aumentar desde la aplicación |
| `invoices` / `invoice_lines` | Facturas internas con copia de los datos del cliente y costo unitario por línea | `number UNIQUE`, `status IN ('pending','partial','paid','void')`, montos `>= 0` |
| `payments` | Abonos y pagos totales | `amount > 0`, `method IN ('cash','transfer','card','other')`, FK `RESTRICT` |
| `quotes` / `quote_lines` | Cotizaciones convertibles en factura | `status IN ('open','converted','cancelled')` |
| `expenses` | Gastos operativos y compras de inventario | `amount > 0`, `kind IN ('operating','inventory')` |

**Reglas de negocio implementadas en Rust (no solo en React):**
- Montos en pesos enteros (`INTEGER`); cantidades con hasta 3 decimales (`REAL`).
- Crear una factura es **una sola transacción**: consecutivo, líneas, descuento de inventario y pago inicial. Si algo falla, no queda nada a medias (probado).
- Las facturas **no se borran**: se anulan con motivo; el inventario se devuelve y sus pagos dejan de contar como ingreso.
- Los pagos no pueden superar el saldo; no se registran pagos en facturas anuladas.

**Preservación de datos al actualizar v3 → v4:** la migración solo crea tablas nuevas. Antes de aplicarla se crea automáticamente un respaldo verificado `cartucho_erp_pre_migration_v3_to_v4_<fecha>.sqlite3`. La prueba `upgrade_from_v3_preserves_data_and_creates_backup` reproduce una base v3 y comprueba que la empresa y el usuario se conservan, que el respaldo existe y que el esquema queda en v4.

**Recuperación:** si algo saliera mal tras actualizar, cierra la aplicación y usa *Configuración → Base de datos y respaldos → Restaurar* con el archivo `pre_migration_v3_to_v4`, o copia ese archivo como `cartucho_erp.sqlite3` con la aplicación cerrada.

---

## 5. Administración de datos desde la aplicación (`src-tauri/src/data_admin.rs`)

| Acción | Cómo funciona | Protección |
| :--- | :--- | :--- |
| **Exportar copia** | Online Backup hacia la carpeta o archivo elegido (por ejemplo, una USB) | Se verifica con `integrity_check`; nunca sobrescribe un archivo existente |
| **Crear respaldo ahora** | Copia verificada en `backups/` con etiqueta `manual` | Los manuales nunca se depuran |
| **Restaurar** | Valida el archivo (integridad, tablas de Cartucho ERP, versión de esquema no superior), crea un respaldo `pre_restore` del estado actual y copia el respaldo con Online Backup | Luego aplica migraciones y cierra la sesión |
| **Mover a otra carpeta** | Respaldo `pre_move`, copia verificada en la carpeta nueva y escritura de `data_location.json` en la carpeta predeterminada | La base anterior **no se borra**; se deja `LEEME_DATOS_MOVIDOS.txt` |
| **Usar una carpeta existente** | Abre una base traída de otro equipo tras validarla | Respaldo previo del estado actual |
| **Respaldo automático diario** | Al abrir la aplicación, una vez por día | Depuración **solo** si el usuario define cuántos conservar (0 = todos); solo afecta a los de tipo `auto` |

Si la carpeta configurada no está disponible al iniciar (por ejemplo, una USB desconectada), la aplicación ya no se cierra: muestra una pantalla con **Reintentar** y **Usar ubicación predeterminada** (que solo archiva el puntero, sin borrar datos).

> No se debe usar una carpeta de red compartida como mecanismo multiusuario (AGENTS.md §5.6). El trabajo en red local llegará con el modo servidor descrito en `docs/01-architecture/adr/0003-lan-and-cloud-readiness.md`.
