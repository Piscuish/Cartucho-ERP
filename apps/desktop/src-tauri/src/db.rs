use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::Utc;
use directories::ProjectDirs;
use password_hash::rand_core::OsRng;
use password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use rusqlite::backup::Backup;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Registro de una migración aplicada en SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRecord {
    pub version: i64,
    pub name: String,
    pub applied_at: String,
}

/// Registro de prueba de persistencia local en SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceCheckRecord {
    pub id: i64,
    pub note: String,
    pub created_at: String,
}

/// Estado completo de la base de datos SQLite local.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatusReport {
    pub connected: bool,
    pub engine: String,
    pub sqlite_version: String,
    pub journal_mode: String,
    pub foreign_keys_enabled: bool,
    pub database_path: String,
    pub app_data_dir: String,
    pub database_size_bytes: u64,
    pub schema_version: i64,
    pub applied_migrations: Vec<MigrationRecord>,
    pub startup_count: i64,
    pub first_initialized_at: String,
    pub last_opened_at: String,
    pub recent_persistence_checks: Vec<PersistenceCheckRecord>,
}

/// Preferencias persistidas de la aplicación.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    pub theme: String,
    /// Diseño, fondos y color. Se guarda como JSON en `_app_metadata` con la clave `appearance`.
    #[serde(default)]
    pub appearance: Appearance,
    pub updated_at: String,
}

/// Apariencia visual de la instalación (ver `@cartucho/shared` › Appearance).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub layout: String,
    pub bg_light: String,
    pub bg_dark: String,
    pub accent: String,
    #[serde(default)]
    pub tinted_borders: bool,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            layout: "clasico".into(),
            bg_light: "blanco".into(),
            bg_dark: "pizarra".into(),
            accent: "violeta".into(),
            tinted_borders: false,
        }
    }
}

pub const VALID_LAYOUTS: &[&str] = &["clasico", "riel", "flotante", "estudio"];
pub const VALID_LIGHT_BGS: &[&str] = &["blanco", "calido", "hielo"];
pub const VALID_DARK_BGS: &[&str] = &["pizarra", "grafito", "negro", "noche", "morado", "bosque"];
pub const VALID_ACCENTS: &[&str] = &["violeta", "azul", "cian", "verde", "naranja", "rosa", "rojo", "ambar", "mono"];

impl Appearance {
    /// Normaliza a minúsculas y rechaza valores desconocidos.
    pub fn validated(&self) -> Result<Self, String> {
        let check = |v: &str, list: &[&str], what: &str| -> Result<String, String> {
            let n = v.trim().to_lowercase();
            if list.contains(&n.as_str()) {
                Ok(n)
            } else {
                Err(format!("{} desconocido: '{}'.", what, v))
            }
        };
        Ok(Self {
            layout: check(&self.layout, VALID_LAYOUTS, "Diseño")?,
            bg_light: check(&self.bg_light, VALID_LIGHT_BGS, "Fondo claro")?,
            bg_dark: check(&self.bg_dark, VALID_DARK_BGS, "Fondo oscuro")?,
            accent: check(&self.accent, VALID_ACCENTS, "Color de acento")?,
            tinted_borders: self.tinted_borders,
        })
    }

    /// Para valores leídos de la base: cada campo desconocido (por ejemplo, el diseño «neon»,
    /// que se retiró) vuelve a su valor por defecto sin perder los demás.
    pub fn sanitized(&self) -> Self {
        let d = Self::default();
        let pick = |v: &str, list: &[&str], def: &str| -> String {
            let n = v.trim().to_lowercase();
            if list.contains(&n.as_str()) { n } else { def.to_string() }
        };
        Self {
            layout: pick(&self.layout, VALID_LAYOUTS, &d.layout),
            bg_light: pick(&self.bg_light, VALID_LIGHT_BGS, &d.bg_light),
            bg_dark: pick(&self.bg_dark, VALID_DARK_BGS, &d.bg_dark),
            accent: pick(&self.accent, VALID_ACCENTS, &d.accent),
            tinted_borders: self.tinted_borders,
        }
    }

    /// Traduce el estilo único de la versión anterior (`visual_style`).
    fn from_legacy_style(style: &str) -> Self {
        let (bg_light, bg_dark, accent) = match style {
            "oceano" => ("hielo", "noche", "azul"),
            "bosque" => ("calido", "bosque", "verde"),
            "grafito" => ("blanco", "grafito", "mono"),
            "coral" => ("calido", "grafito", "naranja"),
            _ => ("blanco", "pizarra", "violeta"),
        };
        Self {
            bg_light: bg_light.into(),
            bg_dark: bg_dark.into(),
            accent: accent.into(),
            ..Self::default()
        }
    }
}

/// Perfil de la única empresa configurada en la instalación.
/// Separa conceptualmente: tipo de negocio, módulos habilitados, plan comercial y complementos.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompanyProfile {
    pub trade_name: String,
    pub legal_name: Option<String>,
    pub tax_id: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo_data_url: Option<String>,
    pub logo_mime_type: Option<String>,
    pub business_profile_key: String,
    pub commercial_plan_key: String,
    pub enabled_module_keys: Vec<String>,
    pub enabled_addon_keys: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Datos de entrada para crear o actualizar la empresa.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveCompanyProfileInput {
    pub trade_name: String,
    pub legal_name: Option<String>,
    pub tax_id: Option<String>,
    pub address: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub logo_base64: Option<String>,
    pub logo_mime_type: Option<String>,
    #[serde(default)]
    pub remove_logo: bool,
}

/// Datos de entrada para registrar al primer administrador durante la configuración inicial.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CreateInitialAdminInput {
    pub full_name: String,
    pub username: String,
    pub password: String,
    pub password_confirm: String,
}

/// Entrada atómica para completar la configuración inicial (Empresa + Primer Administrador).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompleteInitialSetupInput {
    pub company: SaveCompanyProfileInput,
    pub admin: CreateInitialAdminInput,
}

/// Datos de entrada para iniciar sesión local.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

/// Datos de entrada para cambiar la contraseña del usuario autenticado.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordInput {
    pub current_password: String,
    pub new_password: String,
    pub new_password_confirm: String,
}

/// Resumen seguro del usuario autenticado (jamás incluye `password_hash` ni secretos).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedUserSummary {
    pub id: i64,
    pub full_name: String,
    pub username: String,
    pub role: String,
    /// Nombre visible del rol («Administrador», «Vendedor»…).
    #[serde(default)]
    pub role_name: String,
    #[serde(default)]
    pub is_admin: bool,
    /// `["*"]` para el administrador; si no, `"modulo:read"` o `"modulo:write"`.
    pub permissions: Vec<String>,
    pub created_at: String,
    pub last_login_at: Option<String>,
}

/// Estado general de diagnóstico y configuración del sistema devuelto por la capa nativa Rust.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverview {
    pub app_name: String,
    pub app_version: String,
    pub phase: String,
    pub architecture_mode: String,
    pub os_platform: String,
    pub os_arch: String,
    pub runtime_mode: String,
    pub preferences: AppPreferences,
    pub database: DatabaseStatusReport,
    pub company: Option<CompanyProfile>,
    pub has_admin_user: bool,
    pub is_authenticated: bool,
    pub current_user: Option<AuthenticatedUserSummary>,
    /// Estado de la licencia y módulos habilitados (lo completa la capa de la aplicación).
    #[serde(default)]
    pub license: Option<crate::licensing::LicenseStatus>,
}

/// Resuelve el directorio de datos de aplicación nativo del sistema operativo:
/// - Windows: %LOCALAPPDATA%\cartucho\cartucho-erp\data
/// - Linux:   ~/.local/share/cartucho-erp
/// - macOS:   ~/Library/Application Support/com.cartucho.cartucho-erp
pub fn resolve_os_app_data_dir() -> Result<PathBuf, String> {
    if let Some(proj_dirs) = ProjectDirs::from("com", "cartucho", "cartucho-erp") {
        let data_dir = proj_dirs.data_local_dir().to_path_buf();
        fs::create_dir_all(&data_dir).map_err(|e| {
            format!(
                "No se pudo crear el directorio de datos de aplicación en {:?}: {}",
                data_dir, e
            )
        })?;
        Ok(data_dir)
    } else {
        Err("No fue posible determinar el directorio de datos del sistema operativo.".to_string())
    }
}

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

/// Lista ordenada e inmutable de migraciones de esquema SQLite.
/// IMPORTANTE (AGENTS.md §3.2): Las migraciones publicadas jamás deben modificarse ni renombrarse.
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "0001_init_system_metadata_preferences_and_persistence_checks",
        sql: "
        CREATE TABLE IF NOT EXISTS _app_metadata (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS _persistence_checks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    ",
    },
    Migration {
        version: 2,
        name: "0002_create_company_profile_and_installation_entitlements",
        sql: "
        CREATE TABLE IF NOT EXISTS company_profile (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            trade_name TEXT NOT NULL CHECK (length(trim(trade_name)) > 0),
            legal_name TEXT,
            tax_id TEXT,
            address TEXT,
            phone TEXT,
            email TEXT,
            logo_blob BLOB,
            logo_mime_type TEXT CHECK (
                logo_mime_type IS NULL OR logo_mime_type IN ('image/png', 'image/jpeg', 'image/webp')
            ),
            business_profile_key TEXT NOT NULL DEFAULT 'general',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS installation_entitlements (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            commercial_plan_key TEXT NOT NULL DEFAULT 'local-standard',
            enabled_modules_json TEXT NOT NULL DEFAULT '[]',
            enabled_addons_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
        );
    ",
    },
    Migration {
        version: 3,
        name: "0003_create_app_users_and_permissions",
        sql: "
        CREATE TABLE IF NOT EXISTS app_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(username)) >= 3),
            full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
            password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
            role_key TEXT NOT NULL DEFAULT 'admin' CHECK (length(trim(role_key)) > 0),
            permissions_json TEXT NOT NULL DEFAULT '[\"*\"]',
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_login_at TEXT
        );
    ",
    },
    Migration {
        version: 4,
        name: "0004_create_business_modules_catalog_sales_finance",
        sql: "
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL CHECK (kind IN ('product', 'expense')),
            name TEXT NOT NULL CHECK (length(trim(name)) > 0),
            created_at TEXT NOT NULL,
            UNIQUE (kind, name COLLATE NOCASE)
        );

        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL CHECK (length(trim(name)) > 0),
            document_id TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            notes TEXT,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT COLLATE NOCASE UNIQUE,
            name TEXT NOT NULL CHECK (length(trim(name)) > 0),
            description TEXT,
            category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
            unit TEXT NOT NULL DEFAULT 'und',
            price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
            cost INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
            track_stock INTEGER NOT NULL DEFAULT 1 CHECK (track_stock IN (0, 1)),
            stock_qty REAL NOT NULL DEFAULT 0,
            min_stock REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
            image_blob BLOB,
            image_mime TEXT CHECK (
                image_mime IS NULL OR image_mime IN ('image/png', 'image/jpeg', 'image/webp')
            ),
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_products_name ON products (name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS inventory_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
            kind TEXT NOT NULL CHECK (
                kind IN ('initial', 'purchase', 'adjustment', 'sale', 'void_return')
            ),
            quantity REAL NOT NULL,
            unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
            stock_after REAL NOT NULL,
            reference_type TEXT,
            reference_id INTEGER,
            note TEXT,
            created_by INTEGER REFERENCES app_users (id),
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_movements_product ON inventory_movements (product_id, id);

        CREATE TABLE IF NOT EXISTS document_sequences (
            doc_type TEXT PRIMARY KEY NOT NULL CHECK (doc_type IN ('invoice', 'quote')),
            prefix TEXT NOT NULL,
            next_number INTEGER NOT NULL CHECK (next_number >= 1),
            updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO document_sequences (doc_type, prefix, next_number, updated_at)
            VALUES ('invoice', 'FAC-', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
        INSERT OR IGNORE INTO document_sequences (doc_type, prefix, next_number, updated_at)
            VALUES ('quote', 'COT-', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number TEXT NOT NULL UNIQUE,
            customer_id INTEGER REFERENCES customers (id) ON DELETE RESTRICT,
            customer_name TEXT NOT NULL,
            customer_document TEXT,
            customer_phone TEXT,
            customer_email TEXT,
            customer_address TEXT,
            issue_date TEXT NOT NULL,
            due_date TEXT,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (
                status IN ('pending', 'partial', 'paid', 'void')
            ),
            total INTEGER NOT NULL CHECK (total >= 0),
            paid_amount INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
            notes TEXT,
            terms TEXT,
            footer TEXT,
            quote_id INTEGER REFERENCES quotes (id),
            void_reason TEXT,
            voided_at TEXT,
            created_by INTEGER REFERENCES app_users (id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices (issue_date);
        CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id);
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status);

        CREATE TABLE IF NOT EXISTS invoice_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            product_id INTEGER REFERENCES products (id) ON DELETE SET NULL,
            description TEXT NOT NULL CHECK (length(trim(description)) > 0),
            quantity REAL NOT NULL CHECK (quantity > 0),
            unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
            unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
            line_total INTEGER NOT NULL CHECK (line_total >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id);

        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
            amount INTEGER NOT NULL CHECK (amount > 0),
            method TEXT NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'other')),
            paid_at TEXT NOT NULL,
            note TEXT,
            created_by INTEGER REFERENCES app_users (id),
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id);
        CREATE INDEX IF NOT EXISTS idx_payments_paid_at ON payments (paid_at);

        CREATE TABLE IF NOT EXISTS quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number TEXT NOT NULL UNIQUE,
            customer_id INTEGER REFERENCES customers (id) ON DELETE RESTRICT,
            customer_name TEXT NOT NULL,
            customer_document TEXT,
            customer_phone TEXT,
            customer_email TEXT,
            customer_address TEXT,
            issue_date TEXT NOT NULL,
            valid_until TEXT,
            status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'cancelled')),
            total INTEGER NOT NULL CHECK (total >= 0),
            notes TEXT,
            terms TEXT,
            footer TEXT,
            converted_invoice_id INTEGER REFERENCES invoices (id),
            created_by INTEGER REFERENCES app_users (id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_quotes_issue_date ON quotes (issue_date);

        CREATE TABLE IF NOT EXISTS quote_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote_id INTEGER NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            product_id INTEGER REFERENCES products (id) ON DELETE SET NULL,
            description TEXT NOT NULL CHECK (length(trim(description)) > 0),
            quantity REAL NOT NULL CHECK (quantity > 0),
            unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
            line_total INTEGER NOT NULL CHECK (line_total >= 0)
        );
        CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_lines (quote_id);

        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL DEFAULT 'operating' CHECK (kind IN ('operating', 'inventory')),
            category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
            description TEXT NOT NULL CHECK (length(trim(description)) > 0),
            amount INTEGER NOT NULL CHECK (amount > 0),
            expense_date TEXT NOT NULL,
            method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'transfer', 'card', 'other')),
            supplier TEXT,
            note TEXT,
            product_id INTEGER REFERENCES products (id) ON DELETE SET NULL,
            movement_id INTEGER REFERENCES inventory_movements (id) ON DELETE SET NULL,
            created_by INTEGER REFERENCES app_users (id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses (expense_date);

        INSERT OR IGNORE INTO categories (kind, name, created_at) VALUES
            ('expense', 'Arriendo', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Servicios públicos (luz, agua, gas)', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Internet y teléfono', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Nómina y pagos a personal', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Transporte y envíos', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Mantenimiento y reparaciones', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Publicidad', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Impuestos y trámites', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Compras de inventario', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('expense', 'Otros gastos', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('product', 'General', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));
    ",
    },
    Migration {
        version: 5,
        name: "0005_create_roles",
        // Solo agrega la tabla de roles y sus valores iniciales. Los usuarios existentes
        // conservan `role_key = 'admin'`, que corresponde al rol de sistema «Administrador».
        sql: "
        CREATE TABLE IF NOT EXISTS roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role_key TEXT NOT NULL UNIQUE CHECK (length(trim(role_key)) > 0),
            name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(name)) > 0),
            description TEXT,
            is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
            permissions_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        INSERT OR IGNORE INTO roles (role_key, name, description, is_system, permissions_json, created_at, updated_at) VALUES
            ('admin', 'Administrador', 'Acceso total: usuarios, roles, empresa, licencia y respaldos.', 1, '{\"*\":\"write\"}',
             strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('vendedor', 'Vendedor', 'Factura, cotiza y atiende clientes. Consulta productos e inventario.', 0,
             '{\"invoices\":\"write\",\"quotes\":\"write\",\"customers\":\"write\",\"catalog\":\"read\",\"inventory\":\"read\"}',
             strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            ('consulta', 'Solo consulta', 'Ve facturas, clientes y productos sin modificarlos.', 0,
             '{\"invoices\":\"read\",\"quotes\":\"read\",\"customers\":\"read\",\"catalog\":\"read\",\"inventory\":\"read\"}',
             strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

        CREATE INDEX IF NOT EXISTS idx_app_users_role_key ON app_users (role_key);
    ",
    },
];

/// Versión de esquema más reciente conocida por esta versión de la aplicación.
pub fn target_schema_version() -> i64 {
    MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0)
}

const VALID_THEMES: &[&str] = &["light", "dark", "system"];
const ALLOWED_LOGO_MIMES: &[&str] = &["image/png", "image/jpeg", "image/webp"];
const MAX_LOGO_SIZE_BYTES: usize = 2 * 1024 * 1024; // 2 MB
const MAX_FAILED_LOGINS: u32 = 5;
const LOGIN_LOCKOUT_SECONDS: u64 = 30;
const UNAUTHORIZED_MSG: &str =
    "Acceso no autorizado: debes iniciar sesión con una cuenta válida para realizar esta operación.";

fn normalize_optional_field(
    val: &Option<String>,
    max_len: usize,
    field_label: &str,
) -> Result<Option<String>, String> {
    match val {
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else if trimmed.chars().count() > max_len {
                Err(format!(
                    "El campo '{}' no puede superar los {} caracteres.",
                    field_label, max_len
                ))
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        None => Ok(None),
    }
}

/// Valida que el tipo MIME y la firma mágica de bytes correspondan realmente a PNG, JPEG o WEBP.
fn validate_and_decode_logo(
    base64_str: &str,
    mime_type: &str,
) -> Result<(Vec<u8>, String), String> {
    validate_and_decode_image(base64_str, mime_type, MAX_LOGO_SIZE_BYTES, "El logotipo")
}

/// Decodifica una imagen Base64 validando tipo MIME permitido, tamaño máximo y firma de bytes.
pub(crate) fn validate_and_decode_image(
    base64_str: &str,
    mime_type: &str,
    max_bytes: usize,
    label: &str,
) -> Result<(Vec<u8>, String), String> {
    let normalized_mime = mime_type.trim().to_lowercase();
    if !ALLOWED_LOGO_MIMES.contains(&normalized_mime.as_str()) {
        return Err(
            "Formato de logotipo no permitido. Utiliza únicamente imágenes PNG, JPEG o WEBP."
                .to_string(),
        );
    }

    let clean_b64 = match base64_str.find(",") {
        Some(idx) => &base64_str[idx + 1..],
        None => base64_str.trim(),
    };

    let bytes = BASE64_STANDARD.decode(clean_b64).map_err(|_| {
        "El archivo de imagen seleccionado no tiene una codificación Base64 válida.".to_string()
    })?;

    if bytes.is_empty() {
        return Err(format!("{}: el archivo de imagen está vacío.", label));
    }

    if bytes.len() > max_bytes {
        return Err(format!(
            "{} supera el tamaño máximo permitido de {} KB.",
            label,
            max_bytes / 1024
        ));
    }

    // Comprobación de firma mágica (Magic Bytes) para evitar archivos disfrazados
    let matches_signature = match normalized_mime.as_str() {
        "image/png" => bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n",
        "image/jpeg" => bytes.len() >= 3 && &bytes[0..3] == b"\xFF\xD8\xFF",
        "image/webp" => {
            bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
        _ => false,
    };

    if !matches_signature {
        return Err(
            "El contenido binario del archivo no coincide con el formato de imagen declarado (PNG, JPEG o WEBP)."
                .to_string(),
        );
    }

    Ok((bytes, normalized_mime))
}

struct ValidatedCompanyFields {
    trade_name: String,
    legal_name: Option<String>,
    tax_id: Option<String>,
    address: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    decoded_logo: Option<(Vec<u8>, String)>,
    remove_logo: bool,
}

fn validate_company_input(input: &SaveCompanyProfileInput) -> Result<ValidatedCompanyFields, String> {
    let trade_name = input.trade_name.trim();
    if trade_name.is_empty() {
        return Err("El nombre comercial de la empresa es obligatorio.".to_string());
    }
    if trade_name.chars().count() > 120 {
        return Err("El nombre comercial no puede exceder los 120 caracteres.".to_string());
    }

    let legal_name = normalize_optional_field(&input.legal_name, 160, "Razón social")?;
    let tax_id =
        normalize_optional_field(&input.tax_id, 50, "Identificación tributaria / NIT")?;
    let address = normalize_optional_field(&input.address, 220, "Dirección")?;
    let phone = normalize_optional_field(&input.phone, 40, "Teléfono")?;
    let email = normalize_optional_field(&input.email, 120, "Correo electrónico")?;

    if let Some(ref mail) = email {
        if !mail.contains('@') || mail.starts_with('@') || mail.ends_with('@') {
            return Err(
                "El correo electrónico de la empresa no tiene un formato válido.".to_string(),
            );
        }
    }

    let decoded_logo: Option<(Vec<u8>, String)> =
        match (&input.logo_base64, &input.logo_mime_type) {
            (Some(b64), Some(mime)) if !b64.trim().is_empty() => {
                Some(validate_and_decode_logo(b64, mime)?)
            }
            _ => None,
        };

    Ok(ValidatedCompanyFields {
        trade_name: trade_name.to_string(),
        legal_name,
        tax_id,
        address,
        phone,
        email,
        decoded_logo,
        remove_logo: input.remove_logo,
    })
}

struct ValidatedAdminFields {
    full_name: String,
    username: String,
    password_hash: String,
}

/// Genera un hash seguro de contraseña usando Argon2id (v19) con sal aleatoria criptográfica.
/// Cumple estrictamente AGENTS.md §6.1, §6.2 y §6.3.
pub(crate) fn hash_password_argon2id(plain_password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    let params = Params::default();
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let hash = argon2
        .hash_password(plain_password.as_bytes(), &salt)
        .map_err(|_| "Error interno al generar el hash seguro de la contraseña.".to_string())?;
    Ok(hash.to_string())
}

/// Verifica una contraseña contra un hash Argon2id almacenado sin filtrar detalles internos.
fn verify_password_argon2id(plain_password: &str, stored_hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(stored_hash) {
        Ok(h) => h,
        Err(_) => return false,
    };
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::default());
    argon2
        .verify_password(plain_password.as_bytes(), &parsed_hash)
        .is_ok()
}

fn validate_and_hash_admin_input(
    input: &CreateInitialAdminInput,
) -> Result<ValidatedAdminFields, String> {
    let full_name = input.full_name.trim();
    if full_name.is_empty() {
        return Err("El nombre del administrador es obligatorio.".to_string());
    }
    if full_name.chars().count() > 120 {
        return Err(
            "El nombre del administrador no puede superar los 120 caracteres.".to_string(),
        );
    }

    let username = input.username.trim();
    if username.chars().count() < 3 {
        return Err(
            "El nombre de usuario debe tener al menos 3 caracteres.".to_string(),
        );
    }
    if username.chars().count() > 40 {
        return Err(
            "El nombre de usuario no puede superar los 40 caracteres.".to_string(),
        );
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
    {
        return Err(
            "El nombre de usuario solo puede contener letras, números, puntos, guiones o guiones bajos (sin espacios)."
                .to_string(),
        );
    }

    let password_len = input.password.chars().count();
    if password_len < 8 {
        return Err("La contraseña debe tener al menos 8 caracteres.".to_string());
    }
    if password_len > 128 {
        return Err("La contraseña no puede superar los 128 caracteres.".to_string());
    }
    if input.password != input.password_confirm {
        return Err("La confirmación de la contraseña no coincide.".to_string());
    }

    let password_hash = hash_password_argon2id(&input.password)?;

    Ok(ValidatedAdminFields {
        full_name: full_name.to_string(),
        username: username.to_string(),
        password_hash,
    })
}

fn upsert_company_within_tx(
    tx: &Transaction<'_>,
    fields: &ValidatedCompanyFields,
    now: &str,
) -> Result<(), String> {
    let existing: Option<(Option<Vec<u8>>, Option<String>, String)> = tx
        .query_row(
            "SELECT logo_blob, logo_mime_type, created_at FROM company_profile WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|e| format!("Error consultando perfil de empresa existente: {}", e))?;

    let (final_logo_blob, final_logo_mime, created_at) = match existing {
        Some((prev_blob, prev_mime, prev_created)) => {
            if fields.remove_logo {
                (None, None, prev_created)
            } else if let Some((ref new_bytes, ref new_mime)) = fields.decoded_logo {
                (Some(new_bytes.clone()), Some(new_mime.clone()), prev_created)
            } else {
                (prev_blob, prev_mime, prev_created)
            }
        }
        None => {
            if let Some((ref new_bytes, ref new_mime)) = fields.decoded_logo {
                (
                    Some(new_bytes.clone()),
                    Some(new_mime.clone()),
                    now.to_string(),
                )
            } else {
                (None, None, now.to_string())
            }
        }
    };

    tx.execute(
        "INSERT INTO company_profile (
            id, trade_name, legal_name, tax_id, address, phone, email,
            logo_blob, logo_mime_type, business_profile_key, created_at, updated_at
         )
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'general', ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            trade_name = excluded.trade_name,
            legal_name = excluded.legal_name,
            tax_id = excluded.tax_id,
            address = excluded.address,
            phone = excluded.phone,
            email = excluded.email,
            logo_blob = excluded.logo_blob,
            logo_mime_type = excluded.logo_mime_type,
            updated_at = excluded.updated_at",
        params![
            &fields.trade_name,
            &fields.legal_name,
            &fields.tax_id,
            &fields.address,
            &fields.phone,
            &fields.email,
            final_logo_blob,
            final_logo_mime,
            created_at,
            now
        ],
    )
    .map_err(|e| format!("Error guardando los datos de la empresa en SQLite: {}", e))?;

    tx.execute(
        "INSERT OR IGNORE INTO installation_entitlements (id, commercial_plan_key, enabled_modules_json, enabled_addons_json, updated_at)
         VALUES (1, 'local-standard', '[]', '[]', ?1)",
        params![now],
    )
    .map_err(|e| format!("Error asegurando installation_entitlements: {}", e))?;

    Ok(())
}

/// Gestor centralizado de acceso a la base de datos SQLite local y estado de sesión en memoria.
pub struct LocalDatabase {
    pub(crate) db_path: PathBuf,
    pub(crate) app_data_dir: PathBuf,
    /// Carpeta donde se guarda el puntero de ubicación personalizada de datos.
    /// En la app es la carpeta predeterminada del sistema; en pruebas, una carpeta temporal.
    pub(crate) pointer_dir: PathBuf,
    /// Identificador del usuario autenticado en la sesión actual (en memoria del proceso).
    /// Se reinicia automáticamente a `None` cuando se cierra y vuelve a abrir la aplicación.
    active_user_id: Option<i64>,
    /// Intentos fallidos consecutivos de inicio de sesión (solo en memoria).
    failed_login_attempts: u32,
    /// Bloqueo temporal tras demasiados intentos fallidos (solo en memoria).
    login_locked_until: Option<std::time::Instant>,
    /// Módulos opcionales activos según la licencia.
    pub(crate) features: crate::erp::Features,
}

impl LocalDatabase {
    /// Inicializa la base de datos en el directorio estándar del sistema operativo.
    pub fn open_in_os_app_data() -> Result<Self, String> {
        let default_dir = resolve_os_app_data_dir()?;
        let effective_dir = crate::data_admin::resolve_effective_data_dir(&default_dir)?;
        let mut db = Self::open_in_dir(effective_dir)?;
        db.pointer_dir = default_dir;
        Ok(db)
    }

    /// Inicializa la base de datos en un directorio específico.
    pub fn open_in_dir<P: AsRef<Path>>(dir: P) -> Result<Self, String> {
        let app_data_dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Error creando directorio de datos {:?}: {}", app_data_dir, e))?;
        let db_path = app_data_dir.join("cartucho_erp.sqlite3");

        let instance = Self {
            db_path,
            pointer_dir: app_data_dir.clone(),
            app_data_dir,
            active_user_id: None,
            failed_login_attempts: 0,
            login_locked_until: None,
            features: crate::erp::Features::default(),
        };
        instance.initialize_and_migrate()?;
        Ok(instance)
    }

    pub fn database_path(&self) -> &Path {
        &self.db_path
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.app_data_dir.join("backups")
    }

    pub(crate) fn connect(&self) -> Result<Connection, String> {
        let conn = Connection::open(&self.db_path)
            .map_err(|e| format!("Error abriendo conexión SQLite en {:?}: {}", self.db_path, e))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
        )
        .map_err(|e| format!("Error configurando PRAGMAs de SQLite: {}", e))?;
        Ok(conn)
    }

    /// Crea una copia de seguridad consistente utilizando la API Online Backup de SQLite
    /// y comprueba que supere `PRAGMA integrity_check` (AGENTS.md §4.1, §4.2, §4.3).
    pub fn create_verified_backup(&self, reason_tag: &str) -> Result<PathBuf, String> {
        let src_conn = self.connect()?;
        let backups_dir = self.backups_dir();
        fs::create_dir_all(&backups_dir).map_err(|e| {
            format!(
                "No se pudo crear el directorio de copias de seguridad {:?}: {}",
                backups_dir, e
            )
        })?;

        let timestamp = Utc::now().format("%Y%m%d_%H%M%S_%f");
        let file_name = format!("cartucho_erp_{}_{}.sqlite3", reason_tag, timestamp);
        let backup_path = backups_dir.join(file_name);

        {
            let mut dst_conn = Connection::open(&backup_path).map_err(|e| {
                format!(
                    "No se pudo abrir archivo de respaldo destino {:?}: {}",
                    backup_path, e
                )
            })?;
            let backup = Backup::new(&src_conn, &mut dst_conn).map_err(|e| {
                format!("No se pudo inicializar el motor de respaldo de SQLite: {}", e)
            })?;
            backup
                .run_to_completion(100, Duration::from_millis(10), None)
                .map_err(|e| format!("Error ejecutando Online Backup de SQLite: {}", e))?;
        }

        // Verificar que la copia pueda abrirse y supere PRAGMA integrity_check
        let verify_conn = Connection::open(&backup_path).map_err(|e| {
            format!(
                "Error reabriendo copia de seguridad para verificación: {}",
                e
            )
        })?;
        let integrity: String = verify_conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| {
                format!(
                    "Error ejecutando PRAGMA integrity_check en respaldo: {}",
                    e
                )
            })?;

        if integrity.to_lowercase() != "ok" {
            return Err(format!(
                "La copia de seguridad generada no superó la prueba de integridad: {}",
                integrity
            ));
        }

        Ok(backup_path)
    }

    /// Ejecuta las migraciones pendientes dentro de transacciones atómicas, realizando un respaldo
    /// previo verificado si la base de datos ya tenía una versión anterior (AGENTS.md §3 y §9).
    pub(crate) fn initialize_and_migrate(&self) -> Result<(), String> {
        let mut conn = self.connect()?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Error asegurando tabla _schema_migrations: {}", e))?;

        let current_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Error consultando versión actual de esquema: {}", e))?;

        let target_version = MIGRATIONS.iter().map(|m| m.version).max().unwrap_or(0);

        // Si ya existía una versión previa (> 0) y hay migraciones nuevas pendientes,
        // crear primero una copia de seguridad verificada antes de migrar.
        if current_version > 0 && current_version < target_version {
            let reason = format!("pre_migration_v{}_to_v{}", current_version, target_version);
            self.create_verified_backup(&reason)?;
        }

        Self::apply_migrations_slice(&mut conn, MIGRATIONS)?;

        let now = Utc::now().to_rfc3339();

        // Registrar marca de primera inicialización si no existe
        conn.execute(
            "INSERT OR IGNORE INTO _app_metadata (key, value, updated_at) VALUES ('first_initialized_at', ?1, ?1)",
            params![&now],
        )
        .map_err(|e| format!("Error guardando first_initialized_at: {}", e))?;

        // Inicializar preferencia de tema por defecto ('system') si no existe
        conn.execute(
            "INSERT OR IGNORE INTO _app_metadata (key, value, updated_at) VALUES ('theme_preference', 'system', ?1)",
            params![&now],
        )
        .map_err(|e| format!("Error inicializando theme_preference: {}", e))?;

        // Asegurar fila única en installation_entitlements (con lista de módulos vacía '[]' por defecto)
        conn.execute(
            "INSERT OR IGNORE INTO installation_entitlements (id, commercial_plan_key, enabled_modules_json, enabled_addons_json, updated_at)
             VALUES (1, 'local-standard', '[]', '[]', ?1)",
            params![&now],
        )
        .map_err(|e| format!("Error inicializando installation_entitlements: {}", e))?;

        // Incrementar contador de aperturas (startup_count)
        let current_count: i64 = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'startup_count'",
                [],
                |row| {
                    let val: String = row.get(0)?;
                    Ok(val.parse::<i64>().unwrap_or(0))
                },
            )
            .unwrap_or(0);

        let next_count = current_count + 1;
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at)
             VALUES ('startup_count', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![next_count.to_string(), &now],
        )
        .map_err(|e| format!("Error actualizando startup_count: {}", e))?;

        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at)
             VALUES ('last_opened_at', ?1, ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![&now],
        )
        .map_err(|e| format!("Error actualizando last_opened_at: {}", e))?;

        // Si la tabla técnica de pruebas está vacía, registrar el evento fundacional
        let checks_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _persistence_checks", [], |row| row.get(0))
            .map_err(|e| format!("Error consultando conteo de _persistence_checks: {}", e))?;

        if checks_count == 0 {
            conn.execute(
                "INSERT INTO _persistence_checks (note, created_at) VALUES (?1, ?2)",
                params![
                    "Base de datos SQLite creada e inicializada correctamente (Fase 0)",
                    &now
                ],
            )
            .map_err(|e| format!("Error insertando registro inicial de persistencia: {}", e))?;
        }

        Ok(())
    }

    /// Solo para pruebas: deja una base en una versión anterior del esquema.
    #[cfg(test)]
    pub(crate) fn apply_migrations_slice_for_tests(conn: &mut Connection, up_to_version: i64) -> Result<(), String> {
        let n = MIGRATIONS.iter().take_while(|m| m.version <= up_to_version).count();
        Self::apply_migrations_slice(conn, &MIGRATIONS[..n])
    }

    fn apply_migrations_slice(
        conn: &mut Connection,
        migrations: &[Migration],
    ) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Error creando tabla _schema_migrations: {}", e))?;

        let now = Utc::now().to_rfc3339();

        for migration in migrations {
            let already_applied: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM _schema_migrations WHERE version = ?1)",
                    params![migration.version],
                    |row| row.get(0),
                )
                .map_err(|e| {
                    format!(
                        "Error consultando migración {}: {}",
                        migration.version, e
                    )
                })?;

            if !already_applied {
                let tx = conn.transaction().map_err(|e| {
                    format!(
                        "Error abriendo transacción para migración {}: {}",
                        migration.name, e
                    )
                })?;
                tx.execute_batch(migration.sql).map_err(|e| {
                    format!(
                        "Error ejecutando SQL en migración {}: {}",
                        migration.name, e
                    )
                })?;
                tx.execute(
                    "INSERT INTO _schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
                    params![migration.version, migration.name, &now],
                )
                .map_err(|e| {
                    format!(
                        "Error registrando migración {}: {}",
                        migration.name, e
                    )
                })?;
                tx.commit().map_err(|e| {
                    format!(
                        "Error confirmando transacción de migración {}: {}",
                        migration.name, e
                    )
                })?;
            }
        }

        Ok(())
    }

    /// Indica si ya existe al menos un usuario administrador activo en la base de datos.
    pub fn has_admin_user(&self) -> Result<bool, String> {
        let conn = self.connect()?;
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM app_users WHERE role_key = 'admin' AND is_active = 1)",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Error consultando existencia de administrador: {}", e))?;
        Ok(exists)
    }

    /// Obtiene el resumen seguro del usuario autenticado actualmente en memoria, si existe y está activo.
    pub fn get_authenticated_user(&self) -> Result<Option<AuthenticatedUserSummary>, String> {
        let user_id = match self.active_user_id {
            Some(id) => id,
            None => return Ok(None),
        };

        let conn = self.connect()?;
        self.fetch_user_summary_by_id(&conn, user_id)
    }

    fn fetch_user_summary_by_id(
        &self,
        conn: &Connection,
        user_id: i64,
    ) -> Result<Option<AuthenticatedUserSummary>, String> {
        // Los permisos salen del rol (tabla `roles`); `app_users.permissions_json` queda sin uso.
        conn.query_row(
            "SELECT u.id, u.full_name, u.username, u.role_key, r.name, r.permissions_json,
                    u.created_at, u.last_login_at
             FROM app_users u
             LEFT JOIN roles r ON r.role_key = u.role_key
             WHERE u.id = ?1 AND u.is_active = 1",
            params![user_id],
            |row| {
                let role: String = row.get(3)?;
                let role_name: Option<String> = row.get(4)?;
                let perms_raw: Option<String> = row.get(5)?;
                let access = crate::users::UserAccess::from_role(&role, perms_raw.as_deref());
                Ok(AuthenticatedUserSummary {
                    id: row.get(0)?,
                    full_name: row.get(1)?,
                    username: row.get(2)?,
                    role_name: role_name.unwrap_or_else(|| role.clone()),
                    is_admin: access.is_admin,
                    permissions: access.as_list(),
                    role,
                    created_at: row.get(6)?,
                    last_login_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Error consultando usuario autenticado: {}", e))
    }

    /// Verifica obligatoriamente que exista una sesión autenticada válida en el backend Rust.
    pub fn require_authenticated_user(&self) -> Result<AuthenticatedUserSummary, String> {
        match self.get_authenticated_user()? {
            Some(user) => Ok(user),
            None => Err(UNAUTHORIZED_MSG.to_string()),
        }
    }

    /// Completa de manera ATÓMICA la configuración inicial de la instalación:
    /// registra los datos de la empresa y crea el primer administrador dentro de una sola
    /// transacción SQLite, e inicia sesión automáticamente.
    ///
    /// Reglas de seguridad:
    /// - Si ya existe un administrador registrado, rechaza la operación (impide crear un segundo
    ///   administrador por esta vía).
    /// - Si falla cualquier validación o inserción, toda la transacción se revierte para que
    ///   jamás quede una empresa configurada sin administrador.
    pub fn complete_initial_setup(
        &mut self,
        input: &CompleteInitialSetupInput,
    ) -> Result<AuthenticatedUserSummary, String> {
        // Comprobación previa antes de calcular el hash Argon2id
        if self.has_admin_user()? {
            return Err(
                "Operación denegada: la configuración inicial ya fue completada y ya existe un administrador registrado."
                    .to_string(),
            );
        }

        // Validar datos de empresa y de administrador antes de abrir la transacción de escritura
        let validated_company = validate_company_input(&input.company)?;
        let validated_admin = validate_and_hash_admin_input(&input.admin)?;

        let mut conn = self.connect()?;
        let tx = conn.transaction().map_err(|e| {
            format!(
                "Error iniciando transacción atómica de configuración inicial: {}",
                e
            )
        })?;

        // Comprobación dentro de la transacción para garantizar atomicidad frente a concurrencia
        let admin_already_exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM app_users WHERE role_key = 'admin')",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Error verificando administrador en transacción: {}", e))?;

        if admin_already_exists {
            return Err(
                "Operación denegada: ya existe un administrador registrado en esta instalación."
                    .to_string(),
            );
        }

        let now = Utc::now().to_rfc3339();

        // 1. Guardar perfil de empresa e inicializar installation_entitlements dentro de la transacción
        upsert_company_within_tx(&tx, &validated_company, &now)?;

        // 2. Insertar el primer administrador con su hash Argon2id dentro de la misma transacción
        tx.execute(
            "INSERT INTO app_users (
                username, full_name, password_hash, role_key, permissions_json,
                is_active, created_at, updated_at, last_login_at
             )
             VALUES (?1, ?2, ?3, 'admin', '[\"*\"]', 1, ?4, ?4, ?4)",
            params![
                &validated_admin.username,
                &validated_admin.full_name,
                &validated_admin.password_hash,
                &now
            ],
        )
        .map_err(|e| {
            format!(
                "Error registrando el administrador principal en SQLite: {}",
                e
            )
        })?;

        let admin_id = tx.last_insert_rowid();

        tx.commit().map_err(|e| {
            format!(
                "Error confirmando transacción de configuración inicial: {}",
                e
            )
        })?;

        // Activar sesión en memoria para el administrador recién creado
        self.active_user_id = Some(admin_id);

        self.require_authenticated_user()
    }

    /// Inicia sesión verificando las credenciales con Argon2id sin revelar información sensible.
    pub fn login(
        &mut self,
        username: &str,
        password: &str,
    ) -> Result<AuthenticatedUserSummary, String> {
        let clean_username = username.trim();
        if clean_username.is_empty() || password.is_empty() {
            return Err("Introduce tu nombre de usuario y contraseña.".to_string());
        }

        if let Some(until) = self.login_locked_until {
            let now_instant = std::time::Instant::now();
            if now_instant < until {
                let secs = (until - now_instant).as_secs() + 1;
                return Err(format!(
                    "Demasiados intentos fallidos. Espera {} segundos antes de volver a intentarlo.",
                    secs
                ));
            }
            self.login_locked_until = None;
        }

        let result = self.login_inner(clean_username, password);
        match &result {
            Ok(_) => {
                self.failed_login_attempts = 0;
            }
            Err(msg) if msg.starts_with("Credenciales incorrectas") => {
                self.failed_login_attempts += 1;
                if self.failed_login_attempts >= MAX_FAILED_LOGINS {
                    self.failed_login_attempts = 0;
                    self.login_locked_until = Some(
                        std::time::Instant::now()
                            + Duration::from_secs(LOGIN_LOCKOUT_SECONDS),
                    );
                }
            }
            Err(_) => {}
        }
        result
    }

    fn login_inner(
        &mut self,
        clean_username: &str,
        password: &str,
    ) -> Result<AuthenticatedUserSummary, String> {

        let conn = self.connect()?;
        let row_opt: Option<(i64, String, i64)> = conn
            .query_row(
                "SELECT id, password_hash, is_active
                 FROM app_users
                 WHERE username = ?1 COLLATE NOCASE",
                params![clean_username],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|_| "Error interno al verificar credenciales de acceso.".to_string())?;

        let (user_id, stored_hash, is_active) = match row_opt {
            Some(tuple) => tuple,
            None => {
                return Err(
                    "Credenciales incorrectas. Verifica tu usuario y contraseña.".to_string(),
                )
            }
        };

        if is_active != 1 || !verify_password_argon2id(password, &stored_hash) {
            return Err("Credenciales incorrectas. Verifica tu usuario y contraseña.".to_string());
        }

        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE app_users SET last_login_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![&now, user_id],
        )
        .map_err(|_| "Error actualizando marca de inicio de sesión.".to_string())?;

        self.active_user_id = Some(user_id);

        self.require_authenticated_user()
    }

    /// Cierra la sesión activa en memoria del proceso.
    pub fn logout(&mut self) {
        self.active_user_id = None;
    }

    /// Cambia la contraseña del usuario actualmente autenticado.
    /// OPERACIÓN PROTEGIDA: Requiere sesión autenticada en Rust y verifica primero
    /// `current_password` contra el hash almacenado mediante Argon2id.
    pub fn change_authenticated_user_password(
        &self,
        input: &ChangePasswordInput,
    ) -> Result<(), String> {
        let user = self.require_authenticated_user()?;

        if input.current_password.is_empty() {
            return Err("Debes introducir tu contraseña actual.".to_string());
        }

        let new_len = input.new_password.chars().count();
        if new_len < 8 {
            return Err("La nueva contraseña debe tener al menos 8 caracteres.".to_string());
        }
        if new_len > 128 {
            return Err("La nueva contraseña no puede superar los 128 caracteres.".to_string());
        }
        if input.new_password != input.new_password_confirm {
            return Err("La confirmación de la nueva contraseña no coincide.".to_string());
        }
        if input.new_password == input.current_password {
            return Err(
                "La nueva contraseña debe ser diferente de la contraseña actual.".to_string(),
            );
        }

        let mut conn = self.connect()?;
        let stored_hash: String = conn
            .query_row(
                "SELECT password_hash FROM app_users WHERE id = ?1 AND is_active = 1",
                params![user.id],
                |row| row.get(0),
            )
            .map_err(|_| "No fue posible verificar la cuenta activa.".to_string())?;

        if !verify_password_argon2id(&input.current_password, &stored_hash) {
            return Err("La contraseña actual introducida es incorrecta.".to_string());
        }

        let new_hash = hash_password_argon2id(&input.new_password)?;
        let now = Utc::now().to_rfc3339();

        let tx = conn
            .transaction()
            .map_err(|e| format!("Error iniciando transacción para cambio de contraseña: {}", e))?;

        tx.execute(
            "UPDATE app_users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3",
            params![&new_hash, &now, user.id],
        )
        .map_err(|_| "Error al actualizar la contraseña en la base de datos local.".to_string())?;

        tx.commit()
            .map_err(|_| "Error confirmando actualización de contraseña.".to_string())?;

        Ok(())
    }

    /// Actualiza la información de la única empresa de la instalación (`id = 1`).
    /// OPERACIÓN PROTEGIDA: Requiere sesión autenticada en Rust.
    pub fn save_company_profile(
        &self,
        input: &SaveCompanyProfileInput,
    ) -> Result<CompanyProfile, String> {
        self.require_authenticated_user()?;

        let validated = validate_company_input(input)?;
        let mut conn = self.connect()?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Error iniciando transacción para guardar empresa: {}", e))?;

        let now = Utc::now().to_rfc3339();
        upsert_company_within_tx(&tx, &validated, &now)?;

        tx.commit()
            .map_err(|e| format!("Error confirmando transacción de empresa: {}", e))?;

        self.get_company_profile()?.ok_or_else(|| {
            "Error recuperando el perfil de la empresa recién guardado.".to_string()
        })
    }

    /// Obtiene el perfil de la empresa configurada en la instalación, si existe.
    pub fn get_company_profile(&self) -> Result<Option<CompanyProfile>, String> {
        let conn = self.connect()?;

        let entitlements: (String, String, String) = conn
            .query_row(
                "SELECT commercial_plan_key, enabled_modules_json, enabled_addons_json
                 FROM installation_entitlements WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap_or_else(|_| {
                (
                    "local-standard".to_string(),
                    "[]".to_string(),
                    "[]".to_string(),
                )
            });

        let enabled_module_keys: Vec<String> =
            serde_json::from_str(&entitlements.1).unwrap_or_default();
        let enabled_addon_keys: Vec<String> =
            serde_json::from_str(&entitlements.2).unwrap_or_default();

        let row_opt = conn
            .query_row(
                "SELECT trade_name, legal_name, tax_id, address, phone, email,
                        logo_blob, logo_mime_type, business_profile_key, created_at, updated_at
                 FROM company_profile WHERE id = 1",
                [],
                |row| {
                    let blob: Option<Vec<u8>> = row.get(6)?;
                    let mime: Option<String> = row.get(7)?;
                    let logo_data_url = match (&blob, &mime) {
                        (Some(bytes), Some(m)) if !bytes.is_empty() => Some(format!(
                            "data:{};base64,{}",
                            m,
                            BASE64_STANDARD.encode(bytes)
                        )),
                        _ => None,
                    };

                    Ok(CompanyProfile {
                        trade_name: row.get(0)?,
                        legal_name: row.get(1)?,
                        tax_id: row.get(2)?,
                        address: row.get(3)?,
                        phone: row.get(4)?,
                        email: row.get(5)?,
                        logo_data_url,
                        logo_mime_type: mime,
                        business_profile_key: row.get(8)?,
                        commercial_plan_key: entitlements.0.clone(),
                        enabled_module_keys: enabled_module_keys.clone(),
                        enabled_addon_keys: enabled_addon_keys.clone(),
                        created_at: row.get(9)?,
                        updated_at: row.get(10)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Error leyendo company_profile desde SQLite: {}", e))?;

        Ok(row_opt)
    }

    /// Inserta un nuevo registro en la tabla técnica `_persistence_checks`.
    /// OPERACIÓN PROTEGIDA: Requiere sesión autenticada en Rust.
    pub fn record_persistence_check(&self, note: &str) -> Result<PersistenceCheckRecord, String> {
        self.require_authenticated_user()?;

        let trimmed = note.trim();
        if trimmed.is_empty() {
            return Err(
                "La nota de verificación de persistencia no puede estar vacía.".to_string(),
            );
        }
        if trimmed.len() > 280 {
            return Err(
                "La nota de verificación no puede exceder los 280 caracteres.".to_string(),
            );
        }

        let conn = self.connect()?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO _persistence_checks (note, created_at) VALUES (?1, ?2)",
            params![trimmed, &now],
        )
        .map_err(|e| format!("Error escribiendo registro en SQLite: {}", e))?;

        let id = conn.last_insert_rowid();

        Ok(PersistenceCheckRecord {
            id,
            note: trimmed.to_string(),
            created_at: now,
        })
    }

    /// Guarda la preferencia de tema ('light', 'dark' o 'system') en SQLite.
    /// OPERACIÓN PROTEGIDA: Requiere sesión autenticada en Rust.
    pub fn set_theme_preference(&self, theme: &str) -> Result<AppPreferences, String> {
        self.require_authenticated_user()?;

        let normalized = theme.trim().to_lowercase();
        if !VALID_THEMES.contains(&normalized.as_str()) {
            return Err(format!(
                "Preferencia de tema inválida '{}'. Valores permitidos: light, dark, system.",
                theme
            ));
        }

        let conn = self.connect()?;
        let now = Utc::now().to_rfc3339();

        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at)
             VALUES ('theme_preference', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![&normalized, &now],
        )
        .map_err(|e| format!("Error persistiendo preferencia de tema en SQLite: {}", e))?;

        self.get_preferences()
    }

    /// Guarda la apariencia (diseño, fondos, acento) de la instalación.
    pub fn set_appearance(&self, appearance: &Appearance) -> Result<AppPreferences, String> {
        self.require_authenticated_user()?;
        let valid = appearance.validated()?;
        let json = serde_json::to_string(&valid).map_err(|e| format!("Error serializando la apariencia: {}", e))?;
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at)
             VALUES ('appearance', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![&json, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Error guardando la apariencia en SQLite: {}", e))?;
        self.get_preferences()
    }

    /// Lee la preferencia de tema actual desde SQLite.
    pub fn get_preferences(&self) -> Result<AppPreferences, String> {
        let conn = self.connect()?;
        let read = |key: &str| -> Option<(String, String)> {
            conn.query_row(
                "SELECT value, updated_at FROM _app_metadata WHERE key = ?1",
                params![key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok()
        };
        let theme = read("theme_preference");
        // Apariencia guardada; si no existe se traduce el estilo anterior. Valores inválidos → por defecto.
        let appearance = read("appearance")
            .and_then(|(v, _)| serde_json::from_str::<Appearance>(&v).ok())
            .map(|a| a.sanitized())
            .or_else(|| read("visual_style").map(|(v, _)| Appearance::from_legacy_style(&v)))
            .unwrap_or_default();
        Ok(AppPreferences {
            theme: theme.as_ref().map(|(v, _)| v.clone()).unwrap_or_else(|| "system".to_string()),
            appearance,
            updated_at: theme.map(|(_, u)| u).unwrap_or_else(|| Utc::now().to_rfc3339()),
        })
    }

    /// Genera el informe técnico del estado actual de SQLite.
    pub fn status_report(&self) -> Result<DatabaseStatusReport, String> {
        let conn = self.connect()?;

        let sqlite_version: String = conn
            .query_row("SELECT sqlite_version()", [], |row| row.get(0))
            .map_err(|e| format!("Error consultando sqlite_version(): {}", e))?;

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap_or_else(|_| "wal".to_string());

        let fk_flag: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap_or(1);

        let schema_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(|e| format!("Error consultando versión de esquema: {}", e))?;

        let mut stmt_mig = conn
            .prepare(
                "SELECT version, name, applied_at FROM _schema_migrations ORDER BY version ASC",
            )
            .map_err(|e| format!("Error preparando consulta de migraciones: {}", e))?;

        let applied_migrations = stmt_mig
            .query_map([], |row| {
                Ok(MigrationRecord {
                    version: row.get(0)?,
                    name: row.get(1)?,
                    applied_at: row.get(2)?,
                })
            })
            .map_err(|e| format!("Error leyendo migraciones aplicadas: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Error mapeando migraciones: {}", e))?;

        let startup_count: i64 = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'startup_count'",
                [],
                |row| {
                    let s: String = row.get(0)?;
                    Ok(s.parse::<i64>().unwrap_or(1))
                },
            )
            .unwrap_or(1);

        let first_initialized_at: String = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'first_initialized_at'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| Utc::now().to_rfc3339());

        let last_opened_at: String = conn
            .query_row(
                "SELECT value FROM _app_metadata WHERE key = 'last_opened_at'",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| Utc::now().to_rfc3339());

        let mut stmt_checks = conn
            .prepare(
                "SELECT id, note, created_at FROM _persistence_checks ORDER BY id DESC LIMIT 12",
            )
            .map_err(|e| {
                format!(
                    "Error preparando consulta de pruebas de persistencia: {}",
                    e
                )
            })?;

        let recent_persistence_checks = stmt_checks
            .query_map([], |row| {
                Ok(PersistenceCheckRecord {
                    id: row.get(0)?,
                    note: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })
            .map_err(|e| format!("Error leyendo registros de persistencia: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Error mapeando registros de persistencia: {}", e))?;

        let database_size_bytes = fs::metadata(&self.db_path).map(|m| m.len()).unwrap_or(0);

        Ok(DatabaseStatusReport {
            connected: true,
            engine: "SQLite".to_string(),
            sqlite_version,
            journal_mode,
            foreign_keys_enabled: fk_flag == 1,
            database_path: self.db_path.to_string_lossy().to_string(),
            app_data_dir: self.app_data_dir.to_string_lossy().to_string(),
            database_size_bytes,
            schema_version,
            applied_migrations,
            startup_count,
            first_initialized_at,
            last_opened_at,
            recent_persistence_checks,
        })
    }

    /// Construye el resumen integral del sistema leyendo el estado real desde SQLite.
    /// Si la sesión no está autenticada, oculta los registros internos de operaciones.
    pub fn build_system_overview(&self) -> Result<SystemOverview, String> {
        let mut database = self.status_report()?;
        let preferences = self.get_preferences()?;
        let company = self.get_company_profile()?;
        let has_admin_user = self.has_admin_user()?;
        let current_user = self.get_authenticated_user()?;
        let is_authenticated = current_user.is_some();

        if !is_authenticated {
            database.recent_persistence_checks.clear();
        }

        Ok(SystemOverview {
            app_name: "Cartucho ERP".to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            phase: "Fase 1 — Facturación y gestión local".to_string(),
            architecture_mode: "local-first".to_string(),
            os_platform: std::env::consts::OS.to_string(),
            os_arch: std::env::consts::ARCH.to_string(),
            runtime_mode: "tauri-desktop".to_string(),
            preferences,
            database,
            company,
            has_admin_user,
            is_authenticated,
            current_user,
            license: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // Imagen PNG 1x1 válida en Base64 para pruebas de BLOB
    const SAMPLE_PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    fn sample_setup_input() -> CompleteInitialSetupInput {
        CompleteInitialSetupInput {
            company: SaveCompanyProfileInput {
                trade_name: "Imprenta Central".to_string(),
                legal_name: Some("Imprenta Central S.A.S.".to_string()),
                tax_id: Some("901.234.567-8".to_string()),
                address: Some("Calle 10 #20-30".to_string()),
                phone: Some("+57 300 123 4567".to_string()),
                email: Some("contacto@imprentacentral.local".to_string()),
                logo_base64: Some(SAMPLE_PNG_BASE64.to_string()),
                logo_mime_type: Some("image/png".to_string()),
                remove_logo: false,
            },
            admin: CreateInitialAdminInput {
                full_name: "Carlos Administrador".to_string(),
                username: "carlos_admin".to_string(),
                password: "ClaveSegura#2026".to_string(),
                password_confirm: "ClaveSegura#2026".to_string(),
            },
        }
    }

    #[test]
    fn test_sqlite_creation_write_read_and_reopen_persistence() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let data_path = temp_dir.path().to_path_buf();

        // Sesión 1: Inicialización desde cero (aplica v1, v2 y v3)
        {
            let mut db = LocalDatabase::open_in_dir(&data_path).expect("Debe inicializar SQLite");
            assert!(db.database_path().exists());

            let initial = db.status_report().expect("Debe obtener reporte inicial");
            assert!(initial.connected);
            assert_eq!(initial.engine, "SQLite");
            assert_eq!(initial.journal_mode.to_lowercase(), "wal");
            assert!(initial.foreign_keys_enabled);
            assert_eq!(initial.schema_version, target_schema_version());
            assert_eq!(initial.startup_count, 1);
            assert_eq!(initial.applied_migrations.len() as i64, target_schema_version());
            assert_eq!(initial.recent_persistence_checks.len(), 1);

            // Inicialmente no hay empresa ni administrador configurados ni sesión activa
            assert!(db.get_company_profile().unwrap().is_none());
            assert!(!db.has_admin_user().unwrap());
            assert!(db.get_authenticated_user().unwrap().is_none());

            // Completar configuración inicial atómica (crea empresa + primer admin e inicia sesión)
            let admin = db
                .complete_initial_setup(&sample_setup_input())
                .expect("Debe completar configuración inicial atómica");
            assert_eq!(admin.username, "carlos_admin");
            assert_eq!(admin.role, "admin");

            let inserted = db
                .record_persistence_check("Verificación de escritura en Sesión 1")
                .expect("Debe insertar registro de prueba con sesión autenticada");
            assert_eq!(inserted.note, "Verificación de escritura en Sesión 1");

            let prefs = db
                .set_theme_preference("dark")
                .expect("Debe guardar preferencia de tema con sesión autenticada");
            assert_eq!(prefs.theme, "dark");
            assert_eq!(prefs.appearance, Appearance::default());

            let wanted = Appearance {
                layout: "Riel".into(),
                bg_light: "hielo".into(),
                bg_dark: "negro".into(),
                accent: "azul".into(),
                tinted_borders: true,
            };
            let prefs = db.set_appearance(&wanted).expect("Debe guardar la apariencia");
            assert_eq!(prefs.theme, "dark");
            assert_eq!(prefs.appearance.layout, "riel");
            assert!(prefs.appearance.tinted_borders);
            let bad = Appearance { accent: "fucsia".into(), ..Appearance::default() };
            assert!(db.set_appearance(&bad).is_err());
        }

        // Sesión 2: Reapertura (simula cerrar y volver a abrir la aplicación)
        {
            let mut db_reopened =
                LocalDatabase::open_in_dir(&data_path).expect("Debe reabrir SQLite existente");
            let overview_before_login = db_reopened
                .build_system_overview()
                .expect("Debe generar overview tras reapertura");

            assert_eq!(overview_before_login.database.startup_count, 2);
            assert_eq!(overview_before_login.database.schema_version, target_schema_version());
            assert_eq!(overview_before_login.preferences.theme, "dark");
            assert_eq!(overview_before_login.preferences.appearance.bg_dark, "negro");
            assert!(overview_before_login.has_admin_user);
            // Al reabrir la app, la sesión está cerrada y exige iniciar sesión nuevamente
            assert!(!overview_before_login.is_authenticated);
            assert!(overview_before_login.current_user.is_none());

            // Mientras no inicie sesión, las operaciones protegidas son rechazadas por Rust
            assert!(db_reopened
                .record_persistence_check("Intento sin login")
                .is_err());

            // Al iniciar sesión con las credenciales creadas en la Sesión 1, se recupera el acceso
            let logged = db_reopened
                .login("carlos_admin", "ClaveSegura#2026")
                .expect("Debe autenticar tras reiniciar");
            assert_eq!(logged.full_name, "Carlos Administrador");

            let report = db_reopened.status_report().unwrap();
            assert_eq!(report.recent_persistence_checks.len(), 2);
        }
    }

    #[test]
    fn test_atomic_initial_setup_and_security_controls() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let mut db = LocalDatabase::open_in_dir(temp_dir.path()).expect("Debe inicializar SQLite");

        // 1. Sin sesión autenticada, todas las operaciones protegidas deben fallar en Rust
        assert!(db
            .save_company_profile(&SaveCompanyProfileInput {
                trade_name: "Intento Directo Sin Auth".to_string(),
                ..Default::default()
            })
            .is_err());
        assert!(db.record_persistence_check("Nota sin sesión").is_err());
        assert!(db.set_theme_preference("dark").is_err());

        // 2. Atomicidad: si falla la validación del administrador (ej. contraseñas no coinciden
        //    o contraseña corta), NO debe guardarse la empresa en SQLite
        let mut bad_setup = sample_setup_input();
        bad_setup.admin.password_confirm = "OtraClaveDistinta123".to_string();
        let err_mismatch = db.complete_initial_setup(&bad_setup);
        assert!(err_mismatch.is_err());
        assert!(
            db.get_company_profile().unwrap().is_none(),
            "No debe quedar empresa configurada si falla la creación del administrador"
        );
        assert!(!db.has_admin_user().unwrap());

        // 3. Configuración inicial válida: guarda empresa + admin en una sola transacción
        let admin = db
            .complete_initial_setup(&sample_setup_input())
            .expect("Debe completar configuración inicial");
        assert_eq!(admin.username, "carlos_admin");
        assert!(db.has_admin_user().unwrap());
        assert!(db.get_company_profile().unwrap().is_some());

        // Verificar en SQLite que la contraseña se guardó como hash Argon2id y nunca en texto plano
        let conn = db.connect().unwrap();
        let stored_hash: String = conn
            .query_row(
                "SELECT password_hash FROM app_users WHERE username = 'carlos_admin'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(stored_hash.starts_with("$argon2id$"));
        assert!(!stored_hash.contains("ClaveSegura#2026"));

        // 4. Imposibilidad de crear un segundo administrador mediante configuración inicial
        let mut second_admin_attempt = sample_setup_input();
        second_admin_attempt.admin.username = "segundo_admin".to_string();
        let second_err = db.complete_initial_setup(&second_admin_attempt);
        assert!(
            second_err.is_err(),
            "No debe permitir crear un segundo administrador por configuración inicial"
        );

        // 5. Cierre de sesión (logout) invalida inmediatamente las operaciones protegidas
        db.logout();
        let overview_after_logout = db.build_system_overview().unwrap();
        assert!(!overview_after_logout.is_authenticated);
        assert!(overview_after_logout.current_user.is_none());
        assert!(db
            .save_company_profile(&SaveCompanyProfileInput {
                trade_name: "Cambio tras logout".to_string(),
                ..Default::default()
            })
            .is_err());

        // 6. Inicio de sesión fallido (contraseña o usuario incorrecto) sin revelar hashes
        let bad_pass_err = db.login("carlos_admin", "ClaveIncorrecta999").unwrap_err();
        assert!(!bad_pass_err.contains("$argon2id$"));
        let bad_user_err = db.login("usuario_inexistente", "ClaveSegura#2026").unwrap_err();
        assert_eq!(bad_pass_err, bad_user_err);
    }

    #[test]
    fn test_upgrade_from_v1_and_v2_creates_verified_backup_and_preserves_data() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let data_path = temp_dir.path().to_path_buf();
        let db_file = data_path.join("cartucho_erp.sqlite3");

        // 1. Simular una base de datos creada en Etapa 3 (Esquema v2 con empresa registrada)
        {
            let mut conn = Connection::open(&db_file).expect("Debe crear base v2");
            conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
                .unwrap();
            LocalDatabase::apply_migrations_slice(&mut conn, &MIGRATIONS[0..2])
                .expect("Debe aplicar migraciones v1 y v2");

            let now = "2026-11-10T10:00:00Z";
            conn.execute(
                "INSERT INTO _app_metadata (key, value, updated_at) VALUES ('theme_preference', 'dark', ?1)",
                params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO _app_metadata (key, value, updated_at) VALUES ('startup_count', '5', ?1)",
                params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO _persistence_checks (note, created_at) VALUES ('Dato histórico previo', ?1)",
                params![now],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO company_profile (id, trade_name, business_profile_key, created_at, updated_at)
                 VALUES (1, 'Empresa Etapa 3', 'general', ?1, ?1)",
                params![now],
            )
            .unwrap();
        }

        // 2. Abrir con LocalDatabase actual (Esquema v3): debe crear backup verificado v2->v3 y conservar todo
        let db = LocalDatabase::open_in_dir(&data_path)
            .expect("Debe actualizar desde v2 a v3 limpiamente");

        let backups_dir = db.backups_dir();
        assert!(backups_dir.exists());
        let backup_files: Vec<_> = fs::read_dir(&backups_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(backup_files.len(), 1);

        let report = db.status_report().unwrap();
        let prefs = db.get_preferences().unwrap();
        let company = db.get_company_profile().unwrap().unwrap();
        assert_eq!(report.schema_version, target_schema_version());
        assert_eq!(report.startup_count, 6);
        assert_eq!(prefs.theme, "dark");
        assert_eq!(company.trade_name, "Empresa Etapa 3");
        assert_eq!(
            report.recent_persistence_checks[0].note,
            "Dato histórico previo"
        );
    }

    #[test]
    fn test_company_profile_blob_logo_and_default_empty_modules() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let mut db = LocalDatabase::open_in_dir(temp_dir.path()).expect("Debe inicializar SQLite");

        // Completar configuración inicial para tener sesión autenticada
        db.complete_initial_setup(&sample_setup_input())
            .expect("Debe configurar empresa y admin");

        // Actualizar empresa con logotipo PNG como BLOB
        let saved = db
            .save_company_profile(&SaveCompanyProfileInput {
                trade_name: "Restaurante Jesús".to_string(),
                legal_name: Some("Restaurante Jesús S.A.S.".to_string()),
                tax_id: Some("900.123.456-7".to_string()),
                address: Some("Calle Principal 123".to_string()),
                phone: Some("+57 300 000 0000".to_string()),
                email: Some("contacto@restaurantejesus.local".to_string()),
                logo_base64: Some(SAMPLE_PNG_BASE64.to_string()),
                logo_mime_type: Some("image/png".to_string()),
                remove_logo: false,
            })
            .expect("Debe guardar perfil empresarial con logo BLOB");

        assert_eq!(saved.trade_name, "Restaurante Jesús");
        assert_eq!(saved.logo_mime_type.as_deref(), Some("image/png"));
        assert!(saved
            .logo_data_url
            .as_ref()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        // Verificar que enabled_module_keys inicia vacío ("[]") por defecto
        assert!(saved.enabled_module_keys.is_empty());

        // Rechazar SVG en esta etapa
        let svg_err = db.save_company_profile(&SaveCompanyProfileInput {
            trade_name: "Restaurante Jesús".to_string(),
            logo_base64: Some("PHN2Zz48L3N2Zz4=".to_string()),
            logo_mime_type: Some("image/svg+xml".to_string()),
            ..Default::default()
        });
        assert!(svg_err.is_err());
    }

    #[test]
    fn test_validation_and_migration_rollback_error_handling() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let mut db = LocalDatabase::open_in_dir(temp_dir.path()).expect("Debe inicializar SQLite");

        db.complete_initial_setup(&sample_setup_input())
            .expect("Debe autenticar admin inicial");

        let empty_err = db.record_persistence_check("   ");
        assert!(empty_err.is_err());

        let theme_err = db.set_theme_preference("neon-purple");
        assert!(theme_err.is_err());

        let mut conn = db.connect().expect("Debe conectar");
        let bad_migrations = [Migration {
            version: 99,
            name: "0099_invalid_sql_migration",
            sql: "CREATE TABLE broken_syntax (id INT",
        }];
        let mig_result = LocalDatabase::apply_migrations_slice(&mut conn, &bad_migrations);
        assert!(mig_result.is_err());

        let report = db.status_report().expect("Debe mantener estado íntegro");
        assert_eq!(report.schema_version, target_schema_version());
    }

    #[test]
    fn test_change_password_verifies_current_argon2id_and_updates_hash() {
        let temp_dir = TempDir::new().expect("Debe crear directorio temporal");
        let mut db = LocalDatabase::open_in_dir(temp_dir.path()).expect("Debe inicializar SQLite");

        db.complete_initial_setup(&sample_setup_input())
            .expect("Debe crear admin inicial");

        // 1. Contraseña actual incorrecta debe fallar
        let wrong_current = db.change_authenticated_user_password(&ChangePasswordInput {
            current_password: "ClaveIncorrecta123".to_string(),
            new_password: "NuevaClaveSegura#2027".to_string(),
            new_password_confirm: "NuevaClaveSegura#2027".to_string(),
        });
        assert!(wrong_current.is_err());

        // 2. Confirmación distinta debe fallar
        let mismatch = db.change_authenticated_user_password(&ChangePasswordInput {
            current_password: "ClaveSegura#2026".to_string(),
            new_password: "NuevaClaveSegura#2027".to_string(),
            new_password_confirm: "OtraConfirmacion#2027".to_string(),
        });
        assert!(mismatch.is_err());

        // 3. Cambio válido verifica la actual con Argon2id y actualiza el hash
        db.change_authenticated_user_password(&ChangePasswordInput {
            current_password: "ClaveSegura#2026".to_string(),
            new_password: "NuevaClaveSegura#2027".to_string(),
            new_password_confirm: "NuevaClaveSegura#2027".to_string(),
        })
        .expect("Debe actualizar la contraseña con Argon2id");

        // 4. Al cerrar sesión, la contraseña antigua ya no funciona y la nueva sí autentica
        db.logout();
        assert!(db.login("carlos_admin", "ClaveSegura#2026").is_err());
        let relogged = db
            .login("carlos_admin", "NuevaClaveSegura#2027")
            .expect("Debe autenticar con la nueva contraseña");
        assert_eq!(relogged.username, "carlos_admin");
    }

    #[test]
    fn test_os_app_data_dir_is_outside_repository() {
        let app_data_dir = resolve_os_app_data_dir().expect("Debe resolver AppDataDir del SO");
        let current_dir = std::env::current_dir().expect("Debe obtener directorio actual");
        assert!(
            !app_data_dir.starts_with(&current_dir),
            "La base de datos no debe ubicarse dentro del repositorio del proyecto"
        );
    }
}

#[cfg(test)]
mod appearance_tests {
    use super::*;
    use tempfile::TempDir;

    /// Una instalación con el estilo de la versión anterior conserva sus colores.
    #[test]
    fn legacy_visual_style_is_translated() {
        let dir = TempDir::new().unwrap();
        let db = LocalDatabase::open_in_dir(dir.path()).unwrap();
        let conn = db.connect().unwrap();
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at) VALUES ('visual_style', 'oceano', '2026-11-11T00:00:00Z')",
            [],
        )
        .unwrap();
        let prefs = db.get_preferences().unwrap();
        assert_eq!((prefs.appearance.accent.as_str(), prefs.appearance.bg_dark.as_str()), ("azul", "noche"));

        // Un diseño retirado («neon») vuelve a Clásico y conserva los colores.
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at) VALUES ('appearance', '{\"layout\":\"neon\",\"bgLight\":\"blanco\",\"bgDark\":\"morado\",\"accent\":\"rosa\",\"tintedBorders\":true}', '2026-11-11T00:00:00Z')",
            [],
        )
        .unwrap();
        let a = db.get_preferences().unwrap().appearance;
        assert_eq!((a.layout.as_str(), a.bg_dark.as_str(), a.accent.as_str()), ("clasico", "morado", "rosa"));
        conn.execute("DELETE FROM _app_metadata WHERE key = 'appearance'", []).unwrap();

        // Un JSON dañado vuelve a la apariencia por defecto en lugar de fallar.
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at) VALUES ('appearance', '{roto', '2026-11-11T00:00:00Z')",
            [],
        )
        .unwrap();
        assert_eq!(db.get_preferences().unwrap().appearance.accent, "azul");
    }
}
