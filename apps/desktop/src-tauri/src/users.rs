//! Usuarios y roles.
//!
//! - Cada usuario tiene un rol (`app_users.role_key` → `roles.role_key`).
//! - El rol «Administrador» (`admin`, de sistema) tiene acceso total y no se puede borrar
//!   ni quitarle permisos; solo cambiar su nombre y descripción.
//! - Los demás roles dan acceso por módulo: `read` (ver) o `write` (ver y modificar).
//!   Solo se pueden dar módulos incluidos en la licencia; el acceso real siempre es
//!   licencia ∩ rol.
//! - Solo un administrador puede crear o modificar usuarios y roles. Siempre debe quedar
//!   al menos un administrador activo.

use crate::db::{hash_password_argon2id, LocalDatabase};
use crate::licensing::ALL_MODULES;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const ADMIN_ROLE: &str = "admin";
const ADMIN_ONLY_MSG: &str = "Solo un administrador puede hacer esto.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Read,
    Write,
}

impl Level {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "read" => Some(Level::Read),
            "write" => Some(Level::Write),
            _ => None,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Level::Read => "read",
            Level::Write => "write",
        }
    }
}

/// Permisos efectivos del usuario de la sesión.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserAccess {
    pub is_admin: bool,
    pub modules: BTreeMap<String, Level>,
}

impl UserAccess {
    pub fn from_role(role_key: &str, permissions_json: Option<&str>) -> Self {
        if role_key == ADMIN_ROLE {
            return Self { is_admin: true, modules: BTreeMap::new() };
        }
        Self { is_admin: false, modules: parse_permissions(permissions_json.unwrap_or("{}")) }
    }

    pub fn can_read(&self, module: &str) -> bool {
        self.is_admin || self.modules.contains_key(module)
    }

    pub fn can_write(&self, module: &str) -> bool {
        self.is_admin || self.modules.get(module) == Some(&Level::Write)
    }

    pub fn as_list(&self) -> Vec<String> {
        if self.is_admin {
            return vec!["*".to_string()];
        }
        self.modules.iter().map(|(m, l)| format!("{}:{}", m, l.as_str())).collect()
    }
}

fn parse_permissions(raw: &str) -> BTreeMap<String, Level> {
    let map: BTreeMap<String, String> = serde_json::from_str(raw).unwrap_or_default();
    map.into_iter()
        .filter(|(m, _)| ALL_MODULES.contains(&m.as_str()))
        .filter_map(|(m, l)| Level::parse(&l).map(|l| (m, l)))
        .collect()
}

// ------------------------------------------------------------------ Tipos públicos

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system: bool,
    /// Módulo → "read" | "write". Vacío para el administrador (tiene todo).
    pub permissions: BTreeMap<String, String>,
    pub user_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoleInput {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UserAccount {
    pub id: i64,
    pub username: String,
    pub full_name: String,
    pub role_key: String,
    pub role_name: String,
    pub is_active: bool,
    pub created_at: String,
    pub last_login_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserInput {
    pub id: Option<i64>,
    pub full_name: String,
    pub username: String,
    pub role_key: String,
    /// Obligatoria al crear; al editar, solo si se quiere cambiar.
    pub password: Option<String>,
    #[serde(default = "yes")]
    pub is_active: bool,
}

fn yes() -> bool {
    true
}

fn slugify(name: &str) -> String {
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            c if c.is_ascii_alphanumeric() => c,
            _ => '_',
        })
        .collect();
    let trimmed: String = base.split('_').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("_");
    if trimmed.is_empty() {
        "rol".to_string()
    } else {
        trimmed.chars().take(30).collect()
    }
}

fn validate_password(p: &str) -> Result<(), String> {
    let n = p.chars().count();
    if n < 8 {
        return Err("La contraseña debe tener al menos 8 caracteres.".to_string());
    }
    if n > 128 {
        return Err("La contraseña no puede superar los 128 caracteres.".to_string());
    }
    Ok(())
}

fn validate_username(u: &str) -> Result<String, String> {
    let u = u.trim();
    let n = u.chars().count();
    if !(3..=40).contains(&n) {
        return Err("El nombre de usuario debe tener entre 3 y 40 caracteres.".to_string());
    }
    if !u.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-') {
        return Err("El nombre de usuario solo puede tener letras, números, puntos o guiones (sin espacios ni tildes).".to_string());
    }
    Ok(u.to_string())
}

// ------------------------------------------------------------------ Operaciones

impl LocalDatabase {
    /// Permisos del usuario de la sesión (None si no hay sesión).
    pub fn current_access(&self) -> Result<Option<UserAccess>, String> {
        let user = match self.get_authenticated_user()? {
            Some(u) => u,
            None => return Ok(None),
        };
        if user.is_admin {
            return Ok(Some(UserAccess { is_admin: true, modules: BTreeMap::new() }));
        }
        let mut modules = BTreeMap::new();
        for p in &user.permissions {
            if let Some((m, l)) = p.split_once(':') {
                if let Some(level) = Level::parse(l) {
                    modules.insert(m.to_string(), level);
                }
            }
        }
        Ok(Some(UserAccess { is_admin: false, modules }))
    }

    fn require_admin(&self) -> Result<i64, String> {
        let user = self.require_authenticated_user()?;
        if !user.is_admin {
            return Err(ADMIN_ONLY_MSG.to_string());
        }
        Ok(user.id)
    }

    pub fn list_roles(&self) -> Result<Vec<Role>, String> {
        self.require_authenticated_user()?;
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT r.id, r.role_key, r.name, r.description, r.is_system, r.permissions_json,
                        (SELECT COUNT(*) FROM app_users u WHERE u.role_key = r.role_key)
                 FROM roles r
                 ORDER BY r.is_system DESC, r.name COLLATE NOCASE",
            )
            .map_err(|e| format!("Error consultando roles: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                let key: String = row.get(1)?;
                let raw: String = row.get(5)?;
                let permissions = if key == ADMIN_ROLE {
                    BTreeMap::new()
                } else {
                    parse_permissions(&raw).into_iter().map(|(m, l)| (m, l.as_str().to_string())).collect()
                };
                Ok(Role {
                    id: row.get(0)?,
                    key,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    is_system: row.get::<_, i64>(4)? == 1,
                    permissions,
                    user_count: row.get(6)?,
                })
            })
            .map_err(|e| format!("Error leyendo roles: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Error leyendo roles: {}", e))
    }

    /// Crea o modifica un rol. `allowed_modules` son los módulos de la licencia.
    pub fn save_role(&self, input: &RoleInput, allowed_modules: &BTreeSet<String>) -> Result<Role, String> {
        self.require_admin()?;
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err("El nombre del rol es obligatorio (máximo 40 caracteres).".to_string());
        }
        let description = input.description.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(|d| d.chars().take(160).collect::<String>());

        let mut perms: BTreeMap<String, String> = BTreeMap::new();
        for (module, level) in &input.permissions {
            if level == "none" || level.is_empty() {
                continue;
            }
            if !ALL_MODULES.contains(&module.as_str()) {
                return Err(format!("Módulo desconocido: {}.", module));
            }
            if !allowed_modules.contains(module) {
                return Err(format!("El módulo «{}» no está incluido en tu licencia.", module));
            }
            let lvl = Level::parse(level).ok_or_else(|| format!("Nivel de acceso no válido: {}.", level))?;
            perms.insert(module.clone(), lvl.as_str().to_string());
        }
        let perms_json = serde_json::to_string(&perms).map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();
        let conn = self.connect()?;

        let dup: Option<i64> = conn
            .query_row(
                "SELECT id FROM roles WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2",
                params![name, input.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if dup.is_some() {
            return Err(format!("Ya existe un rol llamado «{}».", name));
        }

        let id = match input.id {
            Some(id) => {
                let (key, is_system): (String, i64) = conn
                    .query_row("SELECT role_key, is_system FROM roles WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
                    .optional()
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| "El rol no existe.".to_string())?;
                if is_system == 1 || key == ADMIN_ROLE {
                    // El administrador conserva acceso total: solo cambian nombre y descripción.
                    conn.execute(
                        "UPDATE roles SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
                        params![name, description, now, id],
                    )
                } else {
                    conn.execute(
                        "UPDATE roles SET name = ?1, description = ?2, permissions_json = ?3, updated_at = ?4 WHERE id = ?5",
                        params![name, description, perms_json, now, id],
                    )
                }
                .map_err(|e| format!("Error guardando el rol: {}", e))?;
                id
            }
            None => {
                let base = slugify(name);
                let mut key = base.clone();
                let mut n = 2;
                while key == ADMIN_ROLE
                    || conn
                        .query_row("SELECT 1 FROM roles WHERE role_key = ?1", params![key], |_| Ok(()))
                        .optional()
                        .map_err(|e| e.to_string())?
                        .is_some()
                {
                    key = format!("{}_{}", base, n);
                    n += 1;
                }
                conn.execute(
                    "INSERT INTO roles (role_key, name, description, is_system, permissions_json, created_at, updated_at)
                     VALUES (?1, ?2, ?3, 0, ?4, ?5, ?5)",
                    params![key, name, description, perms_json, now],
                )
                .map_err(|e| format!("Error creando el rol: {}", e))?;
                conn.last_insert_rowid()
            }
        };
        self.list_roles()?.into_iter().find(|r| r.id == id).ok_or_else(|| "El rol no existe.".to_string())
    }

    /// Borra un rol sin usuarios. El administrador no se puede borrar.
    pub fn delete_role(&self, id: i64) -> Result<(), String> {
        self.require_admin()?;
        let conn = self.connect()?;
        let (key, is_system): (String, i64) = conn
            .query_row("SELECT role_key, is_system FROM roles WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "El rol no existe.".to_string())?;
        if is_system == 1 || key == ADMIN_ROLE {
            return Err("El rol Administrador no se puede eliminar.".to_string());
        }
        let users: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_users WHERE role_key = ?1", params![key], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if users > 0 {
            return Err(format!(
                "Hay {} {} con este rol. Asígnales otro rol antes de eliminarlo.",
                users,
                if users == 1 { "usuario" } else { "usuarios" }
            ));
        }
        conn.execute("DELETE FROM roles WHERE id = ?1", params![id]).map_err(|e| format!("Error eliminando el rol: {}", e))?;
        Ok(())
    }

    pub fn list_users(&self) -> Result<Vec<UserAccount>, String> {
        self.require_admin()?;
        let conn = self.connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT u.id, u.username, u.full_name, u.role_key, COALESCE(r.name, u.role_key), u.is_active,
                        u.created_at, u.last_login_at
                 FROM app_users u LEFT JOIN roles r ON r.role_key = u.role_key
                 ORDER BY u.is_active DESC, u.full_name COLLATE NOCASE",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(UserAccount {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    full_name: row.get(2)?,
                    role_key: row.get(3)?,
                    role_name: row.get(4)?,
                    is_active: row.get::<_, i64>(5)? == 1,
                    created_at: row.get(6)?,
                    last_login_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| format!("Error leyendo usuarios: {}", e))
    }

    /// Crea o modifica un usuario. Nunca deja la instalación sin un administrador activo.
    pub fn save_user(&self, input: &UserInput) -> Result<UserAccount, String> {
        let me = self.require_admin()?;
        let full_name = input.full_name.trim();
        if full_name.is_empty() || full_name.chars().count() > 120 {
            return Err("El nombre es obligatorio (máximo 120 caracteres).".to_string());
        }
        let username = validate_username(&input.username)?;
        let mut conn = self.connect()?;

        let role_exists = conn
            .query_row("SELECT 1 FROM roles WHERE role_key = ?1", params![input.role_key], |_| Ok(()))
            .optional()
            .map_err(|e| e.to_string())?
            .is_some();
        if !role_exists {
            return Err("Elige un rol válido.".to_string());
        }

        let taken: Option<i64> = conn
            .query_row(
                "SELECT id FROM app_users WHERE username = ?1 COLLATE NOCASE AND id IS NOT ?2",
                params![username, input.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if taken.is_some() {
            return Err(format!("El usuario «{}» ya existe.", username));
        }

        let hash = match input.password.as_deref().filter(|p| !p.is_empty()) {
            Some(p) => {
                validate_password(p)?;
                Some(hash_password_argon2id(p)?)
            }
            None if input.id.is_none() => return Err("Escribe una contraseña para el nuevo usuario.".to_string()),
            None => None,
        };

        let now = Utc::now().to_rfc3339();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let id = match input.id {
            Some(id) => {
                if id == me && (input.role_key != ADMIN_ROLE || !input.is_active) {
                    return Err("No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.".to_string());
                }
                let exists = tx
                    .query_row("SELECT 1 FROM app_users WHERE id = ?1", params![id], |_| Ok(()))
                    .optional()
                    .map_err(|e| e.to_string())?
                    .is_some();
                if !exists {
                    return Err("El usuario no existe.".to_string());
                }
                tx.execute(
                    "UPDATE app_users SET full_name = ?1, username = ?2, role_key = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?6",
                    params![full_name, username, input.role_key, input.is_active as i64, now, id],
                )
                .map_err(|e| format!("Error guardando el usuario: {}", e))?;
                if let Some(h) = &hash {
                    tx.execute("UPDATE app_users SET password_hash = ?1 WHERE id = ?2", params![h, id])
                        .map_err(|e| format!("Error guardando la contraseña: {}", e))?;
                }
                id
            }
            None => {
                tx.execute(
                    "INSERT INTO app_users (username, full_name, password_hash, role_key, permissions_json, is_active, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, '[]', ?5, ?6, ?6)",
                    params![username, full_name, hash.unwrap(), input.role_key, input.is_active as i64, now],
                )
                .map_err(|e| format!("Error creando el usuario: {}", e))?;
                tx.last_insert_rowid()
            }
        };
        let admins: i64 = tx
            .query_row("SELECT COUNT(*) FROM app_users WHERE role_key = ?1 AND is_active = 1", params![ADMIN_ROLE], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if admins == 0 {
            // La transacción se descarta al salir sin commit.
            return Err("Debe quedar al menos un administrador activo.".to_string());
        }
        tx.commit().map_err(|e| format!("Error confirmando cambios del usuario: {}", e))?;
        self.list_users()?.into_iter().find(|u| u.id == id).ok_or_else(|| "El usuario no existe.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{CompleteInitialSetupInput, CreateInitialAdminInput, SaveCompanyProfileInput};
    use tempfile::TempDir;

    fn setup() -> (TempDir, LocalDatabase) {
        let dir = TempDir::new().unwrap();
        let mut db = LocalDatabase::open_in_dir(dir.path()).unwrap();
        db.complete_initial_setup(&CompleteInitialSetupInput {
            company: SaveCompanyProfileInput { trade_name: "Tienda".into(), ..Default::default() },
            admin: CreateInitialAdminInput {
                full_name: "Dueño".into(),
                username: "admin".into(),
                password: "ClaveSegura#1".into(),
                password_confirm: "ClaveSegura#1".into(),
            },
        })
        .unwrap();
        (dir, db)
    }

    fn all() -> BTreeSet<String> {
        ALL_MODULES.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn seeded_roles_and_admin_access() {
        let (_d, db) = setup();
        let roles = db.list_roles().unwrap();
        assert_eq!(roles[0].key, "admin");
        assert!(roles.iter().any(|r| r.key == "vendedor" && r.permissions.get("invoices").map(String::as_str) == Some("write")));
        let me = db.get_authenticated_user().unwrap().unwrap();
        assert!(me.is_admin);
        assert_eq!(me.role_name, "Administrador");
        assert_eq!(me.permissions, vec!["*"]);
    }

    #[test]
    fn roles_respect_license_and_cannot_break_admin() {
        let (_d, db) = setup();
        let licensed: BTreeSet<String> = ["invoices", "customers"].iter().map(|s| s.to_string()).collect();
        let mut perms = BTreeMap::new();
        perms.insert("invoices".to_string(), "write".to_string());
        perms.insert("finance".to_string(), "read".to_string());
        let err = db.save_role(&RoleInput { id: None, name: "Cajero".into(), description: None, permissions: perms.clone() }, &licensed).unwrap_err();
        assert!(err.contains("licencia"), "{err}");

        perms.remove("finance");
        perms.insert("customers".to_string(), "none".to_string());
        let cajero = db.save_role(&RoleInput { id: None, name: "Cajero".into(), description: Some("Caja".into()), permissions: perms }, &licensed).unwrap();
        assert_eq!(cajero.key, "cajero");
        assert_eq!(cajero.permissions.len(), 1);
        assert!(db.save_role(&RoleInput { id: None, name: "cajero".into(), ..Default::default() }, &licensed).is_err());

        // Administrador: se puede renombrar, pero no pierde acceso ni se borra.
        let admin_id = db.list_roles().unwrap()[0].id;
        db.save_role(&RoleInput { id: Some(admin_id), name: "Dueño".into(), description: None, permissions: BTreeMap::new() }, &all()).unwrap();
        assert!(db.get_authenticated_user().unwrap().unwrap().is_admin);
        assert!(db.delete_role(admin_id).is_err());
    }

    #[test]
    fn users_crud_and_last_admin_protection() {
        let (_d, mut db) = setup();
        let me = db.get_authenticated_user().unwrap().unwrap().id;
        assert!(db.save_user(&UserInput { id: None, full_name: "Ana".into(), username: "ana".into(), role_key: "vendedor".into(), password: None, is_active: true }).is_err());
        let ana = db
            .save_user(&UserInput { id: None, full_name: "Ana".into(), username: "ana".into(), role_key: "vendedor".into(), password: Some("Vendedora#1".into()), is_active: true })
            .unwrap();
        assert_eq!(ana.role_name, "Vendedor");
        assert!(db.save_user(&UserInput { id: None, full_name: "Otra".into(), username: "ANA".into(), role_key: "vendedor".into(), password: Some("Vendedora#1".into()), is_active: true }).is_err());

        // No puede quitarse a sí mismo el rol ni desactivarse.
        assert!(db.save_user(&UserInput { id: Some(me), full_name: "Dueño".into(), username: "admin".into(), role_key: "vendedor".into(), password: None, is_active: true }).is_err());
        assert!(db.save_user(&UserInput { id: Some(me), full_name: "Dueño".into(), username: "admin".into(), role_key: "admin".into(), password: None, is_active: false }).is_err());

        // Un rol con usuarios no se borra.
        let vend = db.list_roles().unwrap().into_iter().find(|r| r.key == "vendedor").unwrap();
        assert_eq!(vend.user_count, 1);
        assert!(db.delete_role(vend.id).is_err());

        // La vendedora inicia sesión: permisos de su rol y sin acceso de administrador.
        db.logout();
        let s = db.login("ana", "Vendedora#1").unwrap();
        assert!(!s.is_admin);
        assert!(s.permissions.contains(&"invoices:write".to_string()));
        let access = db.current_access().unwrap().unwrap();
        assert!(access.can_write("invoices") && access.can_read("catalog") && !access.can_write("catalog") && !access.can_read("finance"));
        assert!(db.list_users().is_err());
        assert!(db.save_role(&RoleInput { name: "X".into(), ..Default::default() }, &all()).is_err());

        // Usuario desactivado no puede entrar.
        db.logout();
        db.login("admin", "ClaveSegura#1").unwrap();
        db.save_user(&UserInput { id: Some(ana.id), full_name: "Ana".into(), username: "ana".into(), role_key: "vendedor".into(), password: None, is_active: false }).unwrap();
        db.logout();
        assert!(db.login("ana", "Vendedora#1").is_err());
    }

    #[test]
    fn upgrade_from_v4_keeps_admin_and_adds_roles() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("cartucho_erp.sqlite3");
        {
            let mut conn = rusqlite::Connection::open(&file).unwrap();
            conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;").unwrap();
            LocalDatabase::apply_migrations_slice_for_tests(&mut conn, 4).unwrap();
            conn.execute(
                "INSERT INTO app_users (username, full_name, password_hash, role_key, permissions_json, is_active, created_at, updated_at)
                 VALUES ('dueno', 'Dueño', 'hash', 'admin', '[\"*\"]', 1, '2026-11-01', '2026-11-01')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO customers (name, created_at, updated_at) VALUES ('Cliente antiguo', '2026-11-01', '2026-11-01')",
                [],
            )
            .unwrap();
        }
        let db = LocalDatabase::open_in_dir(dir.path()).unwrap();
        // Respaldo verificado antes de migrar v4 → v5.
        let backups: Vec<_> = std::fs::read_dir(db.backups_dir()).unwrap().filter_map(|e| e.ok()).collect();
        assert!(backups.iter().any(|b| b.file_name().to_string_lossy().contains("pre_migration_v4_to_v5")));
        assert!(db.has_admin_user().unwrap());
        let conn = db.connect().unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let roles: i64 = conn.query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0)).unwrap();
        assert_eq!(roles, 3);
        let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
        assert_eq!(integrity, "ok");
    }
}
