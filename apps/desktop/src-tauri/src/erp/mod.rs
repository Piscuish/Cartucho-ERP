//! Módulos de negocio de Cartucho ERP: clientes, catálogo, inventario, facturación,
//! cotizaciones, gastos, finanzas, búsqueda y configuración comercial.
//!
//! Convenciones:
//! - Los montos se guardan como enteros (`i64`) en pesos, sin decimales.
//! - Las cantidades admiten decimales (`f64`), por ejemplo kilos o metros.
//! - Las fechas de negocio se guardan como texto `AAAA-MM-DD` (fecha local del usuario);
//!   las marcas de auditoría (`created_at`, `updated_at`) en RFC 3339 UTC.
//! - Toda operación exige sesión autenticada y se valida aquí, en Rust.

pub mod catalog;
pub mod customers;
pub mod finance;
pub mod sales;
pub mod settings;

#[cfg(test)]
mod tests;

use chrono::NaiveDate;
use rusqlite::{params, Transaction};

/// Monto máximo aceptado por operación (1 billón de pesos) para evitar desbordes.
pub(crate) const MAX_AMOUNT: i64 = 1_000_000_000_000;
/// Cantidad máxima por línea o movimiento.
pub(crate) const MAX_QUANTITY: f64 = 1_000_000_000.0;

pub(crate) const PAYMENT_METHODS: &[&str] = &["cash", "transfer", "card", "other"];

/// Limpia un texto opcional: vacío → `None`; valida longitud máxima.
pub(crate) fn clean_opt(
    value: &Option<String>,
    max_len: usize,
    label: &str,
) -> Result<Option<String>, String> {
    match value {
        Some(raw) => {
            let t = raw.trim();
            if t.is_empty() {
                Ok(None)
            } else if t.chars().count() > max_len {
                Err(format!(
                    "El campo '{}' no puede superar {} caracteres.",
                    label, max_len
                ))
            } else {
                Ok(Some(t.to_string()))
            }
        }
        None => Ok(None),
    }
}

/// Limpia un texto obligatorio.
pub(crate) fn clean_req(value: &str, max_len: usize, label: &str) -> Result<String, String> {
    let t = value.trim();
    if t.is_empty() {
        return Err(format!("El campo '{}' es obligatorio.", label));
    }
    if t.chars().count() > max_len {
        return Err(format!(
            "El campo '{}' no puede superar {} caracteres.",
            label, max_len
        ));
    }
    Ok(t.to_string())
}

/// Valida una fecha `AAAA-MM-DD`.
pub(crate) fn clean_date(value: &str, label: &str) -> Result<String, String> {
    let t = value.trim();
    NaiveDate::parse_from_str(t, "%Y-%m-%d")
        .map(|d| d.format("%Y-%m-%d").to_string())
        .map_err(|_| format!("La fecha '{}' no es válida (formato AAAA-MM-DD).", label))
}

pub(crate) fn clean_opt_date(
    value: &Option<String>,
    label: &str,
) -> Result<Option<String>, String> {
    match value {
        Some(v) if !v.trim().is_empty() => Ok(Some(clean_date(v, label)?)),
        _ => Ok(None),
    }
}

pub(crate) fn validate_amount(value: i64, label: &str, allow_zero: bool) -> Result<i64, String> {
    if value < 0 || (!allow_zero && value == 0) {
        return Err(format!(
            "El valor de '{}' debe ser {} a cero.",
            label,
            if allow_zero { "mayor o igual" } else { "mayor" }
        ));
    }
    if value > MAX_AMOUNT {
        return Err(format!("El valor de '{}' es demasiado grande.", label));
    }
    Ok(value)
}

pub(crate) fn validate_quantity(value: f64, label: &str) -> Result<f64, String> {
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("La cantidad de '{}' debe ser mayor a cero.", label));
    }
    if value > MAX_QUANTITY {
        return Err(format!("La cantidad de '{}' es demasiado grande.", label));
    }
    // Se limitan las cantidades a 3 decimales para evitar ruido de coma flotante.
    Ok((value * 1000.0).round() / 1000.0)
}

pub(crate) fn validate_method(method: &str) -> Result<String, String> {
    let m = method.trim().to_lowercase();
    if PAYMENT_METHODS.contains(&m.as_str()) {
        Ok(m)
    } else {
        Err("Método de pago no válido. Usa efectivo, transferencia, tarjeta u otro.".to_string())
    }
}

/// Redondea cantidad × precio a pesos enteros.
pub(crate) fn line_total(quantity: f64, unit_price: i64) -> Result<i64, String> {
    let raw = (quantity * unit_price as f64).round();
    if !raw.is_finite() || raw > MAX_AMOUNT as f64 {
        return Err("El total de una línea es demasiado grande.".to_string());
    }
    Ok(raw as i64)
}

/// Escapa el comodín de LIKE para búsquedas de texto.
pub(crate) fn like_pattern(search: &str) -> String {
    let escaped = search
        .trim()
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{}%", escaped)
}

/// Reserva el siguiente número consecutivo de un tipo de documento dentro de la transacción.
pub(crate) fn next_document_number(tx: &Transaction<'_>, doc_type: &str) -> Result<String, String> {
    let (prefix, next): (String, i64) = tx
        .query_row(
            "SELECT prefix, next_number FROM document_sequences WHERE doc_type = ?1",
            params![doc_type],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Error leyendo el consecutivo de documentos: {}", e))?;
    let number = format!("{}{:05}", prefix, next);
    tx.execute(
        "UPDATE document_sequences SET next_number = next_number + 1, updated_at = ?2 WHERE doc_type = ?1",
        params![doc_type, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|e| format!("Error actualizando el consecutivo: {}", e))?;
    Ok(number)
}

pub(crate) fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Traduce errores de restricciones SQLite a mensajes comprensibles sin exponer datos.
pub(crate) fn friendly_sql_error(context: &str, err: rusqlite::Error) -> String {
    let text = err.to_string();
    if text.contains("UNIQUE constraint failed: products.sku") {
        return "Ya existe un producto con ese código (SKU).".to_string();
    }
    if text.contains("UNIQUE constraint failed: categories") {
        return "Ya existe una categoría con ese nombre.".to_string();
    }
    if text.contains("UNIQUE constraint failed: invoices.number")
        || text.contains("UNIQUE constraint failed: quotes.number")
    {
        return "El número consecutivo ya está en uso. Revisa la numeración en Configuración > Facturación.".to_string();
    }
    if text.contains("FOREIGN KEY constraint failed") {
        return format!(
            "{}: el registro está relacionado con otros datos y no se puede modificar así.",
            context
        );
    }
    if text.contains("database is locked") || text.contains("busy") {
        return "La base de datos está ocupada. Intenta de nuevo en unos segundos.".to_string();
    }
    format!("{}: {}", context, text)
}
