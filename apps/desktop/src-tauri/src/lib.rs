use chrono::Utc;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Registro de migración de esquema (estructura base preparada para Etapa 4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub version: i64,
    pub name: String,
    pub applied_at: String,
}

/// Registro de prueba de persistencia (estructura base preparada para Etapa 4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceCheckRecord {
    pub id: i64,
    pub note: String,
    pub created_at: String,
}

/// Estado del almacenamiento local reportado por la capa Rust.
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

/// Preferencias de la aplicación de escritorio.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Construye el resumen del sistema en la Etapa 3 (previo a la conexión SQLite de la Etapa 4).
pub fn build_stage3_system_overview() -> Result<SystemOverview, String> {
    let app_data_dir = resolve_os_app_data_dir()?;
    let db_path = app_data_dir.join("cartucho_erp.sqlite3");
    let now = Utc::now().to_rfc3339();

    Ok(SystemOverview {
        app_name: "Cartucho ERP".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        phase: "Fase 0 — Etapa 3 (Tauri 2 + Rust)".to_string(),
        architecture_mode: "local-first".to_string(),
        os_platform: std::env::consts::OS.to_string(),
        os_arch: std::env::consts::ARCH.to_string(),
        runtime_mode: "tauri-desktop".to_string(),
        preferences: AppPreferences {
            theme: "system".to_string(),
            updated_at: now.clone(),
        },
        database: DatabaseStatusReport {
            connected: false,
            engine: "SQLite".to_string(),
            sqlite_version: "Pendiente (Etapa 4)".to_string(),
            journal_mode: "wal".to_string(),
            foreign_keys_enabled: true,
            database_path: db_path.to_string_lossy().to_string(),
            app_data_dir: app_data_dir.to_string_lossy().to_string(),
            database_size_bytes: 0,
            schema_version: 0,
            applied_migrations: vec![],
            startup_count: 1,
            first_initialized_at: now.clone(),
            last_opened_at: now,
            recent_persistence_checks: vec![],
        },
    })
}

#[cfg(feature = "desktop-tauri")]
mod tauri_commands {
    use super::*;

    #[tauri::command]
    pub fn get_system_overview() -> Result<SystemOverview, String> {
        build_stage3_system_overview()
    }

    pub fn run_tauri_app() {
        tauri::Builder::default()
            .invoke_handler(tauri::generate_handler![get_system_overview])
            .run(tauri::generate_context!())
            .expect("Error al ejecutar la aplicación de escritorio Tauri 2");
    }
}

#[cfg(feature = "desktop-tauri")]
pub use tauri_commands::run_tauri_app;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stage3_os_app_data_dir_and_overview() {
        let overview =
            build_stage3_system_overview().expect("Debe generar el estado base en Rust");
        assert_eq!(overview.app_name, "Cartucho ERP");
        assert_eq!(overview.architecture_mode, "local-first");
        assert!(!overview.database.app_data_dir.is_empty());
    }
}
