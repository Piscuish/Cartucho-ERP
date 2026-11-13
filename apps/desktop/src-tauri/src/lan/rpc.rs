//! Funciones del programa para la app de Android conectada al PC (ADR 0010).
//!
//! La app llama `POST /api/rpc/{comando}` con los mismos nombres y argumentos que usa el
//! programa de escritorio. Cada comando se ejecuta con la sesión del usuario del celular
//! (`gated_as`): se aplican la licencia y su rol, y la sesión del PC no cambia.
//!
//! - Solo están los comandos del trabajo diario. Configuración, usuarios, respaldos, licencia
//!   y ubicación de datos se manejan únicamente en el PC.
//! - Los que crean o modifican datos requieren que el administrador lo permita en el PC
//!   (Configuración › Celulares › «Permitir registrar desde la app»).

use crate::licensing::Gate;
use crate::AppState;
use serde::de::DeserializeOwned;
use serde_json::Value;

/// Comandos de consulta disponibles desde la app.
pub const READ_COMMANDS: &[&str] = &[
    "get_system_overview",
    "get_license_status",
    "get_business_settings",
    "get_dashboard",
    "global_search",
    "get_cash_close",
    "get_customer_statement",
    "list_customers",
    "list_categories",
    "list_products",
    "list_inventory_movements",
    "list_invoices",
    "get_invoice",
    "list_payments",
    "list_quotes",
    "get_quote",
    "list_expenses",
    "finance_summary",
    "list_users",
];

/// Comandos que crean o modifican datos (requieren permiso de escritura desde la app).
pub const WRITE_COMMANDS: &[&str] = &[
    "save_customer",
    "set_customer_active",
    "save_category",
    "delete_category",
    "save_product",
    "set_product_active",
    "adjust_stock",
    "create_invoice",
    "add_payment",
    "void_invoice",
    "create_quote",
    "cancel_quote",
    "convert_quote_to_invoice",
    "save_expense",
    "delete_expense",
];

pub const ONLY_ON_PC: &str = "Esta opción solo está disponible en el programa del PC.";
pub const WRITES_DISABLED: &str =
    "El PC no permite registrar desde la app. Actívalo en el PC: Configuración › Celulares › «Permitir registrar desde la app».";

/// Lee un argumento por su nombre (camelCase, como los envía la interfaz). Si falta, se
/// interpreta como `null` (sirve para los opcionales).
fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|_| format!("Dato no válido: {}.", name))
}

fn out<T: serde::Serialize>(r: Result<T, String>) -> Result<Value, String> {
    r.map(|v| serde_json::to_value(v).unwrap_or(Value::Null))
}

fn category_gate(kind: &str, write: bool) -> Gate {
    let module = if kind == "expense" { "expenses" } else { "catalog" };
    if write {
        Gate::Write(module)
    } else {
        Gate::Read(module)
    }
}

/// Ejecuta un comando de la app con la sesión del usuario `user_id`.
pub fn dispatch(state: &AppState, user_id: i64, cmd: &str, args: &Value, writes_allowed: bool) -> Result<Value, String> {
    let is_write = WRITE_COMMANDS.contains(&cmd);
    if !is_write && !READ_COMMANDS.contains(&cmd) {
        return Err(ONLY_ON_PC.to_string());
    }
    if is_write && !writes_allowed {
        return Err(WRITES_DISABLED.to_string());
    }
    let g = |gate: Gate| gate;
    match cmd {
        // ------------------------------------------------ Sistema
        "get_system_overview" => {
            let mut o = state.gated_as(user_id, g(Gate::Core), |db| db.build_system_overview())?;
            o.license = Some(state.license_status()?);
            out(Ok(o))
        }
        "get_license_status" => out(state.license_status()),
        "get_business_settings" => out(state.gated_as(user_id, Gate::Core, |db| db.get_business_settings())),
        "get_dashboard" => {
            let today: String = arg(args, "today")?;
            let from: Option<String> = arg(args, "dateFrom")?;
            let to: Option<String> = arg(args, "dateTo")?;
            out(state.gated_as(user_id, Gate::Read("invoices"), |db| db.dashboard_range(&today, from.as_deref(), to.as_deref())))
        }
        "global_search" => {
            let query: String = arg(args, "query")?;
            out(state.gated_as(user_id, Gate::Core, |db| {
                let hits = db.global_search(&query)?;
                let access = db.current_access()?;
                let active = db.module_settings()?;
                Ok(hits
                    .into_iter()
                    .filter(|h| {
                        let module = match h.kind.as_str() {
                            "invoice" => "invoices",
                            "quote" => "quotes",
                            "customer" => "customers",
                            _ => "catalog",
                        };
                        !active.disabled.contains(module) && access.as_ref().map_or(true, |a| a.can_read(module))
                    })
                    .collect::<Vec<_>>())
            }))
        }
        "get_cash_close" => {
            let date: String = arg(args, "date")?;
            let uid: Option<i64> = arg(args, "userId")?;
            out(state.gated_as(user_id, Gate::Read("invoices"), |db| db.cash_close(&date, uid)))
        }
        "get_customer_statement" => {
            let customer_id: i64 = arg(args, "customerId")?;
            let today: String = arg(args, "today")?;
            out(state.gated_as(user_id, Gate::Read("customers"), |db| db.customer_statement(customer_id, &today)))
        }
        "list_users" => out(state.gated_as(user_id, Gate::Admin, |db| db.list_users())),

        // ------------------------------------------------ Clientes
        "list_customers" => {
            let search: Option<String> = arg(args, "search")?;
            let inactive: Option<bool> = arg(args, "includeInactive")?;
            out(state.gated_as(user_id, Gate::Read("customers"), |db| db.list_customers(search, inactive.unwrap_or(false))))
        }
        "save_customer" => {
            let input: crate::erp::customers::CustomerInput = arg(args, "input")?;
            out(state.gated_as(user_id, Gate::Write("customers"), |db| db.save_customer(&input)))
        }
        "set_customer_active" => {
            let (id, active): (i64, bool) = (arg(args, "id")?, arg(args, "active")?);
            out(state.gated_as(user_id, Gate::Write("customers"), |db| db.set_customer_active(id, active)))
        }

        // ------------------------------------------------ Catálogo e inventario
        "list_categories" => {
            let kind: String = arg(args, "kind")?;
            out(state.gated_as(user_id, category_gate(&kind, false), |db| db.list_categories(&kind)))
        }
        "save_category" => {
            let id: Option<i64> = arg(args, "id")?;
            let kind: String = arg(args, "kind")?;
            let name: String = arg(args, "name")?;
            out(state.gated_as(user_id, category_gate(&kind, true), |db| db.save_category(id, &kind, &name)))
        }
        "delete_category" => {
            let id: i64 = arg(args, "id")?;
            out(state.gated_as(user_id, Gate::CoreWrite, |db| db.delete_category(id)))
        }
        "list_products" => {
            let search: Option<String> = arg(args, "search")?;
            let category_id: Option<i64> = arg(args, "categoryId")?;
            let inactive: Option<bool> = arg(args, "includeInactive")?;
            let low: Option<bool> = arg(args, "onlyLowStock")?;
            out(state.gated_as(user_id, Gate::Read("catalog"), |db| {
                db.list_products(search, category_id, inactive.unwrap_or(false), low.unwrap_or(false))
            }))
        }
        "save_product" => {
            let input: crate::erp::catalog::ProductInput = arg(args, "input")?;
            out(state.gated_as(user_id, Gate::Write("catalog"), |db| db.save_product(&input)))
        }
        "set_product_active" => {
            let (id, active): (i64, bool) = (arg(args, "id")?, arg(args, "active")?);
            out(state.gated_as(user_id, Gate::Write("catalog"), |db| db.set_product_active(id, active)))
        }
        "adjust_stock" => {
            let input: crate::erp::catalog::StockAdjustmentInput = arg(args, "input")?;
            out(state.gated_as(user_id, Gate::Write("inventory"), |db| db.adjust_stock(&input)))
        }
        "list_inventory_movements" => {
            let product_id: Option<i64> = arg(args, "productId")?;
            let limit: Option<i64> = arg(args, "limit")?;
            out(state.gated_as(user_id, Gate::Read("inventory"), |db| db.list_inventory_movements(product_id, limit)))
        }

        // ------------------------------------------------ Facturas y cotizaciones
        "create_invoice" => {
            let input: crate::erp::sales::InvoiceInput = arg(args, "input")?;
            out(state.gated_as(user_id, Gate::Write("invoices"), |db| db.create_invoice(&input)))
        }
        "list_invoices" => {
            let filter: crate::erp::sales::InvoiceFilter = arg(args, "filter")?;
            out(state.gated_as(user_id, Gate::Read("invoices"), |db| db.list_invoices(&filter)))
        }
        "get_invoice" => {
            let id: i64 = arg(args, "id")?;
            out(state.gated_as(user_id, Gate::Read("invoices"), |db| db.get_invoice(id)))
        }
        "add_payment" => {
            let invoice_id: i64 = arg(args, "invoiceId")?;
            let payment: crate::erp::sales::PaymentInput = arg(args, "payment")?;
            out(state.gated_as(user_id, Gate::Write("invoices"), |db| db.add_payment(invoice_id, &payment)))
        }
        "void_invoice" => {
            let invoice_id: i64 = arg(args, "invoiceId")?;
            let reason: String = arg(args, "reason")?;
            out(state.gated_as(user_id, Gate::Write("invoices"), |db| db.void_invoice(invoice_id, &reason)))
        }
        "list_payments" => {
            let (from, to): (Option<String>, Option<String>) = (arg(args, "dateFrom")?, arg(args, "dateTo")?);
            out(state.gated_as(user_id, Gate::Read("invoices"), |db| db.list_payments(from, to)))
        }
        "create_quote" => {
            let input: crate::erp::sales::QuoteInput = arg(args, "input")?;
            out(state.gated_as(user_id, Gate::Write("quotes"), |db| db.create_quote(&input)))
        }
        "list_quotes" => {
            let (search, status): (Option<String>, Option<String>) = (arg(args, "search")?, arg(args, "status")?);
            out(state.gated_as(user_id, Gate::Read("quotes"), |db| db.list_quotes(search, status)))
        }
        "get_quote" => {
            let id: i64 = arg(args, "id")?;
            out(state.gated_as(user_id, Gate::Read("quotes"), |db| db.get_quote(id)))
        }
        "cancel_quote" => {
            let id: i64 = arg(args, "id")?;
            out(state.gated_as(user_id, Gate::Write("quotes"), |db| db.cancel_quote(id)))
        }
        "convert_quote_to_invoice" => {
            let quote_id: i64 = arg(args, "quoteId")?;
            let issue_date: String = arg(args, "issueDate")?;
            let due_date: Option<String> = arg(args, "dueDate")?;
            out(state.gated_as(user_id, Gate::Write("quotes"), |db| db.convert_quote_to_invoice(quote_id, &issue_date, due_date)))
        }

        // ------------------------------------------------ Finanzas
        "list_expenses" => {
            let from: Option<String> = arg(args, "dateFrom")?;
            let to: Option<String> = arg(args, "dateTo")?;
            let category_id: Option<i64> = arg(args, "categoryId")?;
            let search: Option<String> = arg(args, "search")?;
            out(state.gated_as(user_id, Gate::Read("expenses"), |db| db.list_expenses(from, to, category_id, search)))
        }
        "save_expense" => {
            let input: crate::erp::finance::ExpenseInput = arg(args, "input")?;
            out(state.gated_as(user_id, Gate::Write("expenses"), |db| db.save_expense(&input)))
        }
        "delete_expense" => {
            let id: i64 = arg(args, "id")?;
            out(state.gated_as(user_id, Gate::Write("expenses"), |db| db.delete_expense(id)))
        }
        "finance_summary" => {
            let (from, to): (String, String) = (arg(args, "dateFrom")?, arg(args, "dateTo")?);
            out(state.gated_as(user_id, Gate::Read("finance"), |db| db.finance_summary(&from, &to)))
        }
        _ => Err(ONLY_ON_PC.to_string()),
    }
}
