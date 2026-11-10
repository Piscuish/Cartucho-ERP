pub mod db;

use db::LocalDatabase;
use std::sync::Mutex;

/// Estado compartido de la aplicación gestionado por Tauri.
pub struct AppState {
    pub db: Mutex<LocalDatabase>,
}

impl AppState {
    pub fn initialize() -> Result<Self, String> {
        let db = LocalDatabase::open_in_os_app_data()?;
        Ok(Self {
            db: Mutex::new(db),
        })
    }
}

#[cfg(feature = "desktop-tauri")]
mod tauri_commands {
    use super::*;
    use db::SystemOverview;
    use tauri::State;

    #[tauri::command]
    pub fn get_system_overview(state: State<'_, AppState>) -> Result<SystemOverview, String> {
        let db = state
            .db
            .lock()
            .map_err(|_| "Error interno al bloquear el gestor de base de datos local.".to_string())?;
        db.build_system_overview()
    }

    #[tauri::command]
    pub fn record_persistence_check(
        note: String,
        state: State<'_, AppState>,
    ) -> Result<SystemOverview, String> {
        let db = state
            .db
            .lock()
            .map_err(|_| "Error interno al bloquear el gestor de base de datos local.".to_string())?;
        db.record_persistence_check(&note)?;
        db.build_system_overview()
    }

    #[tauri::command]
    pub fn set_theme_preference(
        theme: String,
        state: State<'_, AppState>,
    ) -> Result<SystemOverview, String> {
        let db = state
            .db
            .lock()
            .map_err(|_| "Error interno al bloquear el gestor de base de datos local.".to_string())?;
        db.set_theme_preference(&theme)?;
        db.build_system_overview()
    }

    pub fn run_tauri_app() {
        let app_state = AppState::initialize()
            .expect("Error crítico al inicializar la base de datos SQLite local de Cartucho ERP");

        tauri::Builder::default()
            .manage(app_state)
            .invoke_handler(tauri::generate_handler![
                get_system_overview,
                record_persistence_check,
                set_theme_preference
            ])
            .run(tauri::generate_context!())
            .expect("Error al ejecutar la aplicación de escritorio Tauri 2");
    }
}

#[cfg(feature = "desktop-tauri")]
pub use tauri_commands::run_tauri_app;
