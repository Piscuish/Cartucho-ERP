//! Cierre de caja diario y estado de cuenta por cliente (solo lectura).

use super::customers::Customer;
use super::sales::{map_invoice_summary, map_payment, InvoiceSummary, Payment, INVOICE_SUMMARY_SELECT, PAYMENT_SELECT};
use super::{clean_date, friendly_sql_error};
use crate::db::LocalDatabase;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MethodTotal {
    pub method: String,
    pub count: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserTotal {
    pub user_id: Option<i64>,
    pub user_name: String,
    pub payments: i64,
    pub collected: i64,
    pub invoices: i64,
    pub invoiced: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CashClose {
    pub date: String,
    /// Usuario filtrado (None = todos).
    pub user_id: Option<i64>,
    pub user_name: Option<String>,
    pub by_method: Vec<MethodTotal>,
    pub collected_total: i64,
    pub cash_collected: i64,
    pub invoices_count: i64,
    pub invoices_total: i64,
    pub voided_count: i64,
    pub voided_total: i64,
    /// Gastos pagados en efectivo ese día (solo cuando el cierre es de todos los usuarios).
    pub cash_expenses: i64,
    /// Efectivo que debería haber: cobrado en efectivo − gastos en efectivo.
    pub expected_cash: i64,
    pub by_user: Vec<UserTotal>,
    pub payments: Vec<Payment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomerStatement {
    pub customer: Customer,
    pub invoices: Vec<InvoiceSummary>,
    pub payments: Vec<Payment>,
    pub total_invoiced: i64,
    pub total_paid: i64,
    pub balance: i64,
    pub overdue_balance: i64,
}

impl LocalDatabase {
    /// Cierre de caja de un día. Un usuario que no es administrador solo ve su propio cierre.
    pub fn cash_close(&self, date: &str, user_id: Option<i64>) -> Result<CashClose, String> {
        let me = self.require_authenticated_user()?;
        let date = clean_date(date, "Fecha del cierre")?;
        let user_id = if me.is_admin { user_id } else { Some(me.id) };
        let conn = self.connect()?;
        let err = |e| friendly_sql_error("Cierre de caja", e);

        let user_name: Option<String> = match user_id {
            Some(id) => conn.query_row("SELECT full_name FROM app_users WHERE id = ?1", params![id], |r| r.get(0)).ok(),
            None => None,
        };

        // Pagos del día de facturas no anuladas.
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE p.paid_at = ?1 AND i.status <> 'void' AND (?2 IS NULL OR p.created_by = ?2)
                 ORDER BY p.id DESC",
                PAYMENT_SELECT
            ))
            .map_err(err)?;
        let payments = stmt
            .query_map(params![date, user_id], map_payment)
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;

        let mut by_method: Vec<MethodTotal> = ["cash", "transfer", "card", "other"]
            .iter()
            .map(|m| MethodTotal { method: m.to_string(), count: 0, total: 0 })
            .collect();
        for p in &payments {
            if let Some(m) = by_method.iter_mut().find(|m| m.method == p.method) {
                m.count += 1;
                m.total += p.amount;
            }
        }
        let collected_total: i64 = payments.iter().map(|p| p.amount).sum();
        let cash_collected = by_method[0].total;

        let (invoices_count, invoices_total): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(total), 0) FROM invoices
                 WHERE issue_date = ?1 AND status <> 'void' AND (?2 IS NULL OR created_by = ?2)",
                params![date, user_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        let (voided_count, voided_total): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(total), 0) FROM invoices
                 WHERE status = 'void' AND substr(voided_at, 1, 10) = ?1 AND (?2 IS NULL OR created_by = ?2)",
                params![date, user_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        let cash_expenses: i64 = if user_id.is_none() {
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE expense_date = ?1 AND method = 'cash'",
                params![date],
                |r| r.get(0),
            )
            .map_err(err)?
        } else {
            0
        };

        // Resumen por usuario (cobros y facturas del día).
        let mut stmt = conn
            .prepare(
                "SELECT uid, COALESCE((SELECT full_name FROM app_users WHERE id = uid), 'Sin usuario'),
                        SUM(np), SUM(cp), SUM(ni), SUM(ti)
                 FROM (
                    SELECT p.created_by AS uid, 1 AS np, p.amount AS cp, 0 AS ni, 0 AS ti
                      FROM payments p JOIN invoices i ON i.id = p.invoice_id
                     WHERE p.paid_at = ?1 AND i.status <> 'void'
                    UNION ALL
                    SELECT created_by, 0, 0, 1, total FROM invoices WHERE issue_date = ?1 AND status <> 'void'
                 )
                 WHERE (?2 IS NULL OR uid = ?2)
                 GROUP BY uid ORDER BY SUM(cp) DESC",
            )
            .map_err(err)?;
        let by_user = stmt
            .query_map(params![date, user_id], |r| {
                Ok(UserTotal {
                    user_id: r.get(0)?,
                    user_name: r.get(1)?,
                    payments: r.get(2)?,
                    collected: r.get(3)?,
                    invoices: r.get(4)?,
                    invoiced: r.get(5)?,
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;

        Ok(CashClose {
            date,
            user_id,
            user_name,
            by_method,
            collected_total,
            cash_collected,
            invoices_count,
            invoices_total,
            voided_count,
            voided_total,
            cash_expenses,
            expected_cash: cash_collected - cash_expenses,
            by_user,
            payments,
        })
    }

    /// Estado de cuenta: facturas (no anuladas), pagos y saldo de un cliente.
    pub fn customer_statement(&self, customer_id: i64, today: &str) -> Result<CustomerStatement, String> {
        self.require_authenticated_user()?;
        let today = clean_date(today, "Fecha")?;
        let customer = self.get_customer(customer_id)?;
        let conn = self.connect()?;
        let err = |e| friendly_sql_error("Estado de cuenta", e);
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE i.customer_id = ?1 AND i.status <> 'void' ORDER BY i.issue_date ASC, i.id ASC",
                INVOICE_SUMMARY_SELECT
            ))
            .map_err(err)?;
        let invoices = stmt
            .query_map(params![customer_id], map_invoice_summary)
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE i.customer_id = ?1 AND i.status <> 'void' ORDER BY p.paid_at ASC, p.id ASC",
                PAYMENT_SELECT
            ))
            .map_err(err)?;
        let payments = stmt
            .query_map(params![customer_id], map_payment)
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        let total_invoiced = invoices.iter().map(|i| i.total).sum();
        let total_paid = invoices.iter().map(|i| i.paid_amount).sum();
        let balance = invoices.iter().map(|i| i.balance).sum();
        let overdue_balance = invoices
            .iter()
            .filter(|i| i.balance > 0 && i.due_date.as_deref().map_or(false, |d| d < today.as_str()))
            .map(|i| i.balance)
            .sum();
        Ok(CustomerStatement { customer, invoices, payments, total_invoiced, total_paid, balance, overdue_balance })
    }
}
