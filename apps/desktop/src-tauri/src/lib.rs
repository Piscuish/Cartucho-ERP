pub mod data_admin;
pub mod db;
pub mod erp;

use db::LocalDatabase;
use std::sync::Mutex;

/// Estado compartido de la aplicación gestionado por Tauri.
///
/// Si la base de datos no puede abrirse al iniciar (por ejemplo, la carpeta de datos
/// configurada está en una unidad desconectada), la aplicación no se cierra: guarda el
/// error para mostrarlo en pantalla y ofrecer cómo resolverlo.
pub struct AppState {
    pub db: Mutex<Option<LocalDatabase>>,
    pub startup_error: Mutex<Option<String>>,
}

impl AppState {
    pub fn initialize() -> Self {
        match LocalDatabase::open_in_os_app_data() {
            Ok(db) => {
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                // El respaldo diario nunca impide abrir la aplicación.
                let _ = db.run_daily_backup_if_due(&today);
                Self {
                    db: Mutex::new(Some(db)),
                    startup_error: Mutex::new(None),
                }
            }
            Err(e) => Self {
                db: Mutex::new(None),
                startup_error: Mutex::new(Some(e)),
            },
        }
    }

    /// Ejecuta una operación con acceso a la base de datos abierta.
    pub fn with_db<T>(
        &self,
        f: impl FnOnce(&mut LocalDatabase) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.db.lock().map_err(|_| {
            "Error interno al bloquear el gestor de base de datos local.".to_string()
        })?;
        match guard.as_mut() {
            Some(db) => f(db),
            None => {
                let msg = self
                    .startup_error
                    .lock()
                    .ok()
                    .and_then(|e| e.clone())
                    .unwrap_or_else(|| "La base de datos no está disponible.".to_string());
                Err(format!("STARTUP_ERROR: {}", msg))
            }
        }
    }

    /// Vuelve a la carpeta de datos predeterminada y reintenta abrir la base.
    pub fn reset_to_default_location(&self) -> Result<(), String> {
        let default_dir = db::resolve_os_app_data_dir()?;
        data_admin::reset_location_pointer(&default_dir)?;
        self.retry_open()
    }

    pub fn retry_open(&self) -> Result<(), String> {
        let db = LocalDatabase::open_in_os_app_data()?;
        let mut guard = self
            .db
            .lock()
            .map_err(|_| "Error interno de bloqueo.".to_string())?;
        *guard = Some(db);
        if let Ok(mut e) = self.startup_error.lock() {
            *e = None;
        }
        Ok(())
    }
}

#[cfg(feature = "desktop-tauri")]
mod tauri_commands {
    use super::*;
    use crate::data_admin::{DataLocationInfo, RestoreResult};
    use crate::erp::catalog::{
        Category, InventoryMovement, Product, ProductInput, StockAdjustmentInput,
    };
    use crate::erp::customers::{Customer, CustomerInput};
    use crate::erp::finance::{DashboardData, Expense, ExpenseInput, FinanceSummary, SearchHit};
    use crate::erp::sales::{
        InvoiceDetail, InvoiceFilter, InvoiceInput, InvoiceSummary, Payment, PaymentInput,
        QuoteDetail, QuoteInput, QuoteSummary,
    };
    use crate::erp::settings::BusinessSettings;
    use db::{
        ChangePasswordInput, CompleteInitialSetupInput, LoginInput, SaveCompanyProfileInput,
        SystemOverview,
    };
    use tauri::State;

    type S<'a> = State<'a, AppState>;

    // ------------------------------------------------------------ Sistema y sesión

    #[tauri::command]
    pub fn get_system_overview(state: S<'_>) -> Result<SystemOverview, String> {
        state.with_db(|db| db.build_system_overview())
    }

    #[tauri::command]
    pub fn reset_data_location(state: S<'_>) -> Result<SystemOverview, String> {
        state.reset_to_default_location()?;
        state.with_db(|db| db.build_system_overview())
    }

    #[tauri::command]
    pub fn retry_open_database(state: S<'_>) -> Result<SystemOverview, String> {
        state.retry_open()?;
        state.with_db(|db| db.build_system_overview())
    }

    #[tauri::command]
    pub fn complete_initial_setup(
        input: CompleteInitialSetupInput,
        state: S<'_>,
    ) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.complete_initial_setup(&input)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn login_user(input: LoginInput, state: S<'_>) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.login(&input.username, &input.password)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn logout_user(state: S<'_>) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.logout();
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn change_user_password(
        input: ChangePasswordInput,
        state: S<'_>,
    ) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.change_authenticated_user_password(&input)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn record_persistence_check(note: String, state: S<'_>) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.record_persistence_check(&note)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn set_theme_preference(theme: String, state: S<'_>) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.set_theme_preference(&theme)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn save_company_profile(
        input: SaveCompanyProfileInput,
        state: S<'_>,
    ) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.save_company_profile(&input)?;
            db.build_system_overview()
        })
    }

    // ------------------------------------------------------------ Clientes

    #[tauri::command]
    pub fn list_customers(
        search: Option<String>,
        include_inactive: bool,
        state: S<'_>,
    ) -> Result<Vec<Customer>, String> {
        state.with_db(|db| db.list_customers(search, include_inactive))
    }

    #[tauri::command]
    pub fn save_customer(input: CustomerInput, state: S<'_>) -> Result<Customer, String> {
        state.with_db(|db| db.save_customer(&input))
    }

    #[tauri::command]
    pub fn set_customer_active(id: i64, active: bool, state: S<'_>) -> Result<Customer, String> {
        state.with_db(|db| db.set_customer_active(id, active))
    }

    // ------------------------------------------------------------ Catálogo e inventario

    #[tauri::command]
    pub fn list_categories(kind: String, state: S<'_>) -> Result<Vec<Category>, String> {
        state.with_db(|db| db.list_categories(&kind))
    }

    #[tauri::command]
    pub fn save_category(
        id: Option<i64>,
        kind: String,
        name: String,
        state: S<'_>,
    ) -> Result<Category, String> {
        state.with_db(|db| db.save_category(id, &kind, &name))
    }

    #[tauri::command]
    pub fn delete_category(id: i64, state: S<'_>) -> Result<(), String> {
        state.with_db(|db| db.delete_category(id))
    }

    #[tauri::command]
    pub fn list_products(
        search: Option<String>,
        category_id: Option<i64>,
        include_inactive: bool,
        only_low_stock: bool,
        state: S<'_>,
    ) -> Result<Vec<Product>, String> {
        state.with_db(|db| db.list_products(search, category_id, include_inactive, only_low_stock))
    }

    #[tauri::command]
    pub fn save_product(input: ProductInput, state: S<'_>) -> Result<Product, String> {
        state.with_db(|db| db.save_product(&input))
    }

    #[tauri::command]
    pub fn set_product_active(id: i64, active: bool, state: S<'_>) -> Result<Product, String> {
        state.with_db(|db| db.set_product_active(id, active))
    }

    #[tauri::command]
    pub fn adjust_stock(input: StockAdjustmentInput, state: S<'_>) -> Result<Product, String> {
        state.with_db(|db| db.adjust_stock(&input))
    }

    #[tauri::command]
    pub fn list_inventory_movements(
        product_id: Option<i64>,
        limit: Option<i64>,
        state: S<'_>,
    ) -> Result<Vec<InventoryMovement>, String> {
        state.with_db(|db| db.list_inventory_movements(product_id, limit))
    }

    // ------------------------------------------------------------ Facturas y cotizaciones

    #[tauri::command]
    pub fn create_invoice(input: InvoiceInput, state: S<'_>) -> Result<InvoiceDetail, String> {
        state.with_db(|db| db.create_invoice(&input))
    }

    #[tauri::command]
    pub fn list_invoices(
        filter: InvoiceFilter,
        state: S<'_>,
    ) -> Result<Vec<InvoiceSummary>, String> {
        state.with_db(|db| db.list_invoices(&filter))
    }

    #[tauri::command]
    pub fn get_invoice(id: i64, state: S<'_>) -> Result<InvoiceDetail, String> {
        state.with_db(|db| db.get_invoice(id))
    }

    #[tauri::command]
    pub fn add_payment(
        invoice_id: i64,
        payment: PaymentInput,
        state: S<'_>,
    ) -> Result<InvoiceDetail, String> {
        state.with_db(|db| db.add_payment(invoice_id, &payment))
    }

    #[tauri::command]
    pub fn void_invoice(
        invoice_id: i64,
        reason: String,
        state: S<'_>,
    ) -> Result<InvoiceDetail, String> {
        state.with_db(|db| db.void_invoice(invoice_id, &reason))
    }

    #[tauri::command]
    pub fn list_payments(
        date_from: Option<String>,
        date_to: Option<String>,
        state: S<'_>,
    ) -> Result<Vec<Payment>, String> {
        state.with_db(|db| db.list_payments(date_from, date_to))
    }

    #[tauri::command]
    pub fn create_quote(input: QuoteInput, state: S<'_>) -> Result<QuoteDetail, String> {
        state.with_db(|db| db.create_quote(&input))
    }

    #[tauri::command]
    pub fn list_quotes(
        search: Option<String>,
        status: Option<String>,
        state: S<'_>,
    ) -> Result<Vec<QuoteSummary>, String> {
        state.with_db(|db| db.list_quotes(search, status))
    }

    #[tauri::command]
    pub fn get_quote(id: i64, state: S<'_>) -> Result<QuoteDetail, String> {
        state.with_db(|db| db.get_quote(id))
    }

    #[tauri::command]
    pub fn cancel_quote(id: i64, state: S<'_>) -> Result<QuoteDetail, String> {
        state.with_db(|db| db.cancel_quote(id))
    }

    #[tauri::command]
    pub fn convert_quote_to_invoice(
        quote_id: i64,
        issue_date: String,
        due_date: Option<String>,
        state: S<'_>,
    ) -> Result<InvoiceDetail, String> {
        state.with_db(|db| db.convert_quote_to_invoice(quote_id, &issue_date, due_date))
    }

    // ------------------------------------------------------------ Finanzas

    #[tauri::command]
    pub fn list_expenses(
        date_from: Option<String>,
        date_to: Option<String>,
        category_id: Option<i64>,
        search: Option<String>,
        state: S<'_>,
    ) -> Result<Vec<Expense>, String> {
        state.with_db(|db| db.list_expenses(date_from, date_to, category_id, search))
    }

    #[tauri::command]
    pub fn save_expense(input: ExpenseInput, state: S<'_>) -> Result<Expense, String> {
        state.with_db(|db| db.save_expense(&input))
    }

    #[tauri::command]
    pub fn delete_expense(id: i64, state: S<'_>) -> Result<(), String> {
        state.with_db(|db| db.delete_expense(id))
    }

    #[tauri::command]
    pub fn finance_summary(
        date_from: String,
        date_to: String,
        state: S<'_>,
    ) -> Result<FinanceSummary, String> {
        state.with_db(|db| db.finance_summary(&date_from, &date_to))
    }

    #[tauri::command]
    pub fn get_dashboard(today: String, state: S<'_>) -> Result<DashboardData, String> {
        state.with_db(|db| db.dashboard(&today))
    }

    #[tauri::command]
    pub fn global_search(query: String, state: S<'_>) -> Result<Vec<SearchHit>, String> {
        state.with_db(|db| db.global_search(&query))
    }

    #[tauri::command]
    pub fn export_csv(
        kind: String,
        date_from: Option<String>,
        date_to: Option<String>,
        destination: String,
        state: S<'_>,
    ) -> Result<String, String> {
        state.with_db(|db| db.export_csv(&kind, date_from, date_to, &destination))
    }

    // ------------------------------------------------------------ Configuración y datos

    #[tauri::command]
    pub fn get_business_settings(state: S<'_>) -> Result<BusinessSettings, String> {
        state.with_db(|db| db.get_business_settings())
    }

    #[tauri::command]
    pub fn save_business_settings(
        settings: BusinessSettings,
        state: S<'_>,
    ) -> Result<BusinessSettings, String> {
        state.with_db(|db| db.save_business_settings(&settings))
    }

    #[tauri::command]
    pub fn get_data_location(state: S<'_>) -> Result<DataLocationInfo, String> {
        state.with_db(|db| db.get_data_location_info())
    }

    #[tauri::command]
    pub fn save_auto_backup_settings(
        enabled: bool,
        keep: i64,
        state: S<'_>,
    ) -> Result<DataLocationInfo, String> {
        state.with_db(|db| {
            db.save_auto_backup_settings(enabled, keep)?;
            db.get_data_location_info()
        })
    }

    #[tauri::command]
    pub fn create_manual_backup(state: S<'_>) -> Result<String, String> {
        state.with_db(|db| db.create_manual_backup())
    }

    #[tauri::command]
    pub fn export_backup(destination: String, state: S<'_>) -> Result<String, String> {
        state.with_db(|db| db.export_backup(&destination))
    }

    #[tauri::command]
    pub fn restore_backup(source: String, state: S<'_>) -> Result<RestoreResult, String> {
        state.with_db(|db| db.restore_from_backup(&source))
    }

    #[tauri::command]
    pub fn move_data_location(new_dir: String, state: S<'_>) -> Result<DataLocationInfo, String> {
        state.with_db(|db| db.move_data_to(&new_dir))
    }

    #[tauri::command]
    pub fn use_existing_data_location(dir: String, state: S<'_>) -> Result<SystemOverview, String> {
        state.with_db(|db| {
            db.use_existing_data_dir(&dir)?;
            db.build_system_overview()
        })
    }

    pub fn run_tauri_app() {
        let app_state = AppState::initialize();

        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .manage(app_state)
            .invoke_handler(tauri::generate_handler![
                get_system_overview,
                reset_data_location,
                retry_open_database,
                complete_initial_setup,
                login_user,
                logout_user,
                change_user_password,
                record_persistence_check,
                set_theme_preference,
                save_company_profile,
                list_customers,
                save_customer,
                set_customer_active,
                list_categories,
                save_category,
                delete_category,
                list_products,
                save_product,
                set_product_active,
                adjust_stock,
                list_inventory_movements,
                create_invoice,
                list_invoices,
                get_invoice,
                add_payment,
                void_invoice,
                list_payments,
                create_quote,
                list_quotes,
                get_quote,
                cancel_quote,
                convert_quote_to_invoice,
                list_expenses,
                save_expense,
                delete_expense,
                finance_summary,
                get_dashboard,
                global_search,
                export_csv,
                get_business_settings,
                save_business_settings,
                get_data_location,
                save_auto_backup_settings,
                create_manual_backup,
                export_backup,
                restore_backup,
                move_data_location,
                use_existing_data_location
            ])
            .run(tauri::generate_context!())
            .expect("Error al ejecutar la aplicación de escritorio Tauri 2");
    }
}

#[cfg(feature = "desktop-tauri")]
pub use tauri_commands::run_tauri_app;
