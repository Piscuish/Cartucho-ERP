//! Facturas internas, abonos (pagos parciales), anulaciones y cotizaciones.
//!
//! Las facturas de Cartucho ERP son documentos administrativos internos: no son
//! facturación electrónica ni tienen validez fiscal ante la DIAN.

use super::catalog::apply_stock_change;
use super::*;
use crate::db::LocalDatabase;
use rusqlite::{params, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

const MAX_LINES: usize = 300;
const DEFAULT_CUSTOMER_NAME: &str = "Consumidor final";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLineInput {
    pub product_id: Option<i64>,
    pub description: String,
    pub quantity: f64,
    pub unit_price: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomerSnapshotInput {
    pub name: String,
    pub document_id: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub amount: i64,
    pub method: String,
    pub paid_at: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceInput {
    pub customer_id: Option<i64>,
    pub customer: Option<CustomerSnapshotInput>,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub lines: Vec<DocumentLineInput>,
    pub notes: Option<String>,
    pub terms: Option<String>,
    pub footer: Option<String>,
    pub initial_payment: Option<PaymentInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QuoteInput {
    pub customer_id: Option<i64>,
    pub customer: Option<CustomerSnapshotInput>,
    pub issue_date: String,
    pub valid_until: Option<String>,
    pub lines: Vec<DocumentLineInput>,
    pub notes: Option<String>,
    pub terms: Option<String>,
    pub footer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceFilter {
    pub search: Option<String>,
    pub status: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub customer_id: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceSummary {
    pub id: i64,
    pub number: String,
    pub customer_id: Option<i64>,
    pub customer_name: String,
    pub issue_date: String,
    pub due_date: Option<String>,
    pub status: String,
    pub total: i64,
    pub paid_amount: i64,
    pub balance: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLine {
    pub id: i64,
    pub position: i64,
    pub product_id: Option<i64>,
    pub description: String,
    pub quantity: f64,
    pub unit_price: i64,
    pub line_total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Payment {
    pub id: i64,
    pub invoice_id: i64,
    pub invoice_number: String,
    pub customer_name: String,
    pub amount: i64,
    pub method: String,
    pub paid_at: String,
    pub note: Option<String>,
    pub invoice_voided: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomerSnapshot {
    pub name: String,
    pub document_id: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceDetail {
    #[serde(flatten)]
    pub summary: InvoiceSummary,
    pub customer: CustomerSnapshot,
    pub notes: Option<String>,
    pub terms: Option<String>,
    pub footer: Option<String>,
    pub quote_id: Option<i64>,
    pub quote_number: Option<String>,
    pub void_reason: Option<String>,
    pub voided_at: Option<String>,
    pub lines: Vec<DocumentLine>,
    pub payments: Vec<Payment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuoteSummary {
    pub id: i64,
    pub number: String,
    pub customer_id: Option<i64>,
    pub customer_name: String,
    pub issue_date: String,
    pub valid_until: Option<String>,
    pub status: String,
    pub total: i64,
    pub converted_invoice_id: Option<i64>,
    pub converted_invoice_number: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuoteDetail {
    #[serde(flatten)]
    pub summary: QuoteSummary,
    pub customer: CustomerSnapshot,
    pub notes: Option<String>,
    pub terms: Option<String>,
    pub footer: Option<String>,
    pub lines: Vec<DocumentLine>,
}

struct ValidatedLine {
    product_id: Option<i64>,
    description: String,
    quantity: f64,
    unit_price: i64,
    unit_cost: i64,
    track_stock: bool,
    line_total: i64,
}

struct ValidatedDocument {
    customer_id: Option<i64>,
    customer: CustomerSnapshot,
    issue_date: String,
    second_date: Option<String>,
    lines: Vec<ValidatedLine>,
    total: i64,
    notes: Option<String>,
    terms: Option<String>,
    footer: Option<String>,
}

#[allow(clippy::too_many_arguments)]
fn validate_document(
    tx: &Transaction<'_>,
    customer_id: Option<i64>,
    customer: &Option<CustomerSnapshotInput>,
    issue_date: &str,
    second_date: &Option<String>,
    second_label: &str,
    lines: &[DocumentLineInput],
    notes: &Option<String>,
    terms: &Option<String>,
    footer: &Option<String>,
) -> Result<ValidatedDocument, String> {
    let issue_date = clean_date(issue_date, "Fecha de emisión")?;
    let second_date = clean_opt_date(second_date, second_label)?;
    if let Some(ref d) = second_date {
        if d < &issue_date {
            return Err(format!("La {} no puede ser anterior a la fecha de emisión.", second_label.to_lowercase()));
        }
    }
    if lines.is_empty() {
        return Err("Agrega al menos un producto o servicio.".to_string());
    }
    if lines.len() > MAX_LINES {
        return Err(format!("Un documento admite como máximo {} líneas.", MAX_LINES));
    }

    let snapshot = match customer_id {
        Some(id) => tx
            .query_row(
                "SELECT name, document_id, phone, email, address FROM customers WHERE id = ?1",
                params![id],
                |r| {
                    Ok(CustomerSnapshot {
                        name: r.get(0)?,
                        document_id: r.get(1)?,
                        phone: r.get(2)?,
                        email: r.get(3)?,
                        address: r.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| friendly_sql_error("Cliente", e))?
            .ok_or_else(|| "El cliente seleccionado no existe.".to_string())?,
        None => {
            let c = customer.clone().unwrap_or_default();
            let name = c.name.trim();
            CustomerSnapshot {
                name: if name.is_empty() {
                    DEFAULT_CUSTOMER_NAME.to_string()
                } else {
                    clean_req(name, 160, "Nombre del cliente")?
                },
                document_id: clean_opt(&c.document_id, 40, "Documento del cliente")?,
                phone: clean_opt(&c.phone, 40, "Teléfono del cliente")?,
                email: clean_opt(&c.email, 120, "Correo del cliente")?,
                address: clean_opt(&c.address, 220, "Dirección del cliente")?,
            }
        }
    };

    let mut validated = Vec::with_capacity(lines.len());
    let mut total: i64 = 0;
    for (i, l) in lines.iter().enumerate() {
        let label = format!("línea {}", i + 1);
        let quantity = validate_quantity(l.quantity, &label)?;
        let unit_price = validate_amount(l.unit_price, &format!("Precio de la {}", label), true)?;
        let (description, unit_cost, track_stock) = match l.product_id {
            Some(pid) => {
                let (name, cost, track, active): (String, i64, i64, i64) = tx
                    .query_row(
                        "SELECT name, cost, track_stock, is_active FROM products WHERE id = ?1",
                        params![pid],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .optional()
                    .map_err(|e| friendly_sql_error("Producto", e))?
                    .ok_or_else(|| format!("El producto de la {} no existe.", label))?;
                if active != 1 {
                    return Err(format!("El producto '{}' está archivado. Actívalo para usarlo.", name));
                }
                let desc = if l.description.trim().is_empty() {
                    name
                } else {
                    clean_req(&l.description, 300, &format!("Descripción de la {}", label))?
                };
                (desc, cost, track == 1)
            }
            None => (
                clean_req(&l.description, 300, &format!("Descripción de la {}", label))?,
                0,
                false,
            ),
        };
        let lt = line_total(quantity, unit_price)?;
        total = total
            .checked_add(lt)
            .filter(|t| *t <= MAX_AMOUNT)
            .ok_or_else(|| "El total del documento es demasiado grande.".to_string())?;
        validated.push(ValidatedLine {
            product_id: l.product_id,
            description,
            quantity,
            unit_price,
            unit_cost,
            track_stock,
            line_total: lt,
        });
    }

    Ok(ValidatedDocument {
        customer_id,
        customer: snapshot,
        issue_date,
        second_date,
        lines: validated,
        total,
        notes: clean_opt(notes, 2000, "Notas")?,
        terms: clean_opt(terms, 2000, "Condiciones")?,
        footer: clean_opt(footer, 500, "Pie de página")?,
    })
}

fn status_for(total: i64, paid: i64) -> &'static str {
    if paid >= total {
        "paid"
    } else if paid > 0 {
        "partial"
    } else {
        "pending"
    }
}

const INVOICE_SUMMARY_SELECT: &str = "
    SELECT i.id, i.number, i.customer_id, i.customer_name, i.issue_date, i.due_date, i.status,
           i.total, i.paid_amount, i.created_at
    FROM invoices i";

fn map_invoice_summary(r: &Row<'_>) -> rusqlite::Result<InvoiceSummary> {
    let total: i64 = r.get(7)?;
    let paid: i64 = r.get(8)?;
    let status: String = r.get(6)?;
    Ok(InvoiceSummary {
        id: r.get(0)?,
        number: r.get(1)?,
        customer_id: r.get(2)?,
        customer_name: r.get(3)?,
        issue_date: r.get(4)?,
        due_date: r.get(5)?,
        balance: if status == "void" { 0 } else { (total - paid).max(0) },
        status,
        total,
        paid_amount: paid,
        created_at: r.get(9)?,
    })
}

const QUOTE_SUMMARY_SELECT: &str = "
    SELECT q.id, q.number, q.customer_id, q.customer_name, q.issue_date, q.valid_until, q.status,
           q.total, q.converted_invoice_id,
           (SELECT number FROM invoices WHERE id = q.converted_invoice_id), q.created_at
    FROM quotes q";

fn map_quote_summary(r: &Row<'_>) -> rusqlite::Result<QuoteSummary> {
    Ok(QuoteSummary {
        id: r.get(0)?,
        number: r.get(1)?,
        customer_id: r.get(2)?,
        customer_name: r.get(3)?,
        issue_date: r.get(4)?,
        valid_until: r.get(5)?,
        status: r.get(6)?,
        total: r.get(7)?,
        converted_invoice_id: r.get(8)?,
        converted_invoice_number: r.get(9)?,
        created_at: r.get(10)?,
    })
}

fn load_lines(conn: &rusqlite::Connection, table: &str, fk: &str, id: i64) -> Result<Vec<DocumentLine>, String> {
    let sql = format!(
        "SELECT id, position, product_id, description, quantity, unit_price, line_total
         FROM {} WHERE {} = ?1 ORDER BY position ASC",
        table, fk
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| friendly_sql_error("Líneas", e))?;
    let rows = stmt
        .query_map(params![id], |r| {
            Ok(DocumentLine {
                id: r.get(0)?,
                position: r.get(1)?,
                product_id: r.get(2)?,
                description: r.get(3)?,
                quantity: r.get(4)?,
                unit_price: r.get(5)?,
                line_total: r.get(6)?,
            })
        })
        .map_err(|e| friendly_sql_error("Líneas", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| friendly_sql_error("Líneas", e))?;
    Ok(rows)
}

pub(crate) const PAYMENT_SELECT: &str = "
    SELECT p.id, p.invoice_id, i.number, i.customer_name, p.amount, p.method, p.paid_at, p.note,
           i.status = 'void', p.created_at
    FROM payments p JOIN invoices i ON i.id = p.invoice_id";

pub(crate) fn map_payment(r: &Row<'_>) -> rusqlite::Result<Payment> {
    Ok(Payment {
        id: r.get(0)?,
        invoice_id: r.get(1)?,
        invoice_number: r.get(2)?,
        customer_name: r.get(3)?,
        amount: r.get(4)?,
        method: r.get(5)?,
        paid_at: r.get(6)?,
        note: r.get(7)?,
        invoice_voided: r.get(8)?,
        created_at: r.get(9)?,
    })
}

fn insert_payment(
    tx: &Transaction<'_>,
    invoice_id: i64,
    p: &PaymentInput,
    user_id: i64,
) -> Result<(), String> {
    let (total, paid, status): (i64, i64, String) = tx
        .query_row(
            "SELECT total, paid_amount, status FROM invoices WHERE id = ?1",
            params![invoice_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .map_err(|e| friendly_sql_error("Pago", e))?
        .ok_or_else(|| "La factura no existe.".to_string())?;
    if status == "void" {
        return Err("No se pueden registrar pagos en una factura anulada.".to_string());
    }
    let amount = validate_amount(p.amount, "Valor del pago", false)?;
    let balance = total - paid;
    if amount > balance {
        return Err(format!(
            "El pago supera el saldo pendiente de la factura (saldo: {}).",
            balance
        ));
    }
    let method = validate_method(&p.method)?;
    let paid_at = clean_date(&p.paid_at, "Fecha del pago")?;
    let note = clean_opt(&p.note, 300, "Nota del pago")?;
    let now = now_rfc3339();
    tx.execute(
        "INSERT INTO payments (invoice_id, amount, method, paid_at, note, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![invoice_id, amount, method, paid_at, note, user_id, now],
    )
    .map_err(|e| friendly_sql_error("Pago", e))?;
    let new_paid = paid + amount;
    tx.execute(
        "UPDATE invoices SET paid_amount = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_paid, status_for(total, new_paid), now, invoice_id],
    )
    .map_err(|e| friendly_sql_error("Pago", e))?;
    Ok(())
}

/// Crea la factura dentro de una transacción existente. Usado también al convertir cotizaciones.
fn create_invoice_in_tx(
    tx: &Transaction<'_>,
    doc: &ValidatedDocument,
    quote_id: Option<i64>,
    initial_payment: &Option<PaymentInput>,
    user_id: i64,
) -> Result<i64, String> {
    let number = next_document_number(tx, "invoice")?;
    let now = now_rfc3339();
    let status = if doc.total == 0 { "paid" } else { "pending" };
    tx.execute(
        "INSERT INTO invoices (number, customer_id, customer_name, customer_document, customer_phone,
            customer_email, customer_address, issue_date, due_date, status, total, paid_amount,
            notes, terms, footer, quote_id, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?13, ?14, ?15, ?16, ?17, ?17)",
        params![
            number,
            doc.customer_id,
            doc.customer.name,
            doc.customer.document_id,
            doc.customer.phone,
            doc.customer.email,
            doc.customer.address,
            doc.issue_date,
            doc.second_date,
            status,
            doc.total,
            doc.notes,
            doc.terms,
            doc.footer,
            quote_id,
            user_id,
            now
        ],
    )
    .map_err(|e| friendly_sql_error("Crear factura", e))?;
    let invoice_id = tx.last_insert_rowid();

    for (pos, l) in doc.lines.iter().enumerate() {
        tx.execute(
            "INSERT INTO invoice_lines (invoice_id, position, product_id, description, quantity,
                unit_price, unit_cost, line_total)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                invoice_id,
                pos as i64 + 1,
                l.product_id,
                l.description,
                l.quantity,
                l.unit_price,
                l.unit_cost,
                l.line_total
            ],
        )
        .map_err(|e| friendly_sql_error("Crear factura", e))?;
        if let (Some(pid), true) = (l.product_id, l.track_stock) {
            apply_stock_change(
                tx,
                pid,
                -l.quantity,
                "sale",
                Some(l.unit_cost),
                Some(("invoice", invoice_id)),
                Some(&format!("Venta {}", number)),
                user_id,
            )?;
        }
    }

    if let Some(p) = initial_payment {
        if p.amount > 0 {
            insert_payment(tx, invoice_id, p, user_id)?;
        }
    }
    Ok(invoice_id)
}

impl LocalDatabase {
    pub fn create_invoice(&self, input: &InvoiceInput) -> Result<InvoiceDetail, String> {
        let user = self.require_authenticated_user()?;
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| friendly_sql_error("Crear factura", e))?;
        let doc = validate_document(
            &tx,
            input.customer_id,
            &input.customer,
            &input.issue_date,
            &input.due_date,
            "Fecha de vencimiento",
            &input.lines,
            &input.notes,
            &input.terms,
            &input.footer,
        )?;
        let id = create_invoice_in_tx(&tx, &doc, None, &input.initial_payment, user.id)?;
        tx.commit().map_err(|e| friendly_sql_error("Crear factura", e))?;
        drop(conn);
        self.get_invoice(id)
    }

    pub fn list_invoices(&self, filter: &InvoiceFilter) -> Result<Vec<InvoiceSummary>, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let pattern = like_pattern(filter.search.as_deref().unwrap_or(""));
        let status = filter.status.clone().filter(|s| !s.trim().is_empty());
        let date_from = clean_opt_date(&filter.date_from, "Desde")?;
        let date_to = clean_opt_date(&filter.date_to, "Hasta")?;
        let limit = filter.limit.unwrap_or(500).clamp(1, 5000);
        let sql = format!(
            "{} WHERE (i.number LIKE ?1 ESCAPE '\\' OR i.customer_name LIKE ?1 ESCAPE '\\'
                     OR IFNULL(i.customer_document, '') LIKE ?1 ESCAPE '\\')
               AND (?2 IS NULL
                    OR (?2 = 'open' AND i.status IN ('pending', 'partial'))
                    OR i.status = ?2)
               AND (?3 IS NULL OR i.issue_date >= ?3)
               AND (?4 IS NULL OR i.issue_date <= ?4)
               AND (?5 IS NULL OR i.customer_id = ?5)
             ORDER BY i.issue_date DESC, i.id DESC LIMIT ?6",
            INVOICE_SUMMARY_SELECT
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| friendly_sql_error("Facturas", e))?;
        let rows = stmt
            .query_map(
                params![pattern, status, date_from, date_to, filter.customer_id, limit],
                map_invoice_summary,
            )
            .map_err(|e| friendly_sql_error("Facturas", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Facturas", e))?;
        Ok(rows)
    }

    pub fn get_invoice(&self, id: i64) -> Result<InvoiceDetail, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let summary = conn
            .query_row(&format!("{} WHERE i.id = ?1", INVOICE_SUMMARY_SELECT), params![id], map_invoice_summary)
            .optional()
            .map_err(|e| friendly_sql_error("Factura", e))?
            .ok_or_else(|| "La factura no existe.".to_string())?;
        type Extra = (
            CustomerSnapshot,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        let extra: Extra = conn
            .query_row(
                "SELECT customer_name, customer_document, customer_phone, customer_email, customer_address,
                        notes, terms, footer, quote_id,
                        (SELECT number FROM quotes WHERE id = invoices.quote_id),
                        void_reason, voided_at
                 FROM invoices WHERE id = ?1",
                params![id],
                |r| {
                    Ok((
                        CustomerSnapshot {
                            name: r.get(0)?,
                            document_id: r.get(1)?,
                            phone: r.get(2)?,
                            email: r.get(3)?,
                            address: r.get(4)?,
                        },
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                        r.get(11)?,
                    ))
                },
            )
            .map_err(|e| friendly_sql_error("Factura", e))?;
        let lines = load_lines(&conn, "invoice_lines", "invoice_id", id)?;
        let mut stmt = conn
            .prepare(&format!("{} WHERE p.invoice_id = ?1 ORDER BY p.paid_at ASC, p.id ASC", PAYMENT_SELECT))
            .map_err(|e| friendly_sql_error("Pagos", e))?;
        let payments = stmt
            .query_map(params![id], map_payment)
            .map_err(|e| friendly_sql_error("Pagos", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Pagos", e))?;
        Ok(InvoiceDetail {
            summary,
            customer: extra.0,
            notes: extra.1,
            terms: extra.2,
            footer: extra.3,
            quote_id: extra.4,
            quote_number: extra.5,
            void_reason: extra.6,
            voided_at: extra.7,
            lines,
            payments,
        })
    }

    /// Registra un abono o pago total sobre una factura.
    pub fn add_payment(&self, invoice_id: i64, payment: &PaymentInput) -> Result<InvoiceDetail, String> {
        let user = self.require_authenticated_user()?;
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| friendly_sql_error("Pago", e))?;
        insert_payment(&tx, invoice_id, payment, user.id)?;
        tx.commit().map_err(|e| friendly_sql_error("Pago", e))?;
        drop(conn);
        self.get_invoice(invoice_id)
    }

    /// Anula una factura: conserva el número y el registro, devuelve las existencias y
    /// excluye sus pagos de los ingresos. No se borra nada.
    pub fn void_invoice(&self, invoice_id: i64, reason: &str) -> Result<InvoiceDetail, String> {
        let user = self.require_authenticated_user()?;
        let reason = clean_req(reason, 300, "Motivo de anulación")?;
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| friendly_sql_error("Anular factura", e))?;
        let (status, number): (String, String) = tx
            .query_row(
                "SELECT status, number FROM invoices WHERE id = ?1",
                params![invoice_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| friendly_sql_error("Anular factura", e))?
            .ok_or_else(|| "La factura no existe.".to_string())?;
        if status == "void" {
            return Err("La factura ya está anulada.".to_string());
        }
        let lines: Vec<(Option<i64>, f64, i64)> = {
            let mut stmt = tx
                .prepare("SELECT product_id, quantity, unit_cost FROM invoice_lines WHERE invoice_id = ?1")
                .map_err(|e| friendly_sql_error("Anular factura", e))?;
            let rows = stmt
                .query_map(params![invoice_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| friendly_sql_error("Anular factura", e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| friendly_sql_error("Anular factura", e))?;
            rows
        };
        for (pid, qty, cost) in lines {
            if let Some(pid) = pid {
                // Solo se devuelve inventario si la venta lo descontó.
                let was_tracked: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM inventory_movements WHERE reference_type = 'invoice'
                            AND reference_id = ?1 AND product_id = ?2 AND kind = 'sale')",
                        params![invoice_id, pid],
                        |r| r.get(0),
                    )
                    .map_err(|e| friendly_sql_error("Anular factura", e))?;
                if was_tracked {
                    apply_stock_change(
                        &tx,
                        pid,
                        qty,
                        "void_return",
                        Some(cost),
                        Some(("invoice", invoice_id)),
                        Some(&format!("Anulación {}", number)),
                        user.id,
                    )?;
                }
            }
        }
        let now = now_rfc3339();
        tx.execute(
            "UPDATE invoices SET status = 'void', void_reason = ?1, voided_at = ?2, updated_at = ?2 WHERE id = ?3",
            params![reason, now, invoice_id],
        )
        .map_err(|e| friendly_sql_error("Anular factura", e))?;
        tx.commit().map_err(|e| friendly_sql_error("Anular factura", e))?;
        drop(conn);
        self.get_invoice(invoice_id)
    }

    pub fn list_payments(
        &self,
        date_from: Option<String>,
        date_to: Option<String>,
    ) -> Result<Vec<Payment>, String> {
        self.require_authenticated_user()?;
        let from = clean_opt_date(&date_from, "Desde")?;
        let to = clean_opt_date(&date_to, "Hasta")?;
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE (?1 IS NULL OR p.paid_at >= ?1) AND (?2 IS NULL OR p.paid_at <= ?2)
                 ORDER BY p.paid_at DESC, p.id DESC LIMIT 5000",
                PAYMENT_SELECT
            ))
            .map_err(|e| friendly_sql_error("Pagos", e))?;
        let rows = stmt
            .query_map(params![from, to], map_payment)
            .map_err(|e| friendly_sql_error("Pagos", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Pagos", e))?;
        Ok(rows)
    }

    // ---------------------------------------------------------------- Cotizaciones

    pub fn create_quote(&self, input: &QuoteInput) -> Result<QuoteDetail, String> {
        let user = self.require_authenticated_user()?;
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| friendly_sql_error("Cotización", e))?;
        let doc = validate_document(
            &tx,
            input.customer_id,
            &input.customer,
            &input.issue_date,
            &input.valid_until,
            "Fecha de validez",
            &input.lines,
            &input.notes,
            &input.terms,
            &input.footer,
        )?;
        let number = next_document_number(&tx, "quote")?;
        let now = now_rfc3339();
        tx.execute(
            "INSERT INTO quotes (number, customer_id, customer_name, customer_document, customer_phone,
                customer_email, customer_address, issue_date, valid_until, status, total,
                notes, terms, footer, created_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open', ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            params![
                number,
                doc.customer_id,
                doc.customer.name,
                doc.customer.document_id,
                doc.customer.phone,
                doc.customer.email,
                doc.customer.address,
                doc.issue_date,
                doc.second_date,
                doc.total,
                doc.notes,
                doc.terms,
                doc.footer,
                user.id,
                now
            ],
        )
        .map_err(|e| friendly_sql_error("Cotización", e))?;
        let quote_id = tx.last_insert_rowid();
        for (pos, l) in doc.lines.iter().enumerate() {
            tx.execute(
                "INSERT INTO quote_lines (quote_id, position, product_id, description, quantity, unit_price, line_total)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![quote_id, pos as i64 + 1, l.product_id, l.description, l.quantity, l.unit_price, l.line_total],
            )
            .map_err(|e| friendly_sql_error("Cotización", e))?;
        }
        tx.commit().map_err(|e| friendly_sql_error("Cotización", e))?;
        drop(conn);
        self.get_quote(quote_id)
    }

    pub fn list_quotes(&self, search: Option<String>, status: Option<String>) -> Result<Vec<QuoteSummary>, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let pattern = like_pattern(search.as_deref().unwrap_or(""));
        let status = status.filter(|s| !s.trim().is_empty());
        let mut stmt = conn
            .prepare(&format!(
                "{} WHERE (q.number LIKE ?1 ESCAPE '\\' OR q.customer_name LIKE ?1 ESCAPE '\\')
                   AND (?2 IS NULL OR q.status = ?2)
                 ORDER BY q.issue_date DESC, q.id DESC LIMIT 2000",
                QUOTE_SUMMARY_SELECT
            ))
            .map_err(|e| friendly_sql_error("Cotizaciones", e))?;
        let rows = stmt
            .query_map(params![pattern, status], map_quote_summary)
            .map_err(|e| friendly_sql_error("Cotizaciones", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Cotizaciones", e))?;
        Ok(rows)
    }

    pub fn get_quote(&self, id: i64) -> Result<QuoteDetail, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let summary = conn
            .query_row(&format!("{} WHERE q.id = ?1", QUOTE_SUMMARY_SELECT), params![id], map_quote_summary)
            .optional()
            .map_err(|e| friendly_sql_error("Cotización", e))?
            .ok_or_else(|| "La cotización no existe.".to_string())?;
        let (customer, notes, terms, footer) = conn
            .query_row(
                "SELECT customer_name, customer_document, customer_phone, customer_email, customer_address,
                        notes, terms, footer FROM quotes WHERE id = ?1",
                params![id],
                |r| {
                    Ok((
                        CustomerSnapshot {
                            name: r.get(0)?,
                            document_id: r.get(1)?,
                            phone: r.get(2)?,
                            email: r.get(3)?,
                            address: r.get(4)?,
                        },
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                },
            )
            .map_err(|e| friendly_sql_error("Cotización", e))?;
        let lines = load_lines(&conn, "quote_lines", "quote_id", id)?;
        Ok(QuoteDetail { summary, customer, notes, terms, footer, lines })
    }

    pub fn cancel_quote(&self, id: i64) -> Result<QuoteDetail, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let n = conn
            .execute(
                "UPDATE quotes SET status = 'cancelled', updated_at = ?1 WHERE id = ?2 AND status = 'open'",
                params![now_rfc3339(), id],
            )
            .map_err(|e| friendly_sql_error("Cotización", e))?;
        if n == 0 {
            return Err("Solo se pueden cancelar cotizaciones abiertas.".to_string());
        }
        drop(conn);
        self.get_quote(id)
    }

    /// Convierte una cotización abierta en factura con un clic.
    pub fn convert_quote_to_invoice(
        &self,
        quote_id: i64,
        issue_date: &str,
        due_date: Option<String>,
    ) -> Result<InvoiceDetail, String> {
        let user = self.require_authenticated_user()?;
        let quote = self.get_quote(quote_id)?;
        if quote.summary.status != "open" {
            return Err("Solo se pueden facturar cotizaciones abiertas.".to_string());
        }
        let lines: Vec<DocumentLineInput> = quote
            .lines
            .iter()
            .map(|l| DocumentLineInput {
                product_id: l.product_id,
                description: l.description.clone(),
                quantity: l.quantity,
                unit_price: l.unit_price,
            })
            .collect();
        let snapshot = CustomerSnapshotInput {
            name: quote.customer.name.clone(),
            document_id: quote.customer.document_id.clone(),
            phone: quote.customer.phone.clone(),
            email: quote.customer.email.clone(),
            address: quote.customer.address.clone(),
        };
        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| friendly_sql_error("Convertir cotización", e))?;
        // Si el cliente sigue existiendo se enlaza; si no, se usa la copia de sus datos.
        let customer_id = match quote.summary.customer_id {
            Some(cid) => {
                let exists: bool = tx
                    .query_row("SELECT EXISTS(SELECT 1 FROM customers WHERE id = ?1)", params![cid], |r| r.get(0))
                    .map_err(|e| friendly_sql_error("Convertir cotización", e))?;
                if exists { Some(cid) } else { None }
            }
            None => None,
        };
        let doc = validate_document(
            &tx,
            customer_id,
            &Some(snapshot),
            issue_date,
            &due_date,
            "Fecha de vencimiento",
            &lines,
            &quote.notes,
            &quote.terms,
            &quote.footer,
        )?;
        let invoice_id = create_invoice_in_tx(&tx, &doc, Some(quote_id), &None, user.id)?;
        tx.execute(
            "UPDATE quotes SET status = 'converted', converted_invoice_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![invoice_id, now_rfc3339(), quote_id],
        )
        .map_err(|e| friendly_sql_error("Convertir cotización", e))?;
        tx.commit().map_err(|e| friendly_sql_error("Convertir cotización", e))?;
        drop(conn);
        self.get_invoice(invoice_id)
    }
}
