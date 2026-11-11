//! Gastos, resumen financiero, panel de inicio, búsqueda global y exportación CSV.

use super::catalog::Product;
use super::sales::{InvoiceFilter, InvoiceSummary};
use super::*;
use crate::db::LocalDatabase;
use chrono::{Datelike, NaiveDate};
#[cfg(test)]
use rusqlite::OptionalExtension;
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Expense {
    pub id: i64,
    pub kind: String,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub description: String,
    pub amount: i64,
    pub expense_date: String,
    pub method: String,
    pub supplier: Option<String>,
    pub note: Option<String>,
    pub product_id: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseInput {
    pub id: Option<i64>,
    pub category_id: Option<i64>,
    pub description: String,
    pub amount: i64,
    pub expense_date: String,
    pub method: String,
    pub supplier: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AmountByLabel {
    pub label: String,
    pub amount: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyPoint {
    pub month: String,
    pub invoiced: i64,
    pub collected: i64,
    pub expenses: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TopProduct {
    pub name: String,
    pub quantity: f64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSummary {
    pub date_from: String,
    pub date_to: String,
    pub invoice_count: i64,
    pub invoiced_total: i64,
    pub collected_total: i64,
    pub receivable_total: i64,
    pub operating_expenses: i64,
    pub inventory_purchases: i64,
    pub cost_of_goods_sold: i64,
    pub gross_profit: i64,
    pub net_cash_flow: i64,
    pub expenses_by_category: Vec<AmountByLabel>,
    pub payments_by_method: Vec<AmountByLabel>,
    pub monthly: Vec<MonthlyPoint>,
    pub top_products: Vec<TopProduct>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub today: String,
    pub month: FinanceSummary,
    pub today_collected: i64,
    pub open_invoice_count: i64,
    pub overdue_count: i64,
    pub overdue_total: i64,
    pub open_quote_count: i64,
    pub product_count: i64,
    pub customer_count: i64,
    pub low_stock: Vec<Product>,
    pub recent_invoices: Vec<InvoiceSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub subtitle: String,
}

const EXPENSE_SELECT: &str = "
    SELECT e.id, e.kind, e.category_id, c.name, e.description, e.amount, e.expense_date, e.method,
           e.supplier, e.note, e.product_id, e.created_at
    FROM expenses e LEFT JOIN categories c ON c.id = e.category_id";

fn map_expense(r: &Row<'_>) -> rusqlite::Result<Expense> {
    Ok(Expense {
        id: r.get(0)?,
        kind: r.get(1)?,
        category_id: r.get(2)?,
        category_name: r.get(3)?,
        description: r.get(4)?,
        amount: r.get(5)?,
        expense_date: r.get(6)?,
        method: r.get(7)?,
        supplier: r.get(8)?,
        note: r.get(9)?,
        product_id: r.get(10)?,
        created_at: r.get(11)?,
    })
}

fn method_label(m: &str) -> &'static str {
    match m {
        "cash" => "Efectivo",
        "transfer" => "Transferencia",
        "card" => "Tarjeta",
        _ => "Otro",
    }
}

fn status_label(s: &str) -> &'static str {
    match s {
        "pending" => "Pendiente",
        "partial" => "Pago parcial",
        "paid" => "Pagada",
        "void" => "Anulada",
        _ => "",
    }
}

/// Lista de los 12 meses (AAAA-MM) que terminan en el mes de `date_to`.
fn last_12_months(date_to: &str) -> Vec<String> {
    let d = NaiveDate::parse_from_str(date_to, "%Y-%m-%d")
        .unwrap_or_else(|_| chrono::Local::now().date_naive());
    let mut y = d.year();
    let mut m = d.month() as i32;
    let mut out = Vec::with_capacity(12);
    for _ in 0..12 {
        out.push(format!("{:04}-{:02}", y, m));
        m -= 1;
        if m == 0 {
            m = 12;
            y -= 1;
        }
    }
    out.reverse();
    out
}

fn csv_escape(value: &str) -> String {
    let needs =
        value.contains(';') || value.contains('"') || value.contains('\n') || value.contains('\r');
    // Evita inyección de fórmulas al abrir el CSV en Excel.
    let v = if value.starts_with(['=', '+', '-', '@']) && value.parse::<f64>().is_err() {
        format!("'{}", value)
    } else {
        value.to_string()
    };
    if needs {
        format!("\"{}\"", v.replace('"', "\"\""))
    } else {
        v
    }
}

fn fmt_qty(q: f64) -> String {
    let s = format!("{:.3}", q);
    let s = s.trim_end_matches('0').trim_end_matches('.').to_string();
    s.replace('.', ",")
}

impl LocalDatabase {
    // ---------------------------------------------------------------- Gastos

    pub fn list_expenses(
        &self,
        date_from: Option<String>,
        date_to: Option<String>,
        category_id: Option<i64>,
        search: Option<String>,
    ) -> Result<Vec<Expense>, String> {
        self.require_authenticated_user()?;
        let from = clean_opt_date(&date_from, "Desde")?;
        let to = clean_opt_date(&date_to, "Hasta")?;
        let pattern = like_pattern(search.as_deref().unwrap_or(""));
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE (?1 IS NULL OR e.expense_date >= ?1) AND (?2 IS NULL OR e.expense_date <= ?2)
                   AND (?3 IS NULL OR e.category_id = ?3)
                   AND (e.description LIKE ?4 ESCAPE '\\' OR IFNULL(e.supplier, '') LIKE ?4 ESCAPE '\\')
                 ORDER BY e.expense_date DESC, e.id DESC LIMIT 5000",
                EXPENSE_SELECT
            ))
            .map_err(|e| friendly_sql_error("Gastos", e))?;
        let rows = stmt
            .query_map(params![from, to, category_id, pattern], map_expense)
            .map_err(|e| friendly_sql_error("Gastos", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Gastos", e))?;
        Ok(rows)
    }

    pub fn save_expense(&self, input: &ExpenseInput) -> Result<Expense, String> {
        let user = self.require_authenticated_user()?;
        let description = clean_req(&input.description, 200, "Descripción")?;
        let amount = validate_amount(input.amount, "Valor", false)?;
        let date = clean_date(&input.expense_date, "Fecha")?;
        let method = validate_method(&input.method)?;
        let supplier = clean_opt(&input.supplier, 120, "Proveedor")?;
        let note = clean_opt(&input.note, 500, "Nota")?;
        let conn = self.connect()?;
        if let Some(cat) = input.category_id {
            let ok: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1 AND kind = 'expense')",
                    params![cat],
                    |r| r.get(0),
                )
                .map_err(|e| friendly_sql_error("Gasto", e))?;
            if !ok {
                return Err("La categoría de gasto no existe.".to_string());
            }
        }
        let now = now_rfc3339();
        let id = match input.id {
            Some(id) => {
                let n = conn
                    .execute(
                        "UPDATE expenses SET category_id = ?1, description = ?2, amount = ?3, expense_date = ?4,
                            method = ?5, supplier = ?6, note = ?7, updated_at = ?8 WHERE id = ?9",
                        params![input.category_id, description, amount, date, method, supplier, note, now, id],
                    )
                    .map_err(|e| friendly_sql_error("Gasto", e))?;
                if n == 0 {
                    return Err("El gasto no existe.".to_string());
                }
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO expenses (kind, category_id, description, amount, expense_date, method,
                        supplier, note, created_by, created_at, updated_at)
                     VALUES ('operating', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                    params![input.category_id, description, amount, date, method, supplier, note, user.id, now],
                )
                .map_err(|e| friendly_sql_error("Gasto", e))?;
                conn.last_insert_rowid()
            }
        };
        conn.query_row(
            &format!("{} WHERE e.id = ?1", EXPENSE_SELECT),
            params![id],
            map_expense,
        )
        .map_err(|e| friendly_sql_error("Gasto", e))
    }

    /// Elimina un gasto registrado por error (acción explícita del usuario).
    /// Si era una compra de inventario, las existencias no cambian.
    pub fn delete_expense(&self, id: i64) -> Result<(), String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let n = conn
            .execute("DELETE FROM expenses WHERE id = ?1", params![id])
            .map_err(|e| friendly_sql_error("Gasto", e))?;
        if n == 0 {
            return Err("El gasto no existe.".to_string());
        }
        Ok(())
    }

    // ---------------------------------------------------------------- Finanzas

    pub fn finance_summary(
        &self,
        date_from: &str,
        date_to: &str,
    ) -> Result<FinanceSummary, String> {
        self.require_authenticated_user()?;
        let from = clean_date(date_from, "Desde")?;
        let to = clean_date(date_to, "Hasta")?;
        if from > to {
            return Err("La fecha inicial no puede ser posterior a la final.".to_string());
        }
        let conn = self.connect()?;
        let q = |sql: &str| -> Result<i64, String> {
            conn.query_row(sql, params![from, to], |r| r.get(0))
                .map_err(|e| friendly_sql_error("Finanzas", e))
        };
        let invoice_count = q(
            "SELECT COUNT(*) FROM invoices WHERE status <> 'void' AND issue_date BETWEEN ?1 AND ?2",
        )?;
        let invoiced_total = q("SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status <> 'void' AND issue_date BETWEEN ?1 AND ?2")?;
        let collected_total = q(
            "SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN invoices i ON i.id = p.invoice_id
             WHERE i.status <> 'void' AND p.paid_at BETWEEN ?1 AND ?2",
        )?;
        let operating_expenses = q("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE kind = 'operating' AND expense_date BETWEEN ?1 AND ?2")?;
        let inventory_purchases = q("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE kind = 'inventory' AND expense_date BETWEEN ?1 AND ?2")?;
        let cost_of_goods_sold = q(
            "SELECT COALESCE(SUM(CAST(ROUND(l.quantity * l.unit_cost) AS INTEGER)), 0)
             FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
             WHERE i.status <> 'void' AND i.issue_date BETWEEN ?1 AND ?2",
        )?;
        let receivable_total: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(total - paid_amount), 0) FROM invoices WHERE status IN ('pending', 'partial')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| friendly_sql_error("Finanzas", e))?;

        let by_label = |sql: &str, map_method: bool| -> Result<Vec<AmountByLabel>, String> {
            let mut stmt = conn
                .prepare(sql)
                .map_err(|e| friendly_sql_error("Finanzas", e))?;
            let rows = stmt
                .query_map(params![from, to], |r| {
                    let label: String = r.get(0)?;
                    Ok(AmountByLabel {
                        label: if map_method {
                            method_label(&label).to_string()
                        } else {
                            label
                        },
                        amount: r.get(1)?,
                    })
                })
                .map_err(|e| friendly_sql_error("Finanzas", e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| friendly_sql_error("Finanzas", e))?;
            Ok(rows)
        };
        let expenses_by_category = by_label(
            "SELECT IFNULL(c.name, 'Sin categoría'), SUM(e.amount) FROM expenses e
             LEFT JOIN categories c ON c.id = e.category_id
             WHERE e.expense_date BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 2 DESC",
            false,
        )?;
        let payments_by_method = by_label(
            "SELECT p.method, SUM(p.amount) FROM payments p JOIN invoices i ON i.id = p.invoice_id
             WHERE i.status <> 'void' AND p.paid_at BETWEEN ?1 AND ?2 GROUP BY 1 ORDER BY 2 DESC",
            true,
        )?;

        let mut monthly = Vec::with_capacity(12);
        for month in last_12_months(&to) {
            let pattern = format!("{}%", month);
            let one = |sql: &str| -> Result<i64, String> {
                conn.query_row(sql, params![pattern], |r| r.get(0))
                    .map_err(|e| friendly_sql_error("Finanzas", e))
            };
            monthly.push(MonthlyPoint {
                invoiced: one("SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status <> 'void' AND issue_date LIKE ?1")?,
                collected: one(
                    "SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN invoices i ON i.id = p.invoice_id
                     WHERE i.status <> 'void' AND p.paid_at LIKE ?1",
                )?,
                expenses: one("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE expense_date LIKE ?1")?,
                month,
            });
        }

        let mut stmt = conn
            .prepare(
                "SELECT l.description, SUM(l.quantity), SUM(l.line_total)
                 FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
                 WHERE i.status <> 'void' AND i.issue_date BETWEEN ?1 AND ?2
                 GROUP BY COALESCE(CAST(l.product_id AS TEXT), l.description)
                 ORDER BY 3 DESC LIMIT 8",
            )
            .map_err(|e| friendly_sql_error("Finanzas", e))?;
        let top_products = stmt
            .query_map(params![from, to], |r| {
                Ok(TopProduct {
                    name: r.get(0)?,
                    quantity: r.get(1)?,
                    total: r.get(2)?,
                })
            })
            .map_err(|e| friendly_sql_error("Finanzas", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Finanzas", e))?;

        Ok(FinanceSummary {
            date_from: from,
            date_to: to,
            invoice_count,
            invoiced_total,
            collected_total,
            receivable_total,
            operating_expenses,
            inventory_purchases,
            cost_of_goods_sold,
            gross_profit: invoiced_total - cost_of_goods_sold,
            net_cash_flow: collected_total - operating_expenses - inventory_purchases,
            expenses_by_category,
            payments_by_method,
            monthly,
            top_products,
        })
    }

    pub fn dashboard(&self, today: &str) -> Result<DashboardData, String> {
        self.require_authenticated_user()?;
        let today = clean_date(today, "Hoy")?;
        let month_start = format!("{}-01", &today[..7]);
        let month = self.finance_summary(&month_start, &today)?;
        let conn = self.connect()?;
        let one = |sql: &str| -> Result<i64, String> {
            conn.query_row(sql, params![today], |r| r.get(0))
                .map_err(|e| friendly_sql_error("Inicio", e))
        };
        let today_collected = one(
            "SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN invoices i ON i.id = p.invoice_id
             WHERE i.status <> 'void' AND p.paid_at = ?1",
        )?;
        let open_invoice_count = one(
            "SELECT COUNT(*) FROM invoices WHERE status IN ('pending', 'partial') AND ?1 = ?1",
        )?;
        let overdue_count = one(
            "SELECT COUNT(*) FROM invoices WHERE status IN ('pending', 'partial') AND due_date IS NOT NULL AND due_date < ?1",
        )?;
        let overdue_total = one("SELECT COALESCE(SUM(total - paid_amount), 0) FROM invoices
             WHERE status IN ('pending', 'partial') AND due_date IS NOT NULL AND due_date < ?1")?;
        let open_quote_count =
            one("SELECT COUNT(*) FROM quotes WHERE status = 'open' AND ?1 = ?1")?;
        let product_count = one("SELECT COUNT(*) FROM products WHERE is_active = 1 AND ?1 = ?1")?;
        let customer_count = one("SELECT COUNT(*) FROM customers WHERE is_active = 1 AND ?1 = ?1")?;
        drop(conn);
        let mut low_stock = self.list_products(None, None, false, true)?;
        low_stock.truncate(8);
        let recent_invoices = self.list_invoices(&InvoiceFilter {
            limit: Some(8),
            ..Default::default()
        })?;
        Ok(DashboardData {
            today,
            month,
            today_collected,
            open_invoice_count,
            overdue_count,
            overdue_total,
            open_quote_count,
            product_count,
            customer_count,
            low_stock,
            recent_invoices,
        })
    }

    // ---------------------------------------------------------------- Búsqueda global

    pub fn global_search(&self, query: &str) -> Result<Vec<SearchHit>, String> {
        self.require_authenticated_user()?;
        let q = query.trim();
        if q.is_empty() {
            return Ok(vec![]);
        }
        let pattern = like_pattern(q);
        let conn = self.connect()?;
        let mut hits = vec![];
        let mut run = |sql: &str, kind: &str| -> Result<(), String> {
            let mut stmt = conn
                .prepare(sql)
                .map_err(|e| friendly_sql_error("Búsqueda", e))?;
            let rows = stmt
                .query_map(params![pattern], |r| {
                    Ok(SearchHit {
                        kind: kind.to_string(),
                        id: r.get(0)?,
                        title: r.get(1)?,
                        subtitle: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    })
                })
                .map_err(|e| friendly_sql_error("Búsqueda", e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| friendly_sql_error("Búsqueda", e))?;
            hits.extend(rows);
            Ok(())
        };
        run(
            "SELECT id, number || ' · ' || customer_name, issue_date FROM invoices
             WHERE number LIKE ?1 ESCAPE '\\' OR customer_name LIKE ?1 ESCAPE '\\' ORDER BY id DESC LIMIT 6",
            "invoice",
        )?;
        run(
            "SELECT id, name, IFNULL(document_id, IFNULL(phone, '')) FROM customers
             WHERE is_active = 1 AND (name LIKE ?1 ESCAPE '\\' OR IFNULL(document_id, '') LIKE ?1 ESCAPE '\\'
                   OR IFNULL(phone, '') LIKE ?1 ESCAPE '\\') ORDER BY name LIMIT 6",
            "customer",
        )?;
        run(
            "SELECT id, name, IFNULL(sku, '') FROM products
             WHERE is_active = 1 AND (name LIKE ?1 ESCAPE '\\' OR IFNULL(sku, '') LIKE ?1 ESCAPE '\\') ORDER BY name LIMIT 6",
            "product",
        )?;
        run(
            "SELECT id, number || ' · ' || customer_name, issue_date FROM quotes
             WHERE number LIKE ?1 ESCAPE '\\' OR customer_name LIKE ?1 ESCAPE '\\' ORDER BY id DESC LIMIT 4",
            "quote",
        )?;
        Ok(hits)
    }

    // ---------------------------------------------------------------- Exportación CSV

    /// Exporta un reporte en CSV (separador `;`, UTF-8 con BOM, compatible con Excel en español).
    pub fn export_csv(
        &self,
        kind: &str,
        date_from: Option<String>,
        date_to: Option<String>,
        destination: &str,
    ) -> Result<String, String> {
        self.require_authenticated_user()?;
        let dest = PathBuf::from(destination.trim());
        if destination.trim().is_empty() {
            return Err("Selecciona dónde guardar el archivo.".to_string());
        }
        let mut rows: Vec<Vec<String>> = vec![];
        match kind {
            "invoices" => {
                rows.push(
                    [
                        "Número", "Fecha", "Vence", "Cliente", "Estado", "Total", "Pagado", "Saldo",
                    ]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                );
                let list = self.list_invoices(&InvoiceFilter {
                    date_from: date_from.clone(),
                    date_to: date_to.clone(),
                    limit: Some(5000),
                    ..Default::default()
                })?;
                for i in list {
                    rows.push(vec![
                        i.number,
                        i.issue_date,
                        i.due_date.unwrap_or_default(),
                        i.customer_name,
                        status_label(&i.status).to_string(),
                        i.total.to_string(),
                        i.paid_amount.to_string(),
                        i.balance.to_string(),
                    ]);
                }
            }
            "payments" => {
                rows.push(
                    [
                        "Fecha",
                        "Factura",
                        "Cliente",
                        "Método",
                        "Valor",
                        "Nota",
                        "Factura anulada",
                    ]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                );
                for p in self.list_payments(date_from.clone(), date_to.clone())? {
                    rows.push(vec![
                        p.paid_at,
                        p.invoice_number,
                        p.customer_name,
                        method_label(&p.method).to_string(),
                        p.amount.to_string(),
                        p.note.unwrap_or_default(),
                        if p.invoice_voided {
                            "Sí".to_string()
                        } else {
                            "No".to_string()
                        },
                    ]);
                }
            }
            "expenses" => {
                rows.push(
                    [
                        "Fecha",
                        "Tipo",
                        "Categoría",
                        "Descripción",
                        "Proveedor",
                        "Método",
                        "Valor",
                    ]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                );
                for e in self.list_expenses(date_from.clone(), date_to.clone(), None, None)? {
                    rows.push(vec![
                        e.expense_date,
                        if e.kind == "inventory" {
                            "Compra de inventario".to_string()
                        } else {
                            "Gasto operativo".to_string()
                        },
                        e.category_name.unwrap_or_default(),
                        e.description,
                        e.supplier.unwrap_or_default(),
                        method_label(&e.method).to_string(),
                        e.amount.to_string(),
                    ]);
                }
            }
            "products" => {
                rows.push(
                    [
                        "Código",
                        "Nombre",
                        "Categoría",
                        "Unidad",
                        "Precio",
                        "Costo",
                        "Existencia",
                        "Stock mínimo",
                        "Estado",
                    ]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                );
                for p in self.list_products(None, None, true, false)? {
                    rows.push(vec![
                        p.sku.unwrap_or_default(),
                        p.name,
                        p.category_name.unwrap_or_default(),
                        p.unit,
                        p.price.to_string(),
                        p.cost.to_string(),
                        if p.track_stock {
                            fmt_qty(p.stock_qty)
                        } else {
                            "—".to_string()
                        },
                        fmt_qty(p.min_stock),
                        if p.is_active {
                            "Activo".to_string()
                        } else {
                            "Archivado".to_string()
                        },
                    ]);
                }
            }
            "customers" => {
                rows.push(
                    [
                        "Nombre",
                        "Documento",
                        "Teléfono",
                        "Correo",
                        "Dirección",
                        "Facturas",
                        "Total facturado",
                        "Saldo pendiente",
                    ]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                );
                for c in self.list_customers(None, true)? {
                    rows.push(vec![
                        c.name,
                        c.document_id.unwrap_or_default(),
                        c.phone.unwrap_or_default(),
                        c.email.unwrap_or_default(),
                        c.address.unwrap_or_default(),
                        c.invoice_count.to_string(),
                        c.total_invoiced.to_string(),
                        c.balance_due.to_string(),
                    ]);
                }
            }
            _ => return Err("Tipo de reporte no válido.".to_string()),
        }
        let target = if dest.is_dir() {
            dest.join(format!(
                "CartuchoERP_{}_{}.csv",
                kind,
                chrono::Local::now().format("%Y-%m-%d_%H%M%S")
            ))
        } else {
            let mut p = dest;
            if p.extension().is_none() {
                p.set_extension("csv");
            }
            p
        };
        let mut content = String::from("\u{feff}");
        for r in rows {
            content.push_str(
                &r.iter()
                    .map(|c| csv_escape(c))
                    .collect::<Vec<_>>()
                    .join(";"),
            );
            content.push_str("\r\n");
        }
        fs::write(&target, content).map_err(|e| format!("No se pudo guardar el archivo: {}", e))?;
        Ok(target.to_string_lossy().to_string())
    }

    /// Ayuda interna para pruebas: devuelve la existencia de un producto.
    #[cfg(test)]
    pub(crate) fn stock_of(&self, product_id: i64) -> f64 {
        let conn = self.connect().unwrap();
        conn.query_row(
            "SELECT stock_qty FROM products WHERE id = ?1",
            params![product_id],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
        .unwrap_or(0.0)
    }
}
