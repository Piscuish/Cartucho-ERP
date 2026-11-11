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
        let mut db = state
            .db
            .lock()
            .expect("No se pudo adquirir bloqueo de SQLite");

        if args.len() >= 6 && args[1] == "--setup" {
            let input = cartucho_erp_desktop_lib::db::CompleteInitialSetupInput {
                company: cartucho_erp_desktop_lib::db::SaveCompanyProfileInput {
                    trade_name: args[2].clone(),
                    ..Default::default()
                },
                admin: cartucho_erp_desktop_lib::db::CreateInitialAdminInput {
                    full_name: args[3].clone(),
                    username: args[4].clone(),
                    password: args[5].clone(),
                    password_confirm: args[5].clone(),
                },
            };
            db.complete_initial_setup(&input)
                .expect("Error al completar la configuración inicial atómica");
        } else if args.len() >= 4 && args[1] == "--login" {
            db.login(&args[2], &args[3])
                .expect("Error al iniciar sesión en SQLite");

            if args.len() >= 6 && args[4] == "--record-check" {
                db.record_persistence_check(&args[5])
                    .expect("Error al registrar prueba de persistencia en SQLite");
            } else if args.len() >= 6 && args[4] == "--set-theme" {
                db.set_theme_preference(&args[5])
                    .expect("Error al guardar preferencia de tema en SQLite");
            }
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
