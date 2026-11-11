# Estrategia de Base de Datos SQLite Local, Respaldos Verificados y Migraciones

## 1. Motor de Base de Datos

**SQLite 3** (`3.46.0` embebido mediante `rusqlite` con las features `bundled` y `backup`) es la fuente única de verdad local de **Cartucho ERP**.
- En cada apertura de conexión se configuran y verifican:
  - `PRAGMA journal_mode = WAL;` (Write-Ahead Logging).
  - `PRAGMA foreign_keys = ON;` (Integridad referencial activa).
  - `PRAGMA synchronous = NORMAL;`

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

## 4. Historial de Migraciones Versionadas (`v1` a `v3`)

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
