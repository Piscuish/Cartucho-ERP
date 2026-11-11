#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "desktop-tauri")]
    {
        cartucho_erp_desktop_lib::run_tauri_app();
    }

    // Sin la interfaz de Tauri solo se muestra un diagnóstico de la base local.
    // Ya no se aceptan contraseñas por línea de comandos (quedaban en el historial).
    #[cfg(not(feature = "desktop-tauri"))]
    {
        let state = cartucho_erp_desktop_lib::AppState::initialize();
        match state.with_db(|db| db.status_report()) {
            Ok(report) => println!(
                "{}",
                serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".to_string())
            ),
            Err(e) => {
                eprintln!("{}", e);
                std::process::exit(1);
            }
        }
        eprintln!("Para abrir la aplicación ejecuta: pnpm tauri:dev");
    }
}
