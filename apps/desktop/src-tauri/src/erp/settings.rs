//! Configuración comercial: numeración de documentos, textos por defecto e impresión.

use super::*;
use crate::db::LocalDatabase;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const PAPER_SIZES: &[&str] = &["letter", "half-letter", "a4", "roll80", "roll58"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BusinessSettings {
    pub invoice_prefix: String,
    pub invoice_next_number: i64,
    pub quote_prefix: String,
    pub quote_next_number: i64,
    pub default_due_days: i64,
    pub default_quote_valid_days: i64,
    pub default_notes: String,
    pub default_terms: String,
    pub default_footer: String,
    pub paper_size: String,
    pub show_logo_on_print: bool,
}

fn meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM _app_metadata WHERE key = ?1", params![key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn set_meta(conn: &Connection, key: &str, value: &str, now: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO _app_metadata (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )
    .map_err(|e| friendly_sql_error("Configuración", e))?;
    Ok(())
}

fn validate_prefix(p: &str) -> Result<String, String> {
    let t = p.trim();
    if t.chars().count() > 12 {
        return Err("El prefijo admite como máximo 12 caracteres.".to_string());
    }
    if !t.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.') {
        return Err("El prefijo solo puede tener letras, números, guiones, puntos o barras.".to_string());
    }
    Ok(t.to_string())
}

impl LocalDatabase {
    pub fn get_business_settings(&self) -> Result<BusinessSettings, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let seq = |t: &str| -> Result<(String, i64), String> {
            conn.query_row(
                "SELECT prefix, next_number FROM document_sequences WHERE doc_type = ?1",
                params![t],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| friendly_sql_error("Configuración", e))
        };
        let (ip, inn) = seq("invoice")?;
        let (qp, qn) = seq("quote")?;
        Ok(BusinessSettings {
            invoice_prefix: ip,
            invoice_next_number: inn,
            quote_prefix: qp,
            quote_next_number: qn,
            default_due_days: meta(&conn, "invoice_default_due_days").and_then(|v| v.parse().ok()).unwrap_or(0),
            default_quote_valid_days: meta(&conn, "quote_default_valid_days").and_then(|v| v.parse().ok()).unwrap_or(15),
            default_notes: meta(&conn, "invoice_default_notes").unwrap_or_default(),
            default_terms: meta(&conn, "invoice_default_terms").unwrap_or_default(),
            default_footer: meta(&conn, "invoice_default_footer")
                .unwrap_or_else(|| "Gracias por su compra.".to_string()),
            paper_size: meta(&conn, "print_paper_size").unwrap_or_else(|| "letter".to_string()),
            show_logo_on_print: meta(&conn, "print_show_logo").map(|v| v != "0").unwrap_or(true),
        })
    }

    pub fn save_business_settings(&self, s: &BusinessSettings) -> Result<BusinessSettings, String> {
        self.require_authenticated_user()?;
        let invoice_prefix = validate_prefix(&s.invoice_prefix)?;
        let quote_prefix = validate_prefix(&s.quote_prefix)?;
        if !PAPER_SIZES.contains(&s.paper_size.as_str()) {
            return Err("Tamaño de hoja no válido.".to_string());
        }
        if !(0..=365).contains(&s.default_due_days) || !(0..=365).contains(&s.default_quote_valid_days) {
            return Err("Los días deben estar entre 0 y 365.".to_string());
        }
        let notes = clean_opt(&Some(s.default_notes.clone()), 2000, "Notas por defecto")?.unwrap_or_default();
        let terms = clean_opt(&Some(s.default_terms.clone()), 2000, "Condiciones por defecto")?.unwrap_or_default();
        let footer = clean_opt(&Some(s.default_footer.clone()), 500, "Pie de página")?.unwrap_or_default();

        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| friendly_sql_error("Configuración", e))?;
        let now = now_rfc3339();
        for (doc, prefix, next) in [
            ("invoice", &invoice_prefix, s.invoice_next_number),
            ("quote", &quote_prefix, s.quote_next_number),
        ] {
            let current: i64 = tx
                .query_row("SELECT next_number FROM document_sequences WHERE doc_type = ?1", params![doc], |r| r.get(0))
                .map_err(|e| friendly_sql_error("Configuración", e))?;
            if next < current {
                return Err(format!(
                    "El siguiente número de {} no puede ser menor que el actual ({}), para no repetir consecutivos.",
                    if doc == "invoice" { "factura" } else { "cotización" },
                    current
                ));
            }
            if next > 99_999_999 {
                return Err("El número consecutivo es demasiado grande.".to_string());
            }
            let table = if doc == "invoice" { "invoices" } else { "quotes" };
            let candidate = format!("{}{:05}", prefix, next);
            let taken: bool = tx
                .query_row(
                    &format!("SELECT EXISTS(SELECT 1 FROM {} WHERE number = ?1)", table),
                    params![candidate],
                    |r| r.get(0),
                )
                .map_err(|e| friendly_sql_error("Configuración", e))?;
            if taken {
                return Err(format!("El número {} ya existe. Elige otro prefijo o un número mayor.", candidate));
            }
            tx.execute(
                "UPDATE document_sequences SET prefix = ?1, next_number = ?2, updated_at = ?3 WHERE doc_type = ?4",
                params![prefix, next, now, doc],
            )
            .map_err(|e| friendly_sql_error("Configuración", e))?;
        }
        set_meta(&tx, "invoice_default_due_days", &s.default_due_days.to_string(), &now)?;
        set_meta(&tx, "quote_default_valid_days", &s.default_quote_valid_days.to_string(), &now)?;
        set_meta(&tx, "invoice_default_notes", &notes, &now)?;
        set_meta(&tx, "invoice_default_terms", &terms, &now)?;
        set_meta(&tx, "invoice_default_footer", &footer, &now)?;
        set_meta(&tx, "print_paper_size", &s.paper_size, &now)?;
        set_meta(&tx, "print_show_logo", if s.show_logo_on_print { "1" } else { "0" }, &now)?;
        tx.commit().map_err(|e| friendly_sql_error("Configuración", e))?;
        drop(conn);
        self.get_business_settings()
    }
}
