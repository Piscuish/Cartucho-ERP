# Estrategia de Base de Datos SQLite Local, Directorios de SO y Migraciones

## 1. Motor de Base de Datos

**SQLite 3** es la única base de datos de la primera versión de **Cartucho ERP**.
- Se compila de forma embebida junto con la capa Rust (`rusqlite` con la feature `bundled`), garantizando que todas las instalaciones en Windows, Linux y macOS ejecuten exactamente la misma versión moderna de SQLite sin depender de librerías preinstaladas en el sistema.
- Se configura automáticamente al abrir la conexión con:
  - `PRAGMA journal_mode = WAL;` (Write-Ahead Logging para mayor rendimiento e integridad ante cierres inesperados).
  - `PRAGMA foreign_keys = ON;` (Integridad referencial estricta).

---

## 2. Ubicación del Archivo de Base de Datos por Sistema Operativo

El archivo `cartucho_erp.sqlite3` **nunca** se guarda dentro de la carpeta de instalación del programa (`Program Files`, `/usr/bin`, `/Applications`) ni dentro del repositorio de código fuente.

La función `resolve_os_app_data_dir()` en `apps/desktop/src-tauri/src/db.rs` resuelve automáticamente la ruta estándar de datos locales del usuario según las convenciones de cada sistema operativo:

| Sistema Operativo | Ruta Estándar Resuelta |
| :--- | :--- |
| **Windows 10 / 11** | `C:\Users\<Usuario>\AppData\Local\cartucho\cartucho-erp\data\cartucho_erp.sqlite3` |
| **Linux** | `/home/<usuario>/.local/share/cartucho-erp/cartucho_erp.sqlite3` (o `$XDG_DATA_HOME/cartucho-erp/cartucho_erp.sqlite3`) |
| **macOS** | `/Users/<Usuario>/Library/Application Support/com.cartucho.cartucho-erp/cartucho_erp.sqlite3` |

Esto asegura que:
1. La aplicación no requiera permisos de Administrador (`sudo` / UAC) para leer y escribir datos.
2. Al actualizar el ejecutable de la aplicación, los datos del usuario permanezcan intactos.

---

## 3. Mecanismo de Migraciones de Esquema

El módulo `src/db.rs` incluye un motor de migraciones determinista y transaccional:

1. Al iniciar la aplicación, se asegura la existencia de la tabla de control `_schema_migrations`:
   ```sql
   CREATE TABLE IF NOT EXISTS _schema_migrations (
       version INTEGER PRIMARY KEY NOT NULL,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
   );
   ```
2. Recorre en orden secuencial la lista de migraciones definidas en Rust (`MIGRATIONS`).
3. Por cada migración no registrada en `_schema_migrations`, abre una **transacción atómica**, ejecuta el DDL correspondiente y registra la versión aplicada con marca de tiempo UTC ISO-8601.
4. Si una migración falla, la transacción hace `ROLLBACK` completo, evitando dejar la base de datos en un estado intermedio corrupto.

---

## 4. Alcance del Esquema en la Fase 0

De acuerdo con las reglas de la Fase 0, **no se han creado tablas de negocio** (sin clientes, inventario, ventas ni contabilidad). Únicamente existen las tablas técnicas de diagnóstico:

- `_schema_migrations`: Registro de versiones de esquema aplicadas.
- `_app_metadata`: Pares clave-valor del ciclo de vida de la instalación (`first_initialized_at`, `startup_count`, `last_opened_at`).
- `_persistence_checks`: Registro de eventos de prueba para comprobar que la escritura en SQLite persiste entre cierres y reaperturas del programa.
