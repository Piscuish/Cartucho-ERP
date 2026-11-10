use chrono::Utc;
use directories::ProjectDirs;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Registro de una migración aplicada en SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub version: i64,
    pub name: String,
    pub applied_at: String,
}

/// Registro de prueba de persistencia local en SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceCheckRecord {
    pub id: i64,
    pub note: String,
    pub created_at: String,
}

/// Estado completo de la base de datos SQLite local.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatusReport {
    pub connected: bool,
    pub engine: String,
    pub sqlite_version: String,
    pub journal_mode: String,
    pub foreign_keys_enabled: bool,
    pub database_path: String,
    pub app_data_dir: String,
    pub database_size_bytes: u64,
    pub schema_version: i64,
    pub applied_migrations: Vec<MigrationRecord>,
    pub startup_count: i64,
    pub first_initialized_at: String,
    pub last_opened_at: String,
    pub recent_persistence_checks: Vec<PersistenceCheckRecord>,
}

/// Preferencias persistidas de la aplicación.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub theme: String,
    pub updated_at: String,
}

/// Estado general de diagnóstico del sistema devuelto por la capa nativa Rust.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverview {
    pub app_name: String,
    pub app_version: String,
    pub phase: String,
    pub architecture_mode: String,
    pub os_platform: String,
    pub os_arch: String,
    pub runtime_mode: String,
    pub preferences: AppPreferences,
    pub database: DatabaseStatusReport,
}

/// Resuelve el directorio de datos de aplicación nativo del sistema operativo:
/// - Windows: %LOCALAPPDATA%\cartucho\cartucho-erp\data
/// - Linux:   ~/.local/share/cartucho-erp
/// - macOS:   ~/Library/Application Support/com.cartucho.cartucho-erp
pub fn resolve_os_app_data_dir() -> Result<PathBuf, String> {
    if let Some(proj_dirs) = ProjectDirs::from("com", "cartucho", "cartucho-erp") {
        let data_dir = proj_dirs.data_local_dir().to_path_buf();
        fs::create_dir_all(&data_dir).map_err(|e| {
            format!(
                "No se pudo crear el directorio de datos de aplicación en {:?}: {}",
                data_dir, e
            )
        })?;
        Ok(data_dir)
    } else {
        Err("No fue posible determinar el directorio de datos del sistema operativo.".to_string())
    }
}

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "0001_init_system_metadata_preferences_and_persistence_checks",
    sql: "
        CREATE TABLE IF NOT EXISTS _app_metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS _persistence_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    ",
}];

const VALID_THEMES: &[&str] = &["light", "dark", "system"];

/// Gestor centralizado de acceso a la base de datos SQLite local.
pub struct LocalDatabase {
    db_path: PathBuf,
    app_data_dir: PathBuf,
}

impl LocalDatabase {
    /// Inicializa la base de datos en el directorio estándar del sistema operativo.
    pub fn open_in_os_app_data() -> Result<Self, String> {
        let app_data_dir = resolve_os_app_data_dir()?;
        Self::open_in_dir(app_data_dir)
    }

    /// Inicializa la base de datos en un directorio específico.
    pub fn open_in_dir<P: AsRef<Path>>(dir: P) -> Result<Self, String> {
        let app_data_dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Error creando directorio de datos {:?}: {}", app_data_dir, e))?;
        let db_path = app_data_dir.join("cartucho_erp.sqlite3");

        let instance = Self {
            db_path,
            app_data_dir,
        };
        instance.initialize_and_migrate()?;
        Ok(instance)
    }

    pub fn database_path(&self) -> &Path {
        &self.db_path
    }

    fn connect(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Error abriendo conexión SQLite en {:?}: {}", self.db_path, e))?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;")
            .map_err(|e| format!("Error configurando PRAGMAs de SQLite: {}", e))?;
        Ok(conn)
    }

    /// Ejecuta las migraciones pendientes dentro de transacciones atómicas y actualiza metadatos de inicio.
    fn initialize_and_migrate(&self) -> Result<(), String> {
        let mut conn = self.connect()?;
        Self::apply_migrations_slice(&mut conn, MIGRATIONS)?;

        let now = Utc::now().to_rfc3339();

        // Registrar marca de primera inicialización si no existe
        conn.execute(
            "INSERT OR IGNORE INTO _app_metadata (key, value, updated_at) VALUES ('first_initialized_at', ?1, ?1)",
            params![&now],
        )
        .map_err(|e| format!("Error guardando first_initialized_at: {}", e))?;

        // Inicializar preferencia de tema por defecto ('system') si no existe
        conn.execute(
            "INSERT OR IGNORE INTO _app_metadata (key, value, updated_at) VALUES ('theme_preference', 'system', ?1)",
            params![&now],
        )
        .map_err(|e| format!("Error inicializando theme_preference: {}", e))?;

        // Incrementar contador de aperturas (startup_count)
        let current_count: i64 = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'startup_count'",
                [],
                |row| {
                    let val: String = row.get(0)?;
                    Ok(val.parse::<i64>().unwrap_or(0))
                },
            )
            .unwrap_or(0);

        let next_count = current_count + 1;
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at)
             VALUES ('startup_count', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![next_count.to_string(), &now],
        )
        .map_err(|e| format!("Error actualizando startup_count: {}", e))?;

        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at)
             VALUES ('last_opened_at', ?1, ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![&now],
        )
        .map_err(|e| format!("Error actualizando last_opened_at: {}", e))?;

        // Si la tabla técnica de pruebas está vacía, registrar el evento fundacional
        let checks_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _persistence_checks", [], |row| row.get(0))
            .map_err(|e| format!("Error consultando conteo de _persistence_checks: {}", e))?;

        if checks_count == 0 {
            conn.execute(
                "INSERT INTO _persistence_checks (note, created_at) VALUES (?1, ?2)",
                params![
                    "Base de datos SQLite creada e inicializada correctamente (Fase 0)",
                    &now
                ],
            )
            .map_err(|e| format!("Error insertando registro inicial de persistencia: {}", e))?;
        }

        Ok(())
    }

    fn apply_migrations_slice(conn: &mut Connection, migrations: &[Migration]) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Error creando tabla _schema_migrations: {}", e))?;

        let now = Utc::now().to_rfc3339();

        for migration in migrations {
            let already_applied: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM _schema_migrations WHERE version = ?1)",
                    params![migration.version],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Error consultando migración {}: {}", migration.version, e))?;

            if !already_applied {
                let tx = conn
                    .transaction()
                    .map_err(|e| format!("Error abriendo transacción para migración {}: {}", migration.name, e))?;
                tx.execute_batch(migration.sql).map_err(|e| {
                    format!("Error ejecutando SQL en migración {}: {}", migration.name, e)
                })?;
                tx.execute(
                    "INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                    params![migration.version, migration.name, &now],
                )
                .map_err(|e| format!("Error registrando migración {}: {}", migration.name, e))?;
                tx.commit()
                    .map_err(|e| format!("Error confirmando transacción de migración {}: {}", migration.name, e))?;
            }
        }

        Ok(())
    }

    /// Inserta un nuevo registro en la tabla técnica `_persistence_checks`.
    pub fn record_persistence_check(&self, note: &str) -> Result<PersistenceCheckRecord, String> {
        let trimmed = note.trim();
        if trimmed.is_empty() {
            return Err("La nota de verificación de persistencia no puede estar vacía.".to_string());
        }
        if trimmed.len() > 280 {
            return Err("La nota de verificación no puede exceder los 280 caracteres.".to_string());
        }

        let conn = self.connect()?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO _persistence_checks (note, created_at) VALUES (?1, ?2)",
            params![trimmed, &now],
        )
        .map_err(|e| format!("Error escribiendo registro en SQLite: {}", e))?;

        let id = conn.last_insert_rowid();

        Ok(PersistenceCheckRecord {
            id,
            note: trimmed.to_string(),
            created_at: now,
        })
    }

    /// Guarda la preferencia de tema ('light', 'dark' o 'system') en SQLite.
    pub fn set_theme_preference(&self, theme: &str) -> Result<AppPreferences, String> {
        let normalized = theme.trim().to_lowercase();
        if !VALID_THEMES.contains(&normalized.as_str()) {
            return Err(format!(
                "Preferencia de tema inválida '{}'. Valores permitidos: light, dark, system.",
                theme
            ));
        }

        let conn = self.connect()?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at)
             VALUES ('theme_preference', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![&normalized, &now],
        )
        .map_err(|e| format!("Error persistiendo preferencia de tema en SQLite: {}", e))?;

        Ok(AppPreferences {
            theme: normalized,
            updated_at: now,
        })
    }

    /// Lee la preferencia de tema actual desde SQLite.
    pub fn get_preferences(&self) -> Result<AppPreferences, String> {
        let conn = self.connect()?;
        let result = conn.query_row(
            "SELECT value, updated_at FROM _app_metadata WHERE key = 'theme_preference'",
            [],
            |row| {
                Ok(AppPreferences {
                    theme: row.get(0)?,
                    updated_at: row.get(1)?,
                })
            },
        );

        match result {
            Ok(prefs) => Ok(prefs),
            Err(_) => Ok(AppPreferences {
                theme: "system".to_string(),
                updated_at: Utc::now().to_rfc3339(),
            }),
        }
    }

    /// Genera el informe técnico del estado actual de SQLite.
    pub fn status_report(&self) -> Result<DatabaseStatusReport, String> {
        let conn = self.connect()?;

        let sqlite_version: String = conn
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))
            .map_err(|e| format!("Error consultando sqlite_version(): {}", e))?;

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap_or_else(|_| "wal".to_string());

        let fk_flag: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap_or(1);

        let schema_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Error consultando versión de esquema: {}", e))?;

        let mut stmt_mig = conn
            .prepare(
                "SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC",
            )
            .map_err(|e| format!("Error preparando consulta de migraciones: {}", e))?;

        let applied_migrations = stmt_mig
            .query_map([], |row| {
                Ok(MigrationRecord {
                    version: row.get(0)?,
                    name: row.get(1)?,
                    applied_at: row.get(2)?,
                })
            })
            .map_err(|e| format!("Error leyendo migraciones aplicadas: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Error mapeando migraciones: {}", e))?;

        let startup_count: i64 = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'startup_count'",
                [],
                |row| {
                    let s: String = row.get(0)?;
                    Ok(s.parse::<i64>().unwrap_or(1))
                },
            )
            .unwrap_or(1);

        let first_initialized_at: String = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'first_initialized_at'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| Utc::now().to_rfc3339());

        let last_opened_at: String = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'last_opened_at'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| Utc::now().to_rfc3339());

        let mut stmt_checks = conn
            .prepare(
                "SELECT id, note, created_at FROM _persistence_checks ORDER BY id DESC LIMIT 12",
            )
            .map_err(|e| format!("Error preparando consulta de pruebas de persistencia: {}", e))?;

        let recent_persistence_checks = stmt_checks
            .query_map([], |row| {
                Ok(PersistenceCheckRecord {
                    id: row.get(0)?,
                    note: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })
            .map_err(|e| format!("Error leyendo registros de persistencia: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Error mapeando registros de persistencia: {}", e))?;

        let database_size_bytes = fs::metadata(&self.db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(DatabaseStatusReport {
            connected: true,
            engine: "SQLite".to_string(),
            sqlite_version,
            journal_mode,
            foreign_keys_enabled: fk_flag == 1,
            database_path: self.db_path.to_string_lossy().to_string(),
            app_data_dir: self.app_data_dir.to_string_lossy().to_string(),
            database_size_bytes,
            schema_version,
            applied_migrations,
            startup_count,
            first_initialized_at,
            last_opened_at,
            recent_persistence_checks,
        })
    }

    /// Construye el resumen integral del sistema leyendo el estado real desde SQLite.
    pub fn build_system_overview(&self) -> Result<SystemOverview, String> {
        let database = self.status_report()?;
        let preferences = self.get_preferences()?;

        Ok(SystemOverview {
            app_name: "Cartucho ERP".to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            phase: "Fase 0 — Fundación Local-First".to_string(),
            architecture_mode: "local-first".to_string(),
            os_platform: std::env::consts::OS.to_string(),
            os_arch: std::env::consts::ARCH.to_string(),
            runtime_mode: "tauri-desktop".to_string(),
            preferences,
            database,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_sqlite_creation_write_read_and_reopen_persistence() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let data_path = temp_dir.path().to_path_buf();

        // Sesión 1: Inicialización, migración automática e inserción de un registro de prueba
        {
            let db = LocalDatabase::open_in_dir(&data_path).expect("Debe inicializar SQLite");
            assert!(db.database_path().exists());

            let initial = db.status_report().expect("Debe obtener reporte inicial");
            assert!(initial.connected);
            assert_eq!(initial.engine, "SQLite");
            assert_eq!(initial.journal_mode.to_lowercase(), "wal");
            assert!(initial.foreign_keys_enabled);
            assert_eq!(initial.schema_version, 1);
            assert_eq!(initial.startup_count, 1);
            assert_eq!(initial.applied_migrations.len(), 1);
            assert_eq!(initial.recent_persistence_checks.len(), 1);

            let inserted = db
                .record_persistence_check("Verificación de escritura en Sesión 1")
                .expect("Debe insertar registro de prueba");
            assert_eq!(inserted.note, "Verificación de escritura en Sesión 1");

            let prefs = db
                .set_theme_preference("dark")
                .expect("Debe guardar preferencia de tema");
            assert_eq!(prefs.theme, "dark");
        }

        // Sesión 2: Cerrar y volver a abrir sobre la misma ruta para comprobar persistencia real en disco
        {
            let db_reopened =
                LocalDatabase::open_in_dir(&data_path).expect("Debe reabrir SQLite existente");
            let report = db_reopened
                .status_report()
                .expect("Debe leer estado tras reapertura");
            let prefs = db_reopened
                .get_preferences()
                .expect("Debe leer preferencias tras reapertura");

            assert_eq!(report.startup_count, 2);
            assert_eq!(report.schema_version, 1);
            assert_eq!(report.applied_migrations.len(), 1);
            assert_eq!(report.recent_persistence_checks.len(), 2);
            assert_eq!(
                report.recent_persistence_checks[0].note,
                "Verificación de escritura en Sesión 1"
            );
            assert_eq!(prefs.theme, "dark");
        }
    }

    #[test]
    fn test_validation_and_migration_rollback_error_handling() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let db = LocalDatabase::open_in_dir(temp_dir.path()).expect("Debe inicializar SQLite");

        // Validar rechazo de notas vacías
        let empty_err = db.record_persistence_check("   ");
        assert!(empty_err.is_err());

        // Validar rechazo de tema inválido
        let theme_err = db.set_theme_preference("neon-purple");
        assert!(theme_err.is_err());

        // Validar que una migración con SQL inválido hace rollback y devuelve error controlado
        let mut conn = db.connect().expect("Debe conectar");
        let bad_migrations = [Migration {
            version: 99,
            name: "0099_invalid_sql_migration",
            sql: "CREATE TABLE broken_syntax (id INT",
        }];
        let mig_result = LocalDatabase::apply_migrations_slice(&mut conn, &bad_migrations);
        assert!(mig_result.is_err());

        // La versión de esquema debe continuar en 1 (sin aplicar la migración 99 fallida)
        let report = db.status_report().expect("Debe seguir operativa");
        assert_eq!(report.schema_version, 1);
    }

    #[test]
    fn test_os_app_data_dir_is_outside_repository() {
        let app_data_dir =
            resolve_os_app_data_dir().expect("Debe resolver directorio de datos del SO");
        let current_repo_dir = std::env::current_dir().expect("Debe obtener directorio actual");
        assert!(!app_data_dir.starts_with(&current_repo_dir));
    }
}
