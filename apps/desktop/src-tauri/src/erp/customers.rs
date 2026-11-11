//! Directorio local de clientes.

use super::*;
use crate::db::LocalDatabase;
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: i64,
    pub name: String,
    pub document_id: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub invoice_count: i64,
    pub total_invoiced: i64,
    pub balance_due: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomerInput {
    pub id: Option<i64>,
    pub name: String,
    pub document_id: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
}

const CUSTOMER_SELECT: &str = "
    SELECT c.id, c.name, c.document_id, c.phone, c.email, c.address, c.notes, c.is_active,
           c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status <> 'void'),
           (SELECT COALESCE(SUM(i.total), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status <> 'void'),
           (SELECT COALESCE(SUM(i.total - i.paid_amount), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status <> 'void')
    FROM customers c";

fn map_customer(row: &Row<'_>) -> rusqlite::Result<Customer> {
    Ok(Customer {
        id: row.get(0)?,
        name: row.get(1)?,
        document_id: row.get(2)?,
        phone: row.get(3)?,
        email: row.get(4)?,
        address: row.get(5)?,
        notes: row.get(6)?,
        is_active: row.get::<_, i64>(7)? == 1,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        invoice_count: row.get(10)?,
        total_invoiced: row.get(11)?,
        balance_due: row.get(12)?,
    })
}

impl LocalDatabase {
    pub fn list_customers(
        &self,
        search: Option<String>,
        include_inactive: bool,
    ) -> Result<Vec<Customer>, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let pattern = like_pattern(search.as_deref().unwrap_or(""));
        let sql = format!(
            "{} WHERE (?1 = 1 OR c.is_active = 1)
               AND (c.name LIKE ?2 ESCAPE '\\' OR IFNULL(c.document_id, '') LIKE ?2 ESCAPE '\\'
                    OR IFNULL(c.phone, '') LIKE ?2 ESCAPE '\\' OR IFNULL(c.email, '') LIKE ?2 ESCAPE '\\')
             ORDER BY c.is_active DESC, c.name COLLATE NOCASE ASC
             LIMIT 2000",
            CUSTOMER_SELECT
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| friendly_sql_error("Clientes", e))?;
        let rows = stmt
            .query_map(params![include_inactive as i64, pattern], map_customer)
            .map_err(|e| friendly_sql_error("Clientes", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Clientes", e))?;
        Ok(rows)
    }

    pub fn get_customer(&self, id: i64) -> Result<Customer, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        conn.query_row(
            &format!("{} WHERE c.id = ?1", CUSTOMER_SELECT),
            params![id],
            map_customer,
        )
        .optional()
        .map_err(|e| friendly_sql_error("Clientes", e))?
        .ok_or_else(|| "El cliente no existe.".to_string())
    }

    pub fn save_customer(&self, input: &CustomerInput) -> Result<Customer, String> {
        self.require_authenticated_user()?;
        let name = clean_req(&input.name, 160, "Nombre")?;
        let document_id = clean_opt(&input.document_id, 40, "Documento")?;
        let phone = clean_opt(&input.phone, 40, "Teléfono")?;
        let email = clean_opt(&input.email, 120, "Correo")?;
        if let Some(ref m) = email {
            if !m.contains('@') || m.starts_with('@') || m.ends_with('@') {
                return Err("El correo electrónico no tiene un formato válido.".to_string());
            }
        }
        let address = clean_opt(&input.address, 220, "Dirección")?;
        let notes = clean_opt(&input.notes, 1000, "Notas")?;
        let now = now_rfc3339();
        let conn = self.connect()?;
        let id = match input.id {
            Some(id) => {
                let changed = conn
                    .execute(
                        "UPDATE customers SET name = ?1, document_id = ?2, phone = ?3, email = ?4,
                         address = ?5, notes = ?6, updated_at = ?7 WHERE id = ?8",
                        params![name, document_id, phone, email, address, notes, now, id],
                    )
                    .map_err(|e| friendly_sql_error("Guardar cliente", e))?;
                if changed == 0 {
                    return Err("El cliente no existe.".to_string());
                }
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO customers (name, document_id, phone, email, address, notes, is_active, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
                    params![name, document_id, phone, email, address, notes, now],
                )
                .map_err(|e| friendly_sql_error("Guardar cliente", e))?;
                conn.last_insert_rowid()
            }
        };
        drop(conn);
        self.get_customer(id)
    }

    /// Activa o archiva un cliente. Los clientes no se borran para conservar el historial.
    pub fn set_customer_active(&self, id: i64, active: bool) -> Result<Customer, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let changed = conn
            .execute(
                "UPDATE customers SET is_active = ?1, updated_at = ?2 WHERE id = ?3",
                params![active as i64, now_rfc3339(), id],
            )
            .map_err(|e| friendly_sql_error("Cliente", e))?;
        if changed == 0 {
            return Err("El cliente no existe.".to_string());
        }
        drop(conn);
        self.get_customer(id)
    }
}
