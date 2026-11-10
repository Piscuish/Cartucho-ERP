#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "desktop-tauri")]
    {
        cartucho_erp_desktop_lib::run_tauri_app();
    }

    #[cfg(not(feature = "desktop-tauri"))]
    {
        let overview = cartucho_erp_desktop_lib::build_stage3_system_overview()
            .expect("No se pudo generar el estado base de Cartucho ERP en Rust");
        println!(
            "{}",
            serde_json::to_string_pretty(&overview)
                .expect("Error serializando reporte del sistema")
        );
    }
}
