//! Catálogo de productos y servicios, categorías e inventario.

use super::*;
use crate::db::{validate_and_decode_image, LocalDatabase};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rusqlite::{params, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

/// Tamaño máximo de la foto de referencia de un producto (el frontend la reduce antes).
pub const MAX_PRODUCT_IMAGE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub usage_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Product {
    pub id: i64,
    pub sku: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category_id: Option<i64>,
    pub category_name: Option<String>,
    pub unit: String,
    pub price: i64,
    pub cost: i64,
    pub track_stock: bool,
    pub stock_qty: f64,
    pub min_stock: f64,
    pub is_low_stock: bool,
    pub image_data_url: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductInput {
    pub id: Option<i64>,
    pub sku: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub category_id: Option<i64>,
    pub unit: Option<String>,
    pub price: i64,
    pub cost: i64,
    #[serde(default = "default_true")]
    pub track_stock: bool,
    #[serde(default)]
    pub min_stock: f64,
    /// Existencia inicial (solo al crear el producto).
    pub initial_stock: Option<f64>,
    pub image_base64: Option<String>,
    pub image_mime_type: Option<String>,
    #[serde(default)]
    pub remove_image: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StockAdjustmentInput {
    pub product_id: i64,
    /// `purchase`: suma `quantity` al inventario. `adjustment`: `quantity` es el nuevo conteo real.
    pub kind: String,
    pub quantity: f64,
    pub unit_cost: Option<i64>,
    pub note: Option<String>,
    /// Si es una compra, registrar también el gasto en Finanzas.
    #[serde(default)]
    pub record_expense: bool,
    pub expense_date: Option<String>,
    pub method: Option<String>,
    pub supplier: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryMovement {
    pub id: i64,
    pub product_id: i64,
    pub product_name: String,
    pub kind: String,
    pub quantity: f64,
    pub unit_cost: Option<i64>,
    pub stock_after: f64,
    pub reference_type: Option<String>,
    pub reference_id: Option<i64>,
    pub reference_label: Option<String>,
    pub note: Option<String>,
    pub created_at: String,
}

const PRODUCT_SELECT: &str = "
    SELECT p.id, p.sku, p.name, p.description, p.category_id, c.name, p.unit, p.price, p.cost,
           p.track_stock, p.stock_qty, p.min_stock, p.image_blob, p.image_mime, p.is_active,
           p.created_at, p.updated_at
    FROM products p LEFT JOIN categories c ON c.id = p.category_id";

fn map_product(row: &Row<'_>) -> rusqlite::Result<Product> {
    let blob: Option<Vec<u8>> = row.get(12)?;
    let mime: Option<String> = row.get(13)?;
    let image_data_url = match (blob, mime) {
        (Some(b), Some(m)) if !b.is_empty() => {
            Some(format!("data:{};base64,{}", m, BASE64_STANDARD.encode(b)))
        }
        _ => None,
    };
    let track_stock = row.get::<_, i64>(9)? == 1;
    let stock_qty: f64 = row.get(10)?;
    let min_stock: f64 = row.get(11)?;
    Ok(Product {
        id: row.get(0)?,
        sku: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        category_id: row.get(4)?,
        category_name: row.get(5)?,
        unit: row.get(6)?,
        price: row.get(7)?,
        cost: row.get(8)?,
        track_stock,
        stock_qty,
        min_stock,
        is_low_stock: track_stock && stock_qty <= min_stock,
        image_data_url,
        is_active: row.get::<_, i64>(14)? == 1,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

fn validate_kind(kind: &str) -> Result<String, String> {
    match kind.trim() {
        "product" | "expense" => Ok(kind.trim().to_string()),
        _ => Err("Tipo de categoría no válido.".to_string()),
    }
}

/// Aplica un cambio de existencias dentro de una transacción y registra el movimiento.
/// Si el producto no controla inventario, no hace nada y devuelve `None`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_stock_change(
    tx: &Transaction<'_>,
    product_id: i64,
    delta: f64,
    kind: &str,
    unit_cost: Option<i64>,
    reference: Option<(&str, i64)>,
    note: Option<&str>,
    user_id: i64,
) -> Result<Option<i64>, String> {
    let row: Option<(i64, f64)> = tx
        .query_row(
            "SELECT track_stock, stock_qty FROM products WHERE id = ?1",
            params![product_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| friendly_sql_error("Inventario", e))?;
    let (track, current) = row.ok_or_else(|| "El producto no existe.".to_string())?;
    if track != 1 {
        return Ok(None);
    }
    let new_qty = ((current + delta) * 1000.0).round() / 1000.0;
    let now = now_rfc3339();
    tx.execute(
        "UPDATE products SET stock_qty = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_qty, now, product_id],
    )
    .map_err(|e| friendly_sql_error("Inventario", e))?;
    tx.execute(
        "INSERT INTO inventory_movements
            (product_id, kind, quantity, unit_cost, stock_after, reference_type, reference_id, note, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            product_id,
            kind,
            delta,
            unit_cost,
            new_qty,
            reference.map(|r| r.0),
            reference.map(|r| r.1),
            note,
            user_id,
            now
        ],
    )
    .map_err(|e| friendly_sql_error("Inventario", e))?;
    Ok(Some(tx.last_insert_rowid()))
}

impl LocalDatabase {
    // ---------------------------------------------------------------- Categorías

    pub fn list_categories(&self, kind: &str) -> Result<Vec<Category>, String> {
        self.require_authenticated_user()?;
        let kind = validate_kind(kind)?;
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT c.id, c.kind, c.name,
                        (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id)
                      + (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id)
                 FROM categories c WHERE c.kind = ?1 ORDER BY c.name COLLATE NOCASE",
            )
            .map_err(|e| friendly_sql_error("Categorías", e))?;
        let rows = stmt
            .query_map(params![kind], |r| {
                Ok(Category {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    name: r.get(2)?,
                    usage_count: r.get(3)?,
                })
            })
            .map_err(|e| friendly_sql_error("Categorías", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Categorías", e))?;
        Ok(rows)
    }

    pub fn save_category(
        &self,
        id: Option<i64>,
        kind: &str,
        name: &str,
    ) -> Result<Category, String> {
        self.require_authenticated_user()?;
        let kind = validate_kind(kind)?;
        let name = clean_req(name, 80, "Nombre de categoría")?;
        let conn = self.connect()?;
        let id = match id {
            Some(id) => {
                let n = conn
                    .execute(
                        "UPDATE categories SET name = ?1 WHERE id = ?2 AND kind = ?3",
                        params![name, id, kind],
                    )
                    .map_err(|e| friendly_sql_error("Categoría", e))?;
                if n == 0 {
                    return Err("La categoría no existe.".to_string());
                }
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO categories (kind, name, created_at) VALUES (?1, ?2, ?3)",
                    params![kind, name, now_rfc3339()],
                )
                .map_err(|e| friendly_sql_error("Categoría", e))?;
                conn.last_insert_rowid()
            }
        };
        self.list_categories(&kind)?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| "No se pudo leer la categoría guardada.".to_string())
    }

    /// Elimina una categoría solo si no está en uso (acción iniciada por el usuario).
    pub fn delete_category(&self, id: i64) -> Result<(), String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let usage: i64 = conn
            .query_row(
                "SELECT (SELECT COUNT(*) FROM products WHERE category_id = ?1)
                      + (SELECT COUNT(*) FROM expenses WHERE category_id = ?1)",
                params![id],
                |r| r.get(0),
            )
            .map_err(|e| friendly_sql_error("Categoría", e))?;
        if usage > 0 {
            return Err(
                "La categoría está en uso. Cambia primero los productos o gastos que la usan."
                    .to_string(),
            );
        }
        let n = conn
            .execute("DELETE FROM categories WHERE id = ?1", params![id])
            .map_err(|e| friendly_sql_error("Categoría", e))?;
        if n == 0 {
            return Err("La categoría no existe.".to_string());
        }
        Ok(())
    }

    // ---------------------------------------------------------------- Productos

    pub fn list_products(
        &self,
        search: Option<String>,
        category_id: Option<i64>,
        include_inactive: bool,
        only_low_stock: bool,
    ) -> Result<Vec<Product>, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let pattern = like_pattern(search.as_deref().unwrap_or(""));
        let sql = format!(
            "{} WHERE (?1 = 1 OR p.is_active = 1)
               AND (?2 IS NULL OR p.category_id = ?2)
               AND (p.name LIKE ?3 ESCAPE '\\' OR IFNULL(p.sku, '') LIKE ?3 ESCAPE '\\'
                    OR IFNULL(p.description, '') LIKE ?3 ESCAPE '\\')
               AND (?4 = 0 OR (p.track_stock = 1 AND p.stock_qty <= p.min_stock AND p.is_active = 1))
             ORDER BY p.is_active DESC, p.name COLLATE NOCASE ASC
             LIMIT 5000",
            PRODUCT_SELECT
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| friendly_sql_error("Productos", e))?;
        let rows = stmt
            .query_map(
                params![
                    include_inactive as i64,
                    category_id,
                    pattern,
                    only_low_stock as i64
                ],
                map_product,
            )
            .map_err(|e| friendly_sql_error("Productos", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Productos", e))?;
        Ok(rows)
    }

    pub fn get_product(&self, id: i64) -> Result<Product, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        conn.query_row(
            &format!("{} WHERE p.id = ?1", PRODUCT_SELECT),
            params![id],
            map_product,
        )
        .optional()
        .map_err(|e| friendly_sql_error("Productos", e))?
        .ok_or_else(|| "El producto no existe.".to_string())
    }

    pub fn save_product(&self, input: &ProductInput) -> Result<Product, String> {
        let user = self.require_authenticated_user()?;
        let name = clean_req(&input.name, 160, "Nombre")?;
        let sku = clean_opt(&input.sku, 60, "Código / SKU")?;
        let description = clean_opt(&input.description, 2000, "Descripción")?;
        let unit = clean_opt(&input.unit, 20, "Unidad")?.unwrap_or_else(|| "und".to_string());
        let price = validate_amount(input.price, "Precio", true)?;
        let cost = validate_amount(input.cost, "Costo", true)?;
        if !input.min_stock.is_finite() || input.min_stock < 0.0 || input.min_stock > MAX_QUANTITY {
            return Err("El stock mínimo debe ser un número mayor o igual a cero.".to_string());
        }
        let image = match (&input.image_base64, &input.image_mime_type) {
            (Some(b64), Some(mime)) if !b64.trim().is_empty() => Some(validate_and_decode_image(
                b64,
                mime,
                MAX_PRODUCT_IMAGE_BYTES,
                "La foto del producto",
            )?),
            _ => None,
        };

        let mut conn = self.connect()?;
        let tx = conn
            .transaction()
            .map_err(|e| friendly_sql_error("Producto", e))?;
        if let Some(cat) = input.category_id {
            let ok: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM categories WHERE id = ?1 AND kind = 'product')",
                    params![cat],
                    |r| r.get(0),
                )
                .map_err(|e| friendly_sql_error("Producto", e))?;
            if !ok {
                return Err("La categoría seleccionada no existe.".to_string());
            }
        }
        let now = now_rfc3339();
        let id = match input.id {
            Some(id) => {
                let n = tx
                    .execute(
                        "UPDATE products SET sku = ?1, name = ?2, description = ?3, category_id = ?4,
                            unit = ?5, price = ?6, cost = ?7, track_stock = ?8, min_stock = ?9, updated_at = ?10
                         WHERE id = ?11",
                        params![
                            sku,
                            name,
                            description,
                            input.category_id,
                            unit,
                            price,
                            cost,
                            input.track_stock as i64,
                            input.min_stock,
                            now,
                            id
                        ],
                    )
                    .map_err(|e| friendly_sql_error("Guardar producto", e))?;
                if n == 0 {
                    return Err("El producto no existe.".to_string());
                }
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO products (sku, name, description, category_id, unit, price, cost,
                        track_stock, stock_qty, min_stock, is_active, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, 1, ?10, ?10)",
                    params![
                        sku,
                        name,
                        description,
                        input.category_id,
                        unit,
                        price,
                        cost,
                        input.track_stock as i64,
                        input.min_stock,
                        now
                    ],
                )
                .map_err(|e| friendly_sql_error("Guardar producto", e))?;
                let new_id = tx.last_insert_rowid();
                if let Some(initial) = input.initial_stock {
                    if input.track_stock && initial != 0.0 {
                        if !initial.is_finite() || !(0.0..=MAX_QUANTITY).contains(&initial) {
                            return Err("La existencia inicial no es válida.".to_string());
                        }
                        apply_stock_change(
                            &tx,
                            new_id,
                            initial,
                            "initial",
                            Some(cost),
                            None,
                            Some("Existencia inicial"),
                            user.id,
                        )?;
                    }
                }
                new_id
            }
        };
        if input.remove_image {
            tx.execute(
                "UPDATE products SET image_blob = NULL, image_mime = NULL WHERE id = ?1",
                params![id],
            )
            .map_err(|e| friendly_sql_error("Producto", e))?;
        } else if let Some((bytes, mime)) = image {
            tx.execute(
                "UPDATE products SET image_blob = ?1, image_mime = ?2 WHERE id = ?3",
                params![bytes, mime, id],
            )
            .map_err(|e| friendly_sql_error("Producto", e))?;
        }
        tx.commit().map_err(|e| friendly_sql_error("Producto", e))?;
        self.get_product(id)
    }

    /// Activa o archiva un producto (no se borra para conservar el historial de ventas).
    pub fn set_product_active(&self, id: i64, active: bool) -> Result<Product, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let n = conn
            .execute(
                "UPDATE products SET is_active = ?1, updated_at = ?2 WHERE id = ?3",
                params![active as i64, now_rfc3339(), id],
            )
            .map_err(|e| friendly_sql_error("Producto", e))?;
        if n == 0 {
            return Err("El producto no existe.".to_string());
        }
        drop(conn);
        self.get_product(id)
    }

    // ---------------------------------------------------------------- Inventario

    /// Registra una compra (entrada) o un ajuste por conteo físico.
    pub fn adjust_stock(&self, input: &StockAdjustmentInput) -> Result<Product, String> {
        let user = self.require_authenticated_user()?;
        let note = clean_opt(&input.note, 300, "Nota")?;
        let mut conn = self.connect()?;
        let tx = conn
            .transaction()
            .map_err(|e| friendly_sql_error("Inventario", e))?;
        let (name, track, current): (String, i64, f64) = tx
            .query_row(
                "SELECT name, track_stock, stock_qty FROM products WHERE id = ?1",
                params![input.product_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| friendly_sql_error("Inventario", e))?
            .ok_or_else(|| "El producto no existe.".to_string())?;
        if track != 1 {
            return Err("Este producto no controla inventario. Actívalo en su ficha para registrar existencias.".to_string());
        }

        match input.kind.as_str() {
            "purchase" => {
                let qty = validate_quantity(input.quantity, "Compra")?;
                let unit_cost = match input.unit_cost {
                    Some(c) => Some(validate_amount(c, "Costo unitario", true)?),
                    None => None,
                };
                let movement_id = apply_stock_change(
                    &tx,
                    input.product_id,
                    qty,
                    "purchase",
                    unit_cost,
                    None,
                    note.as_deref(),
                    user.id,
                )?
                .unwrap_or(0);
                if let Some(c) = unit_cost {
                    if c > 0 {
                        tx.execute(
                            "UPDATE products SET cost = ?1 WHERE id = ?2",
                            params![c, input.product_id],
                        )
                        .map_err(|e| friendly_sql_error("Inventario", e))?;
                    }
                }
                if input.record_expense {
                    let c = unit_cost.unwrap_or(0);
                    let amount = line_total(qty, c)?;
                    if amount <= 0 {
                        return Err(
                            "Para registrar el gasto indica el costo unitario de la compra."
                                .to_string(),
                        );
                    }
                    let date = match &input.expense_date {
                        Some(d) => clean_date(d, "Fecha de la compra")?,
                        None => chrono::Local::now().format("%Y-%m-%d").to_string(),
                    };
                    let method = validate_method(input.method.as_deref().unwrap_or("cash"))?;
                    let supplier = clean_opt(&input.supplier, 120, "Proveedor")?;
                    let category_id: Option<i64> = tx
                        .query_row(
                            "SELECT id FROM categories WHERE kind = 'expense' AND name = 'Compras de inventario'",
                            [],
                            |r| r.get(0),
                        )
                        .optional()
                        .map_err(|e| friendly_sql_error("Inventario", e))?;
                    let now = now_rfc3339();
                    tx.execute(
                        "INSERT INTO expenses (kind, category_id, description, amount, expense_date, method,
                            supplier, note, product_id, movement_id, created_by, created_at, updated_at)
                         VALUES ('inventory', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
                        params![
                            category_id,
                            format!("Compra de inventario: {} × {}", name, qty),
                            amount,
                            date,
                            method,
                            supplier,
                            note,
                            input.product_id,
                            movement_id,
                            user.id,
                            now
                        ],
                    )
                    .map_err(|e| friendly_sql_error("Inventario", e))?;
                }
            }
            "adjustment" => {
                if !input.quantity.is_finite()
                    || input.quantity < 0.0
                    || input.quantity > MAX_QUANTITY
                {
                    return Err(
                        "El conteo físico debe ser un número mayor o igual a cero.".to_string()
                    );
                }
                let target = (input.quantity * 1000.0).round() / 1000.0;
                let delta = target - current;
                if delta.abs() < 0.0005 {
                    return Err(
                        "El conteo coincide con la existencia actual; no hay nada que ajustar."
                            .to_string(),
                    );
                }
                apply_stock_change(
                    &tx,
                    input.product_id,
                    delta,
                    "adjustment",
                    None,
                    None,
                    note.as_deref().or(Some("Ajuste por conteo físico")),
                    user.id,
                )?;
            }
            _ => return Err("Tipo de movimiento de inventario no válido.".to_string()),
        }
        tx.commit()
            .map_err(|e| friendly_sql_error("Inventario", e))?;
        self.get_product(input.product_id)
    }

    pub fn list_inventory_movements(
        &self,
        product_id: Option<i64>,
        limit: Option<i64>,
    ) -> Result<Vec<InventoryMovement>, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let limit = limit.unwrap_or(200).clamp(1, 2000);
        let mut stmt = conn
            .prepare(
                "SELECT m.id, m.product_id, p.name, m.kind, m.quantity, m.unit_cost, m.stock_after,
                        m.reference_type, m.reference_id,
                        CASE WHEN m.reference_type = 'invoice' THEN (SELECT number FROM invoices WHERE id = m.reference_id) END,
                        m.note, m.created_at
                 FROM inventory_movements m JOIN products p ON p.id = m.product_id
                 WHERE (?1 IS NULL OR m.product_id = ?1)
                 ORDER BY m.id DESC LIMIT ?2",
            )
            .map_err(|e| friendly_sql_error("Movimientos", e))?;
        let rows = stmt
            .query_map(params![product_id, limit], |r| {
                Ok(InventoryMovement {
                    id: r.get(0)?,
                    product_id: r.get(1)?,
                    product_name: r.get(2)?,
                    kind: r.get(3)?,
                    quantity: r.get(4)?,
                    unit_cost: r.get(5)?,
                    stock_after: r.get(6)?,
                    reference_type: r.get(7)?,
                    reference_id: r.get(8)?,
                    reference_label: r.get(9)?,
                    note: r.get(10)?,
                    created_at: r.get(11)?,
                })
            })
            .map_err(|e| friendly_sql_error("Movimientos", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| friendly_sql_error("Movimientos", e))?;
        Ok(rows)
    }
}
