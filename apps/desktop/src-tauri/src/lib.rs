pub mod data_admin;
pub mod db;
pub mod users;
pub mod erp;
pub mod licensing;
pub mod lan;

use db::LocalDatabase;
use licensing::{check_gate, Entitlements, Gate, LicenseManager, LicenseStatus};
use std::sync::Mutex;

/// Estado compartido de la aplicación gestionado por Tauri.
///
/// Si la base de datos no puede abrirse al iniciar (por ejemplo, la carpeta de datos
/// configurada está en una unidad desconectada), la aplicación no se cierra: guarda el
/// error para mostrarlo en pantalla y ofrecer cómo resolverlo.
pub struct AppState {
    pub db: Mutex<Option<LocalDatabase>>,
    pub startup_error: Mutex<Option<String>>,
    pub license: Mutex<LicenseManager>,
    /// Servidor para consultar desde celulares en la red local (apagado por defecto).
    pub lan: Mutex<lan::LanController>,
}

fn features_from(ent: &Entitlements) -> erp::Features {
    erp::Features {
        customers: ent.has("customers"),
        catalog: ent.has("catalog"),
        inventory: ent.has("inventory"),
        expenses: ent.has("expenses"),
    }
}

pub fn unix_now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn license_dir() -> std::path::PathBuf {
    db::resolve_os_app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("cartucho-erp"))
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
                    license: Mutex::new(LicenseManager::from_build_config(&license_dir())),
                    lan: Mutex::new(lan::LanController::default()),
                }
            }
            Err(e) => Self {
                db: Mutex::new(None),
                startup_error: Mutex::new(Some(e)),
                license: Mutex::new(LicenseManager::from_build_config(&license_dir())),
                lan: Mutex::new(lan::LanController::default()),
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

    /// Permisos actuales según la licencia.
    pub fn entitlements(&self) -> Entitlements {
        self.license
            .lock()
            .map(|mut l| l.entitlements(unix_now()))
            .unwrap_or_else(|_| Entitlements { mode: licensing::LicenseMode::Unlicensed, modules: Default::default() })
    }

    pub fn license_status(&self) -> Result<LicenseStatus, String> {
        self.license
            .lock()
            .map(|mut l| l.status(unix_now()))
            .map_err(|_| "Error interno al leer la licencia.".to_string())
    }

    /// Ejecuta una operación solo si la licencia la permite, con los módulos opcionales
    /// configurados en la base de datos para esta llamada.
    pub fn gated<T>(
        &self,
        gate: Gate,
        f: impl FnOnce(&mut LocalDatabase) -> Result<T, String>,
    ) -> Result<T, String> {
        let ent = self.entitlements();
        check_gate(&ent, gate)?;
        self.with_db(|db| {
            // Además de la licencia, el rol del usuario de la sesión debe permitirlo.
            if let Some(access) = db.current_access()? {
                role_gate(&access, gate)?;
            }
            db.features = features_from(&ent);
            f(db)
        })
    }

    /// Como `gated`, pero con la sesión de otro usuario (un celular conectado por la red
    /// local). La sesión del PC se restaura al terminar y nunca se ve la prestada.
    pub fn gated_as<T>(
        &self,
        user_id: i64,
        gate: Gate,
        f: impl FnOnce(&mut LocalDatabase) -> Result<T, String>,
    ) -> Result<T, String> {
        let ent = self.entitlements();
        check_gate(&ent, gate)?;
        self.with_db(|db| {
            db.run_as_user(user_id, |db| {
                let access = db
                    .current_access()?
                    .ok_or_else(|| "Tu sesión terminó. Vuelve a entrar.".to_string())?;
                role_gate(&access, gate)?;
                db.features = features_from(&ent);
                f(db)
            })
        })
    }

    /// ¿El usuario de la sesión puede ver este módulo (licencia y rol)?
    pub fn can_read_module(&self, ent: &Entitlements, module: &'static str) -> bool {
        check_gate(ent, Gate::Read(module)).is_ok()
            && self
                .with_db(|db| Ok(db.current_access()?.map_or(true, |a| a.can_read(module))))
                .unwrap_or(false)
    }

    /// Módulos que un administrador puede repartir en los roles: los de la licencia.
    pub fn licensed_modules(&self) -> std::collections::BTreeSet<String> {
        let ent = self.entitlements();
        licensing::ALL_MODULES.iter().filter(|m| ent.has(m)).map(|m| m.to_string()).collect()
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

/// Qué permite el rol para cada tipo de comando.
pub fn role_gate(access: &users::UserAccess, gate: Gate) -> Result<(), String> {
    let ok = match gate {
        Gate::Core => true,
        Gate::Read(m) => access.can_read(m),
        Gate::Write(m) => access.can_write(m),
        Gate::CoreWrite | Gate::Admin | Gate::License | Gate::DataExport | Gate::DataAdmin => access.is_admin,
    };
    if ok {
        Ok(())
    } else if matches!(gate, Gate::Read(_) | Gate::Write(_)) {
        Err("Tu rol no tiene permiso para esta acción. Pídele acceso al administrador.".to_string())
    } else {
        Err("Solo un administrador puede hacer esto.".to_string())
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

    fn category_gate(kind: &str, write: bool) -> Gate {
        let module = if kind == "expense" { "expenses" } else { "catalog" };
        if write { Gate::Write(module) } else { Gate::Read(module) }
    }

    fn csv_gate(kind: &str) -> Gate {
        match kind {
            "expenses" => Gate::Read("expenses"),
            "products" => Gate::Read("catalog"),
            "customers" => Gate::Read("customers"),
            _ => Gate::Read("invoices"),
        }
    }

    /// Resumen del sistema con el estado de la licencia incluido.
    fn overview(
        state: &AppState,
        f: impl FnOnce(&mut LocalDatabase) -> Result<SystemOverview, String>,
    ) -> Result<SystemOverview, String> {
        overview_gated(state, Gate::Core, f)
    }

    fn overview_gated(
        state: &AppState,
        gate: Gate,
        f: impl FnOnce(&mut LocalDatabase) -> Result<SystemOverview, String>,
    ) -> Result<SystemOverview, String> {
        let mut o = state.gated(gate, f)?;
        o.license = Some(state.license_status()?);
        Ok(o)
    }

    // ------------------------------------------------------------ Licencia

    #[tauri::command]
    pub fn get_license_status(state: S<'_>) -> Result<LicenseStatus, String> {
        state.license_status()
    }

    #[tauri::command]
    pub fn activate_license_online(license_key: String, state: S<'_>) -> Result<LicenseStatus, String> {
        let mut lic = state.license.lock().map_err(|_| "Error interno de licencia.".to_string())?;
        lic.activate_online(&license_key, &licensing::device_name(), env!("CARGO_PKG_VERSION"), unix_now())
    }

    #[tauri::command]
    pub fn activate_license_offline(activation_code: String, state: S<'_>) -> Result<LicenseStatus, String> {
        let mut lic = state.license.lock().map_err(|_| "Error interno de licencia.".to_string())?;
        lic.activate_offline(&activation_code, unix_now())
    }

    #[tauri::command]
    pub fn check_license_now(state: S<'_>) -> Result<LicenseStatus, String> {
        let mut lic = state.license.lock().map_err(|_| "Error interno de licencia.".to_string())?;
        lic.check_in(&licensing::device_name(), env!("CARGO_PKG_VERSION"), unix_now())
    }

    // ------------------------------------------------------------ Sistema y sesión

    #[tauri::command]
    pub fn get_system_overview(state: S<'_>) -> Result<SystemOverview, String> {
        overview(&state, |db| db.build_system_overview())
    }

    #[tauri::command]
    pub fn reset_data_location(state: S<'_>) -> Result<SystemOverview, String> {
        state.reset_to_default_location()?;
        overview_gated(&state, Gate::Core, |db| db.build_system_overview())
    }

    #[tauri::command]
    pub fn retry_open_database(state: S<'_>) -> Result<SystemOverview, String> {
        state.retry_open()?;
        overview_gated(&state, Gate::Core, |db| db.build_system_overview())
    }

    #[tauri::command]
    pub fn complete_initial_setup(
        input: CompleteInitialSetupInput,
        state: S<'_>,
    ) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::CoreWrite, |db| {
            db.complete_initial_setup(&input)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn login_user(input: LoginInput, state: S<'_>) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::Core, |db| {
            db.login(&input.username, &input.password)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn logout_user(state: S<'_>) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::Core, |db| {
            db.logout();
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn change_user_password(
        input: ChangePasswordInput,
        state: S<'_>,
    ) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::Core, |db| {
            db.change_authenticated_user_password(&input)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn record_persistence_check(note: String, state: S<'_>) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::CoreWrite, |db| {
            db.record_persistence_check(&note)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn set_theme_preference(theme: String, state: S<'_>) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::Admin, |db| {
            db.set_theme_preference(&theme)?;
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn set_appearance(
        appearance: crate::db::Appearance,
        theme: Option<String>,
        state: S<'_>,
    ) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::Admin, |db| {
            db.set_appearance(&appearance)?;
            if let Some(t) = theme.as_deref() {
                db.set_theme_preference(t)?;
            }
            db.build_system_overview()
        })
    }

    #[tauri::command]
    pub fn save_company_profile(
        input: SaveCompanyProfileInput,
        state: S<'_>,
    ) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::CoreWrite, |db| {
            db.save_company_profile(&input)?;
            db.build_system_overview()
        })
    }

    // ------------------------------------------------------------ Caja, estado de cuenta, bloqueo

    #[tauri::command]
    pub fn get_cash_close(date: String, user_id: Option<i64>, state: S<'_>) -> Result<crate::erp::cash::CashClose, String> {
        state.gated(Gate::Read("invoices"), |db| db.cash_close(&date, user_id))
    }

    #[tauri::command]
    pub fn get_customer_statement(
        customer_id: i64,
        today: String,
        state: S<'_>,
    ) -> Result<crate::erp::cash::CustomerStatement, String> {
        state.gated(Gate::Read("customers"), |db| db.customer_statement(customer_id, &today))
    }

    #[tauri::command]
    pub fn set_auto_lock(minutes: i64, state: S<'_>) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::Admin, |db| {
            db.set_auto_lock(minutes)?;
            db.build_system_overview()
        })
    }

    // ------------------------------------------------------------ Usuarios y roles (solo administrador)

    #[tauri::command]
    pub fn list_roles(state: S<'_>) -> Result<Vec<users::Role>, String> {
        state.gated(Gate::Admin, |db| db.list_roles())
    }

    #[tauri::command]
    pub fn save_role(input: users::RoleInput, state: S<'_>) -> Result<users::Role, String> {
        let allowed = state.licensed_modules();
        state.gated(Gate::Admin, |db| db.save_role(&input, &allowed))
    }

    #[tauri::command]
    pub fn delete_role(id: i64, state: S<'_>) -> Result<(), String> {
        state.gated(Gate::Admin, |db| db.delete_role(id))
    }

    #[tauri::command]
    pub fn list_users(state: S<'_>) -> Result<Vec<users::UserAccount>, String> {
        state.gated(Gate::Admin, |db| db.list_users())
    }

    #[tauri::command]
    pub fn save_user(input: users::UserInput, state: S<'_>) -> Result<users::UserAccount, String> {
        state.gated(Gate::Admin, |db| db.save_user(&input))
    }

    // ------------------------------------------------------------ Acceso desde celulares

    fn lan_provider(app: &tauri::AppHandle) -> lan::StateProvider {
        use tauri::Manager;
        let handle = app.clone();
        std::sync::Arc::new(move |cb: &mut dyn FnMut(&AppState)| {
            let st = handle.state::<AppState>();
            cb(&st)
        })
    }

    /// Arranca o detiene el servidor según la configuración guardada (sin tener la base
    /// bloqueada mientras se detienen los hilos del servidor).
    pub(crate) fn apply_lan_config(app: &tauri::AppHandle, state: &AppState, cfg: lan::LanConfig) -> Result<(), String> {
        let mut ctl = state.lan.lock().map_err(|_| "Error interno del acceso desde celulares.".to_string())?;
        if !cfg.enabled {
            ctl.stop();
            return Ok(());
        }
        if ctl.port() == Some(cfg.port) {
            return Ok(());
        }
        ctl.start(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED), cfg.port, lan_provider(app)).map(|_| ())
    }

    fn lan_status(state: &AppState) -> Result<lan::LanStatus, String> {
        let cfg = state.gated(Gate::Admin, |db| lan::read_config(db))?;
        let ctl = state.lan.lock().map_err(|_| "Error interno del acceso desde celulares.".to_string())?;
        Ok(ctl.status(cfg))
    }

    #[tauri::command]
    pub fn get_lan_status(state: S<'_>) -> Result<lan::LanStatus, String> {
        lan_status(&state)
    }

    #[tauri::command]
    pub fn set_lan_access(enabled: bool, port: u16, app: tauri::AppHandle, state: S<'_>) -> Result<lan::LanStatus, String> {
        let cfg = lan::LanConfig { enabled, port };
        state.gated(Gate::Admin, |db| lan::save_config(db, cfg))?;
        // El error de arranque (puerto ocupado) queda en el estado para mostrarlo.
        let _ = apply_lan_config(&app, &state, cfg);
        lan_status(&state)
    }

    #[tauri::command]
    pub fn disconnect_lan_devices(state: S<'_>) -> Result<lan::LanStatus, String> {
        state.gated(Gate::Admin, |_| Ok(()))?;
        if let Ok(ctl) = state.lan.lock() {
            ctl.sessions.clear();
        }
        lan_status(&state)
    }

    // ------------------------------------------------------------ Clientes

    #[tauri::command]
    pub fn list_customers(
        search: Option<String>,
        include_inactive: bool,
        state: S<'_>,
    ) -> Result<Vec<Customer>, String> {
        state.gated(Gate::Read("customers"), |db| db.list_customers(search, include_inactive))
    }

    #[tauri::command]
    pub fn save_customer(input: CustomerInput, state: S<'_>) -> Result<Customer, String> {
        state.gated(Gate::Write("customers"), |db| db.save_customer(&input))
    }

    #[tauri::command]
    pub fn set_customer_active(id: i64, active: bool, state: S<'_>) -> Result<Customer, String> {
        state.gated(Gate::Write("customers"), |db| db.set_customer_active(id, active))
    }

    // ------------------------------------------------------------ Catálogo e inventario

    #[tauri::command]
    pub fn list_categories(kind: String, state: S<'_>) -> Result<Vec<Category>, String> {
        state.gated(category_gate(&kind, false), |db| db.list_categories(&kind))
    }

    #[tauri::command]
    pub fn save_category(
        id: Option<i64>,
        kind: String,
        name: String,
        state: S<'_>,
    ) -> Result<Category, String> {
        state.gated(category_gate(&kind, true), |db| db.save_category(id, &kind, &name))
    }

    #[tauri::command]
    pub fn delete_category(id: i64, state: S<'_>) -> Result<(), String> {
        state.gated(Gate::CoreWrite, |db| db.delete_category(id))
    }

    #[tauri::command]
    pub fn list_products(
        search: Option<String>,
        category_id: Option<i64>,
        include_inactive: bool,
        only_low_stock: bool,
        state: S<'_>,
    ) -> Result<Vec<Product>, String> {
        state.gated(Gate::Read("catalog"), |db| db.list_products(search, category_id, include_inactive, only_low_stock))
    }

    #[tauri::command]
    pub fn save_product(input: ProductInput, state: S<'_>) -> Result<Product, String> {
        state.gated(Gate::Write("catalog"), |db| db.save_product(&input))
    }

    #[tauri::command]
    pub fn set_product_active(id: i64, active: bool, state: S<'_>) -> Result<Product, String> {
        state.gated(Gate::Write("catalog"), |db| db.set_product_active(id, active))
    }

    #[tauri::command]
    pub fn adjust_stock(input: StockAdjustmentInput, state: S<'_>) -> Result<Product, String> {
        state.gated(Gate::Write("inventory"), |db| db.adjust_stock(&input))
    }

    #[tauri::command]
    pub fn list_inventory_movements(
        product_id: Option<i64>,
        limit: Option<i64>,
        state: S<'_>,
    ) -> Result<Vec<InventoryMovement>, String> {
        state.gated(Gate::Read("inventory"), |db| db.list_inventory_movements(product_id, limit))
    }

    // ------------------------------------------------------------ Facturas y cotizaciones

    #[tauri::command]
    pub fn create_invoice(input: InvoiceInput, state: S<'_>) -> Result<InvoiceDetail, String> {
        state.gated(Gate::Write("invoices"), |db| db.create_invoice(&input))
    }

    #[tauri::command]
    pub fn list_invoices(
        filter: InvoiceFilter,
        state: S<'_>,
    ) -> Result<Vec<InvoiceSummary>, String> {
        state.gated(Gate::Read("invoices"), |db| db.list_invoices(&filter))
    }

    #[tauri::command]
    pub fn get_invoice(id: i64, state: S<'_>) -> Result<InvoiceDetail, String> {
        state.gated(Gate::Read("invoices"), |db| db.get_invoice(id))
    }

    #[tauri::command]
    pub fn add_payment(
        invoice_id: i64,
        payment: PaymentInput,
        state: S<'_>,
    ) -> Result<InvoiceDetail, String> {
        state.gated(Gate::Write("invoices"), |db| db.add_payment(invoice_id, &payment))
    }

    #[tauri::command]
    pub fn void_invoice(
        invoice_id: i64,
        reason: String,
        state: S<'_>,
    ) -> Result<InvoiceDetail, String> {
        state.gated(Gate::Write("invoices"), |db| db.void_invoice(invoice_id, &reason))
    }

    #[tauri::command]
    pub fn list_payments(
        date_from: Option<String>,
        date_to: Option<String>,
        state: S<'_>,
    ) -> Result<Vec<Payment>, String> {
        state.gated(Gate::Read("invoices"), |db| db.list_payments(date_from, date_to))
    }

    #[tauri::command]
    pub fn create_quote(input: QuoteInput, state: S<'_>) -> Result<QuoteDetail, String> {
        state.gated(Gate::Write("quotes"), |db| db.create_quote(&input))
    }

    #[tauri::command]
    pub fn list_quotes(
        search: Option<String>,
        status: Option<String>,
        state: S<'_>,
    ) -> Result<Vec<QuoteSummary>, String> {
        state.gated(Gate::Read("quotes"), |db| db.list_quotes(search, status))
    }

    #[tauri::command]
    pub fn get_quote(id: i64, state: S<'_>) -> Result<QuoteDetail, String> {
        state.gated(Gate::Read("quotes"), |db| db.get_quote(id))
    }

    #[tauri::command]
    pub fn cancel_quote(id: i64, state: S<'_>) -> Result<QuoteDetail, String> {
        state.gated(Gate::Write("quotes"), |db| db.cancel_quote(id))
    }

    #[tauri::command]
    pub fn convert_quote_to_invoice(
        quote_id: i64,
        issue_date: String,
        due_date: Option<String>,
        state: S<'_>,
    ) -> Result<InvoiceDetail, String> {
        state.gated(Gate::Write("quotes"), |db| db.convert_quote_to_invoice(quote_id, &issue_date, due_date))
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
        state.gated(Gate::Read("expenses"), |db| db.list_expenses(date_from, date_to, category_id, search))
    }

    #[tauri::command]
    pub fn save_expense(input: ExpenseInput, state: S<'_>) -> Result<Expense, String> {
        state.gated(Gate::Write("expenses"), |db| db.save_expense(&input))
    }

    #[tauri::command]
    pub fn delete_expense(id: i64, state: S<'_>) -> Result<(), String> {
        state.gated(Gate::Write("expenses"), |db| db.delete_expense(id))
    }

    #[tauri::command]
    pub fn finance_summary(
        date_from: String,
        date_to: String,
        state: S<'_>,
    ) -> Result<FinanceSummary, String> {
        state.gated(Gate::Read("finance"), |db| db.finance_summary(&date_from, &date_to))
    }

    #[tauri::command]
    pub fn get_dashboard(today: String, state: S<'_>) -> Result<DashboardData, String> {
        state.gated(Gate::Read("invoices"), |db| db.dashboard(&today))
    }

    #[tauri::command]
    pub fn global_search(query: String, state: S<'_>) -> Result<Vec<SearchHit>, String> {
        let ent = state.entitlements();
        let hits = state.gated(Gate::Core, |db| db.global_search(&query))?;
        Ok(hits
            .into_iter()
            .filter(|h| {
                let module = match h.kind.as_str() {
                    "invoice" => "invoices",
                    "quote" => "quotes",
                    "customer" => "customers",
                    _ => "catalog",
                };
                state.can_read_module(&ent, module)
            })
            .collect())
    }

    #[tauri::command]
    pub fn export_csv(
        kind: String,
        date_from: Option<String>,
        date_to: Option<String>,
        destination: String,
        state: S<'_>,
    ) -> Result<String, String> {
        state.gated(csv_gate(&kind), |db| db.export_csv(&kind, date_from, date_to, &destination))
    }

    // ------------------------------------------------------------ Configuración y datos

    #[tauri::command]
    pub fn get_business_settings(state: S<'_>) -> Result<BusinessSettings, String> {
        state.gated(Gate::Core, |db| db.get_business_settings())
    }

    #[tauri::command]
    pub fn save_business_settings(
        settings: BusinessSettings,
        state: S<'_>,
    ) -> Result<BusinessSettings, String> {
        state.gated(Gate::CoreWrite, |db| db.save_business_settings(&settings))
    }

    #[tauri::command]
    pub fn get_data_location(state: S<'_>) -> Result<DataLocationInfo, String> {
        state.gated(Gate::Core, |db| db.get_data_location_info())
    }

    #[tauri::command]
    pub fn save_auto_backup_settings(
        enabled: bool,
        keep: i64,
        state: S<'_>,
    ) -> Result<DataLocationInfo, String> {
        state.gated(Gate::DataAdmin, |db| {
            db.save_auto_backup_settings(enabled, keep)?;
            db.get_data_location_info()
        })
    }

    #[tauri::command]
    pub fn create_manual_backup(state: S<'_>) -> Result<String, String> {
        state.gated(Gate::DataExport, |db| db.create_manual_backup())
    }

    #[tauri::command]
    pub fn export_backup(destination: String, state: S<'_>) -> Result<String, String> {
        state.gated(Gate::DataExport, |db| db.export_backup(&destination))
    }

    #[tauri::command]
    pub fn restore_backup(source: String, state: S<'_>) -> Result<RestoreResult, String> {
        state.gated(Gate::DataAdmin, |db| db.restore_from_backup(&source))
    }

    #[tauri::command]
    pub fn move_data_location(new_dir: String, state: S<'_>) -> Result<DataLocationInfo, String> {
        state.gated(Gate::DataAdmin, |db| db.move_data_to(&new_dir))
    }

    #[tauri::command]
    pub fn use_existing_data_location(dir: String, state: S<'_>) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::DataAdmin, |db| {
            db.use_existing_data_dir(&dir)?;
            db.build_system_overview()
        })
    }

    /// Primera ejecución: elegir dónde guardar los datos (solo si aún no hay administrador).
    #[tauri::command]
    pub fn setup_data_location(mode: String, dir: Option<String>, state: S<'_>) -> Result<SystemOverview, String> {
        overview_gated(&state, Gate::CoreWrite, |db| {
            db.setup_data_location(&mode, dir.as_deref())?;
            db.build_system_overview()
        })
    }

    pub fn run_tauri_app() {
        let app_state = AppState::initialize();

        tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .manage(app_state)
            .setup(|app| {
                // Reporte con el servidor de licencias: al iniciar y cada hora mientras la
                // aplicación esté abierta. Sin conexión no pasa nada: el token sigue siendo
                // válido hasta 30 días.
                use tauri::{Emitter, Manager};
                // Acceso desde celulares: si el administrador lo dejó activo, se vuelve a abrir.
                {
                    let state = app.state::<AppState>();
                    if let Ok(cfg) = state.with_db(|db| lan::read_config(db)) {
                        if cfg.enabled {
                            let _ = apply_lan_config(app.handle(), &state, cfg);
                        }
                    }
                }
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    loop {
                        let state = handle.state::<AppState>();
                        let should = state.license.lock().map(|l| l.has_license_key()).unwrap_or(false);
                        if should {
                            let before = state.license_status().ok().map(|s| (s.mode, s.modules.clone()));
                            if let Ok(mut lic) = state.license.lock() {
                                let _ = lic.check_in(&licensing::device_name(), env!("CARGO_PKG_VERSION"), unix_now());
                            }
                            let after = state.license_status().ok().map(|s| (s.mode, s.modules.clone()));
                            if before != after {
                                let _ = handle.emit("license-changed", ());
                            }
                        }
                        std::thread::sleep(std::time::Duration::from_secs(60 * 60));
                    }
                });
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                get_system_overview,
                get_lan_status,
                set_lan_access,
                disconnect_lan_devices,
                get_license_status,
                activate_license_online,
                activate_license_offline,
                check_license_now,
                reset_data_location,
                retry_open_database,
                complete_initial_setup,
                setup_data_location,
                login_user,
                logout_user,
                change_user_password,
                record_persistence_check,
                set_theme_preference,
                set_appearance,
                list_roles,
                get_cash_close,
                get_customer_statement,
                set_auto_lock,
                save_role,
                delete_role,
                list_users,
                save_user,
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

#[cfg(test)]
mod role_gate_tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn role_gate_matches_permissions() {
        let admin = users::UserAccess { is_admin: true, modules: BTreeMap::new() };
        for g in [Gate::Core, Gate::CoreWrite, Gate::Admin, Gate::DataAdmin, Gate::Write("finance")] {
            assert!(role_gate(&admin, g).is_ok());
        }
        let seller = users::UserAccess::from_role("vendedor", Some(r#"{"invoices":"write","catalog":"read"}"#));
        assert!(role_gate(&seller, Gate::Core).is_ok());
        assert!(role_gate(&seller, Gate::Write("invoices")).is_ok());
        assert!(role_gate(&seller, Gate::Read("catalog")).is_ok());
        assert!(role_gate(&seller, Gate::Write("catalog")).is_err());
        assert!(role_gate(&seller, Gate::Read("finance")).is_err());
        for g in [Gate::CoreWrite, Gate::Admin, Gate::DataExport, Gate::DataAdmin, Gate::License] {
            assert!(role_gate(&seller, g).unwrap_err().contains("administrador"));
        }
    }
}
