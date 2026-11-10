#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;

fn main() {
    #[cfg(feature = "desktop-tauri")]
    {
        cartucho_erp_desktop_lib::run_tauri_app();
    }

    #[cfg(not(feature = "desktop-tauri"))]
    {
        let args: Vec<String> = env::args().collect();
        let state = cartucho_erp_desktop_lib::AppState::initialize()
            .expect("No se pudo inicializar la base de datos SQLite local");
        let db = state
            .db
            .lock()
            .expect("No se pudo adquirir bloqueo de SQLite");

        if args.len() >= 3 && args[1] == "--record-check" {
            db.record_persistence_check(&args[2])
                .expect("Error al registrar prueba de persistencia en SQLite");
        } else if args.len() >= 3 && args[1] == "--set-theme" {
            db.set_theme_preference(&args[2])
                .expect("Error al guardar preferencia de tema en SQLite");
        }

        let overview = db
            .build_system_overview()
            .expect("No se pudo generar el reporte del sistema desde SQLite");
        println!(
            "{}",
            serde_json::to_string_pretty(&overview)
                .expect("Error serializando reporte del sistema")
        );
    }
}
