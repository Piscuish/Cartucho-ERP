//! Administración de datos locales: ubicación de la base de datos, exportación,
//! restauración, cambio de carpeta y respaldo automático diario.
//!
//! Reglas aplicadas (AGENTS.md §4 y §9):
//! - Toda copia se hace con la API Online Backup de SQLite (compatible con WAL) y se
//!   verifica con `PRAGMA integrity_check` antes de considerarse válida.
//! - Antes de restaurar se crea una copia verificada del estado actual.
//! - Nunca se borra la base anterior al cambiar de carpeta: queda intacta con una nota.
//! - Los respaldos automáticos solo se depuran si el usuario configura explícitamente
//!   cuántos conservar (por defecto se conservan todos).

use crate::db::LocalDatabase;
use chrono::{Local, Utc};
use rusqlite::backup::Backup;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const DATABASE_FILE_NAME: &str = "cartucho_erp.sqlite3";
const LOCATION_POINTER_FILE: &str = "data_location.json";
const AUTO_BACKUP_TAG: &str = "auto_daily";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocationPointer {
    data_dir: String,
    updated_at: String,
}

/// Información de un archivo de respaldo existente.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFileInfo {
    pub file_name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: String,
    pub kind: String,
}

/// Estado de la ubicación de datos y de los respaldos.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocationInfo {
    pub data_dir: String,
    pub database_path: String,
    pub backups_dir: String,
    pub default_data_dir: String,
    pub is_custom_location: bool,
    pub database_size_bytes: u64,
    pub backups_total_bytes: u64,
    pub backups: Vec<BackupFileInfo>,
    pub auto_backup_enabled: bool,
    pub auto_backup_keep: i64,
    pub last_auto_backup_date: Option<String>,
}

/// Resultado de una restauración.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub restored_from: String,
    pub safety_backup_path: String,
    pub schema_version_before: i64,
}

/// Lee el puntero de ubicación personalizada (si existe) y devuelve la carpeta efectiva.
pub fn resolve_effective_data_dir(default_dir: &Path) -> Result<PathBuf, String> {
    let pointer_path = default_dir.join(LOCATION_POINTER_FILE);
    if !pointer_path.exists() {
        return Ok(default_dir.to_path_buf());
    }
    let raw = fs::read_to_string(&pointer_path).map_err(|e| {
        format!(
            "No se pudo leer la configuración de ubicación de datos: {}",
            e
        )
    })?;
    let pointer: LocationPointer = serde_json::from_str(&raw).map_err(|_| {
        "El archivo de configuración de ubicación de datos está dañado.".to_string()
    })?;
    let dir = PathBuf::from(&pointer.data_dir);
    if !dir.is_dir() {
        return Err(format!(
            "No se encuentra la carpeta de datos configurada: {}. Conecta la unidad donde está o vuelve a la ubicación predeterminada.",
            pointer.data_dir
        ));
    }
    Ok(dir)
}

/// Elimina el puntero de ubicación personalizada para volver a la carpeta predeterminada.
/// No borra ninguna base de datos.
pub fn reset_location_pointer(default_dir: &Path) -> Result<(), String> {
    let pointer_path = default_dir.join(LOCATION_POINTER_FILE);
    if pointer_path.exists() {
        // Se conserva una copia del puntero anterior en lugar de borrarlo sin rastro.
        let archived = default_dir.join(format!(
            "data_location.previous_{}.json",
            Utc::now().format("%Y%m%d_%H%M%S")
        ));
        fs::rename(&pointer_path, &archived)
            .map_err(|e| format!("No se pudo restablecer la ubicación predeterminada: {}", e))?;
    }
    Ok(())
}

fn write_location_pointer(default_dir: &Path, data_dir: &Path) -> Result<(), String> {
    let pointer = LocationPointer {
        data_dir: data_dir.to_string_lossy().to_string(),
        updated_at: Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_string_pretty(&pointer)
        .map_err(|e| format!("Error serializando ubicación de datos: {}", e))?;
    let tmp = default_dir.join(format!("{}.tmp", LOCATION_POINTER_FILE));
    fs::write(&tmp, json)
        .map_err(|e| format!("No se pudo guardar la nueva ubicación de datos: {}", e))?;
    let final_path = default_dir.join(LOCATION_POINTER_FILE);
    if final_path.exists() {
        // En Windows `rename` no reemplaza archivos existentes: se archiva el anterior.
        let archived = default_dir.join(format!(
            "data_location.previous_{}.json",
            Utc::now().format("%Y%m%d_%H%M%S_%f")
        ));
        fs::rename(&final_path, archived)
            .map_err(|e| format!("No se pudo actualizar la ubicación de datos: {}", e))?;
    }
    fs::rename(&tmp, &final_path)
        .map_err(|e| format!("No se pudo activar la nueva ubicación de datos: {}", e))?;
    Ok(())
}

/// Copia `src` en `dest_path` con Online Backup y verifica la integridad del resultado.
pub(crate) fn backup_connection_to(src: &Connection, dest_path: &Path) -> Result<(), String> {
    if dest_path.exists() {
        return Err(format!(
            "Ya existe un archivo en {:?}. No se sobrescriben copias existentes.",
            dest_path
        ));
    }
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("No se pudo crear la carpeta de destino {:?}: {}", parent, e))?;
    }
    {
        let mut dst = Connection::open(dest_path).map_err(|e| {
            format!(
                "No se pudo crear el archivo de copia {:?}: {}",
                dest_path, e
            )
        })?;
        let backup = Backup::new(src, &mut dst)
            .map_err(|e| format!("No se pudo iniciar la copia de SQLite: {}", e))?;
        backup
            .run_to_completion(200, Duration::from_millis(5), None)
            .map_err(|e| format!("Error copiando la base de datos: {}", e))?;
    }
    verify_database_file(dest_path).map(|_| ())
}

/// Verifica que un archivo sea una base de datos de Cartucho ERP íntegra.
/// Devuelve la versión de esquema encontrada.
pub fn verify_database_file(path: &Path) -> Result<i64, String> {
    if !path.is_file() {
        return Err(format!("No se encontró el archivo {:?}.", path));
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "El archivo seleccionado no se puede abrir como base de datos.".to_string())?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| {
            "El archivo seleccionado no es una base de datos SQLite válida.".to_string()
        })?;
    if integrity.to_lowercase() != "ok" {
        return Err(format!(
            "La base de datos no superó la verificación de integridad: {}",
            integrity
        ));
    }
    let has_required: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'
             AND name IN ('_schema_migrations', '_app_metadata')",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "No se pudo inspeccionar la estructura del archivo.".to_string())?;
    if has_required < 2 {
        return Err("El archivo no corresponde a una base de datos de Cartucho ERP.".to_string());
    }
    let version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _schema_migrations",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "No se pudo leer la versión del esquema del archivo.".to_string())?;
    Ok(version)
}

fn classify_backup(file_name: &str) -> String {
    if file_name.contains(AUTO_BACKUP_TAG) {
        "auto".to_string()
    } else if file_name.contains("pre_migration") {
        "pre_migration".to_string()
    } else if file_name.contains("pre_restore") {
        "pre_restore".to_string()
    } else if file_name.contains("pre_move") {
        "pre_move".to_string()
    } else {
        "manual".to_string()
    }
}

fn read_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM _app_metadata WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn write_meta(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO _app_metadata (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, Utc::now().to_rfc3339()],
    )
    .map_err(|e| format!("Error guardando configuración '{}': {}", key, e))?;
    Ok(())
}

impl LocalDatabase {
    /// Carpeta predeterminada del sistema operativo (donde vive el puntero de ubicación).
    fn default_data_dir_for_pointer(&self) -> Result<PathBuf, String> {
        Ok(self.pointer_dir.clone())
    }

    pub fn list_backups(&self) -> Result<Vec<BackupFileInfo>, String> {
        let dir = self.backups_dir();
        if !dir.is_dir() {
            return Ok(vec![]);
        }
        let mut list = vec![];
        for entry in fs::read_dir(&dir).map_err(|e| format!("No se pudo leer {:?}: {}", dir, e))? {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if !path.is_file() || !name.ends_with(".sqlite3") {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified_at = meta
                .modified()
                .ok()
                .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                .unwrap_or_default();
            list.push(BackupFileInfo {
                kind: classify_backup(&name),
                file_name: name,
                path: path.to_string_lossy().to_string(),
                size_bytes: meta.len(),
                modified_at,
            });
        }
        list.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
        Ok(list)
    }

    pub fn get_data_location_info(&self) -> Result<DataLocationInfo, String> {
        self.require_authenticated_user()?;
        self.data_location_info_unchecked()
    }

    fn data_location_info_unchecked(&self) -> Result<DataLocationInfo, String> {
        let conn = self.connect()?;
        let default_dir = self.default_data_dir_for_pointer()?;
        let backups = self.list_backups()?;
        let backups_total_bytes = backups.iter().map(|b| b.size_bytes).sum();
        let auto_backup_enabled = read_meta(&conn, "auto_backup_enabled")
            .map(|v| v != "0")
            .unwrap_or(true);
        let auto_backup_keep = read_meta(&conn, "auto_backup_keep")
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        Ok(DataLocationInfo {
            data_dir: self.app_data_dir.to_string_lossy().to_string(),
            database_path: self.db_path.to_string_lossy().to_string(),
            backups_dir: self.backups_dir().to_string_lossy().to_string(),
            default_data_dir: default_dir.to_string_lossy().to_string(),
            is_custom_location: self.app_data_dir != default_dir,
            database_size_bytes: fs::metadata(&self.db_path).map(|m| m.len()).unwrap_or(0),
            backups_total_bytes,
            backups,
            auto_backup_enabled,
            auto_backup_keep,
            last_auto_backup_date: read_meta(&conn, "last_auto_backup_date"),
        })
    }

    /// Guarda la configuración del respaldo automático diario.
    pub fn save_auto_backup_settings(&self, enabled: bool, keep: i64) -> Result<(), String> {
        self.require_authenticated_user()?;
        if !(0..=365).contains(&keep) {
            return Err(
                "La cantidad de respaldos a conservar debe estar entre 0 y 365 (0 = todos)."
                    .to_string(),
            );
        }
        let conn = self.connect()?;
        write_meta(
            &conn,
            "auto_backup_enabled",
            if enabled { "1" } else { "0" },
        )?;
        write_meta(&conn, "auto_backup_keep", &keep.to_string())?;
        Ok(())
    }

    /// Exporta una copia verificada a la carpeta o archivo indicado por el usuario.
    pub fn export_backup(&self, destination: &str) -> Result<String, String> {
        self.require_authenticated_user()?;
        let dest = PathBuf::from(destination.trim());
        if destination.trim().is_empty() {
            return Err("Selecciona una carpeta o archivo de destino.".to_string());
        }
        let target = if dest.is_dir() {
            dest.join(format!(
                "CartuchoERP_respaldo_{}.sqlite3",
                Local::now().format("%Y-%m-%d_%H%M%S")
            ))
        } else {
            let mut p = dest.clone();
            if p.extension().is_none() {
                p.set_extension("sqlite3");
            }
            p
        };
        if paths_equivalent(&target, &self.db_path) {
            return Err("El destino no puede ser la base de datos en uso.".to_string());
        }
        let conn = self.connect()?;
        backup_connection_to(&conn, &target)?;
        Ok(target.to_string_lossy().to_string())
    }

    /// Crea un respaldo manual dentro de la carpeta de respaldos de la aplicación.
    pub fn create_manual_backup(&self) -> Result<String, String> {
        self.require_authenticated_user()?;
        let path = self.create_verified_backup("manual")?;
        Ok(path.to_string_lossy().to_string())
    }

    /// Restaura la base de datos desde un archivo de respaldo.
    /// 1. Valida el archivo. 2. Crea copia de seguridad del estado actual.
    /// 3. Copia el respaldo sobre la base en uso con Online Backup. 4. Aplica migraciones.
    ///
    /// La sesión se cierra porque los usuarios pueden haber cambiado.
    pub fn restore_from_backup(&mut self, source: &str) -> Result<RestoreResult, String> {
        self.require_authenticated_user()?;
        let src_path = PathBuf::from(source.trim());
        if paths_equivalent(&src_path, &self.db_path) {
            return Err("No puedes restaurar la base de datos sobre sí misma.".to_string());
        }
        let version = verify_database_file(&src_path)?;
        let target_version = crate::db::target_schema_version();
        if version > target_version {
            return Err(format!(
                "El respaldo fue creado con una versión más reciente de Cartucho ERP (esquema v{}). Actualiza la aplicación antes de restaurarlo.",
                version
            ));
        }

        let safety = self.create_verified_backup("pre_restore")?;

        {
            let src = Connection::open_with_flags(&src_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| format!("No se pudo abrir el respaldo: {}", e))?;
            let mut dst = self.connect()?;
            let backup = Backup::new(&src, &mut dst)
                .map_err(|e| format!("No se pudo iniciar la restauración: {}", e))?;
            backup
                .run_to_completion(200, Duration::from_millis(5), None)
                .map_err(|e| {
                    format!(
                        "La restauración falló. Tu información anterior está a salvo en {:?}. Detalle: {}",
                        safety, e
                    )
                })?;
        }

        let integrity: String = self
            .connect()?
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| format!("Error verificando la base restaurada: {}", e))?;
        if integrity.to_lowercase() != "ok" {
            return Err(format!(
                "La base restaurada no superó la verificación de integridad ({}). Puedes volver al estado anterior restaurando {:?}.",
                integrity, safety
            ));
        }

        self.initialize_and_migrate()?;
        self.logout();

        Ok(RestoreResult {
            restored_from: src_path.to_string_lossy().to_string(),
            safety_backup_path: safety.to_string_lossy().to_string(),
            schema_version_before: version,
        })
    }

    /// Mueve los datos a una nueva carpeta: copia verificada + puntero de ubicación.
    /// La base anterior se conserva intacta con una nota explicativa.
    pub fn move_data_to(&mut self, new_dir: &str) -> Result<DataLocationInfo, String> {
        self.require_authenticated_user()?;
        self.move_data_to_unchecked(new_dir)
    }

    fn move_data_to_unchecked(&mut self, new_dir: &str) -> Result<DataLocationInfo, String> {
        let new_dir = PathBuf::from(new_dir.trim());
        if new_dir.as_os_str().is_empty() {
            return Err("Selecciona la carpeta de destino.".to_string());
        }
        fs::create_dir_all(&new_dir)
            .map_err(|e| format!("No se pudo usar la carpeta {:?}: {}", new_dir, e))?;
        if paths_equivalent(&new_dir, &self.app_data_dir) {
            return Err(
                "La carpeta seleccionada ya es la ubicación actual de los datos.".to_string(),
            );
        }
        let new_db = new_dir.join(DATABASE_FILE_NAME);
        if new_db.exists() {
            return Err(
                "La carpeta de destino ya contiene una base de datos de Cartucho ERP. Si quieres usarla, elige \"Usar una carpeta existente\".".to_string(),
            );
        }

        // Respaldo de seguridad en la ubicación actual antes de cambiar nada.
        self.create_verified_backup("pre_move")?;

        let conn = self.connect()?;
        backup_connection_to(&conn, &new_db)?;
        drop(conn);

        let old_dir = self.app_data_dir.clone();
        let default_dir = self.default_data_dir_for_pointer()?;
        if paths_equivalent(&new_dir, &default_dir) {
            reset_location_pointer(&default_dir)?;
        } else {
            write_location_pointer(&default_dir, &new_dir)?;
        }

        let note = format!(
            "Los datos de Cartucho ERP se movieron a:\r\n{}\r\n\r\nFecha: {}\r\n\r\nEl archivo {} de esta carpeta ya no se usa. Se conserva como copia; puedes borrarlo manualmente cuando confirmes que todo funciona en la nueva ubicación.\r\n",
            new_dir.to_string_lossy(),
            Local::now().format("%Y-%m-%d %H:%M"),
            DATABASE_FILE_NAME
        );
        let _ = fs::write(old_dir.join("LEEME_DATOS_MOVIDOS.txt"), note);

        self.db_path = new_db;
        self.app_data_dir = new_dir;
        self.initialize_and_migrate()?;
        self.data_location_info_unchecked()
    }

    /// Cambia a una carpeta que ya contiene una base de datos de Cartucho ERP
    /// (por ejemplo, copiada desde otro equipo). Se valida antes de usarla.
    pub fn use_existing_data_dir(&mut self, dir: &str) -> Result<(), String> {
        self.require_authenticated_user()?;
        self.use_existing_data_dir_unchecked(dir)
    }

    fn use_existing_data_dir_unchecked(&mut self, dir: &str) -> Result<(), String> {
        let dir = PathBuf::from(dir.trim());
        let candidate = dir.join(DATABASE_FILE_NAME);
        let version = verify_database_file(&candidate)?;
        if version > crate::db::target_schema_version() {
            return Err(
                "Esa base de datos fue creada con una versión más reciente de Cartucho ERP."
                    .to_string(),
            );
        }
        if paths_equivalent(&dir, &self.app_data_dir) {
            return Err("Esa carpeta ya es la ubicación actual de los datos.".to_string());
        }
        // Respaldo del estado actual antes de cambiar de base.
        self.create_verified_backup("pre_move")?;
        let default_dir = self.default_data_dir_for_pointer()?;
        if paths_equivalent(&dir, &default_dir) {
            reset_location_pointer(&default_dir)?;
        } else {
            write_location_pointer(&default_dir, &dir)?;
        }
        self.db_path = candidate;
        self.app_data_dir = dir;
        self.initialize_and_migrate()?;
        self.logout();
        Ok(())
    }

    /// Primera ejecución (todavía no hay administrador): elegir dónde se guardan los datos.
    /// - `default`: carpeta predeterminada del programa.
    /// - `folder`: una carpeta nueva elegida por el usuario (se crea ahí la base).
    /// - `existing`: una carpeta que ya tiene una base de Cartucho ERP (de otro equipo o copia).
    /// Después de la configuración inicial se cambia en Configuración › Base de datos.
    pub fn setup_data_location(&mut self, mode: &str, dir: Option<&str>) -> Result<DataLocationInfo, String> {
        if self.has_admin_user()? {
            return Err("La ubicación de los datos solo se elige en la primera configuración. Para cambiarla usa Configuración › Base de datos.".to_string());
        }
        let dir = dir.map(str::trim).filter(|d| !d.is_empty());
        match mode {
            "default" => {
                let default_dir = self.default_data_dir_for_pointer()?;
                if !paths_equivalent(&self.app_data_dir, &default_dir) {
                    reset_location_pointer(&default_dir)?;
                    self.db_path = default_dir.join(DATABASE_FILE_NAME);
                    self.app_data_dir = default_dir;
                    self.initialize_and_migrate()?;
                }
            }
            "folder" => {
                let d = dir.ok_or_else(|| "Selecciona la carpeta donde se guardarán los datos.".to_string())?;
                if paths_equivalent(Path::new(d), &self.app_data_dir) {
                    return self.data_location_info_unchecked();
                }
                self.move_data_to_unchecked(d)?;
            }
            "existing" => {
                let d = dir.ok_or_else(|| "Selecciona la carpeta que contiene la base de datos.".to_string())?;
                self.use_existing_data_dir_unchecked(d)?;
            }
            _ => return Err("Opción de ubicación no válida.".to_string()),
        }
        self.data_location_info_unchecked()
    }

    /// Ejecuta el respaldo automático diario si está habilitado y aún no se hizo hoy.
    /// Devuelve la ruta del respaldo creado, si se creó.
    pub fn run_daily_backup_if_due(&self, today: &str) -> Result<Option<String>, String> {
        let conn = self.connect()?;
        let enabled = read_meta(&conn, "auto_backup_enabled")
            .map(|v| v != "0")
            .unwrap_or(true);
        if !enabled {
            return Ok(None);
        }
        let configured: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM company_profile)", [], |r| {
                r.get(0)
            })
            .unwrap_or(false);
        if !configured {
            return Ok(None);
        }
        if read_meta(&conn, "last_auto_backup_date").as_deref() == Some(today) {
            return Ok(None);
        }
        let path = self.create_verified_backup(AUTO_BACKUP_TAG)?;
        write_meta(&conn, "last_auto_backup_date", today)?;

        // Depuración solo si el usuario definió explícitamente cuántos conservar.
        let keep = read_meta(&conn, "auto_backup_keep")
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        if keep > 0 {
            let mut autos: Vec<BackupFileInfo> = self
                .list_backups()?
                .into_iter()
                .filter(|b| b.kind == "auto")
                .collect();
            autos.sort_by(|a, b| b.file_name.cmp(&a.file_name));
            for old in autos.into_iter().skip(keep as usize) {
                let _ = fs::remove_file(&old.path);
            }
        }
        Ok(Some(path.to_string_lossy().to_string()))
    }
}

fn paths_equivalent(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{CompleteInitialSetupInput, CreateInitialAdminInput, SaveCompanyProfileInput};
    use crate::erp::customers::CustomerInput;
    use tempfile::TempDir;

    fn setup(dir: &Path) -> LocalDatabase {
        let mut db = LocalDatabase::open_in_dir(dir).unwrap();
        db.complete_initial_setup(&CompleteInitialSetupInput {
            company: SaveCompanyProfileInput {
                trade_name: "Empresa".to_string(),
                ..Default::default()
            },
            admin: CreateInitialAdminInput {
                full_name: "Admin".to_string(),
                username: "admin".to_string(),
                password: "ClaveSegura#1".to_string(),
                password_confirm: "ClaveSegura#1".to_string(),
            },
            paper_size: None,
        })
        .unwrap();
        db
    }

    fn add_customer(db: &LocalDatabase, name: &str) {
        db.save_customer(&CustomerInput {
            name: name.to_string(),
            ..Default::default()
        })
        .unwrap();
    }

    #[test]
    fn export_creates_verified_copy_and_never_overwrites() {
        let data = TempDir::new().unwrap();
        let out = TempDir::new().unwrap();
        let db = setup(data.path());
        add_customer(&db, "Cliente A");
        let path = db.export_backup(out.path().to_str().unwrap()).unwrap();
        assert_eq!(
            verify_database_file(Path::new(&path)).unwrap(),
            crate::db::target_schema_version()
        );
        let named = out.path().join("copia.sqlite3");
        db.export_backup(named.to_str().unwrap()).unwrap();
        assert!(
            db.export_backup(named.to_str().unwrap()).is_err(),
            "no sobrescribe"
        );
    }

    #[test]
    fn restore_protects_current_state_and_replaces_data() {
        let data = TempDir::new().unwrap();
        let out = TempDir::new().unwrap();
        let mut db = setup(data.path());
        add_customer(&db, "Antes");
        let exported = db.export_backup(out.path().to_str().unwrap()).unwrap();
        add_customer(&db, "Después");
        assert_eq!(db.list_customers(None, true).unwrap().len(), 2);

        // Archivo inválido se rechaza sin tocar nada.
        let junk = out.path().join("basura.sqlite3");
        fs::write(&junk, b"no soy una base").unwrap();
        assert!(db.restore_from_backup(junk.to_str().unwrap()).is_err());
        assert_eq!(db.list_customers(None, true).unwrap().len(), 2);

        let result = db.restore_from_backup(&exported).unwrap();
        assert!(Path::new(&result.safety_backup_path).exists());
        // La sesión se cierra tras restaurar.
        assert!(db.list_customers(None, true).is_err());
        db.login("admin", "ClaveSegura#1").unwrap();
        let names: Vec<String> = db
            .list_customers(None, true)
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(names, vec!["Antes".to_string()]);
        // La copia de seguridad previa contiene el estado que se reemplazó.
        let safety = Connection::open(&result.safety_backup_path).unwrap();
        let n: i64 = safety
            .query_row("SELECT COUNT(*) FROM customers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn move_data_keeps_old_copy_and_reopens_from_pointer() {
        let data = TempDir::new().unwrap();
        let target = TempDir::new().unwrap();
        let new_dir = target.path().join("CartuchoDatos");
        let mut db = setup(data.path());
        add_customer(&db, "Movido");
        let info = db.move_data_to(new_dir.to_str().unwrap()).unwrap();
        assert!(info.is_custom_location);
        assert!(new_dir.join(DATABASE_FILE_NAME).exists());
        assert!(
            data.path().join(DATABASE_FILE_NAME).exists(),
            "la base anterior se conserva"
        );
        assert!(data.path().join("LEEME_DATOS_MOVIDOS.txt").exists());
        add_customer(&db, "Nuevo en destino");

        // El puntero apunta a la nueva carpeta.
        let effective = resolve_effective_data_dir(data.path()).unwrap();
        assert_eq!(
            fs::canonicalize(effective).unwrap(),
            fs::canonicalize(&new_dir).unwrap()
        );
        let mut reopened = LocalDatabase::open_in_dir(&new_dir).unwrap();
        reopened.login("admin", "ClaveSegura#1").unwrap();
        assert_eq!(reopened.list_customers(None, true).unwrap().len(), 2);

        // No se mueve sobre una carpeta que ya tiene base.
        assert!(db.move_data_to(new_dir.to_str().unwrap()).is_err());
        // Volver a la predeterminada elimina el puntero activo (se archiva).
        reset_location_pointer(data.path()).unwrap();
        assert_eq!(
            resolve_effective_data_dir(data.path()).unwrap(),
            data.path().to_path_buf()
        );
    }

    #[test]
    fn use_existing_dir_validates_candidate() {
        let a = TempDir::new().unwrap();
        let b = TempDir::new().unwrap();
        let mut db = setup(a.path());
        assert!(
            db.use_existing_data_dir(b.path().to_str().unwrap())
                .is_err(),
            "carpeta vacía"
        );
        {
            let other = setup(b.path());
            add_customer(&other, "De otro equipo");
        }
        db.use_existing_data_dir(b.path().to_str().unwrap())
            .unwrap();
        db.login("admin", "ClaveSegura#1").unwrap();
        assert_eq!(
            db.list_customers(None, true).unwrap()[0].name,
            "De otro equipo"
        );
    }

    #[test]
    fn setup_data_location_only_before_admin_exists() {
        let data = TempDir::new().unwrap();
        let target = TempDir::new().unwrap();
        let other = TempDir::new().unwrap();
        let chosen = target.path().join("Datos");
        let mut db = LocalDatabase::open_in_dir(data.path()).unwrap();
        // Carpeta nueva elegida en el asistente.
        let info = db.setup_data_location("folder", Some(chosen.to_str().unwrap())).unwrap();
        assert!(info.is_custom_location);
        assert!(chosen.join(DATABASE_FILE_NAME).exists());
        assert_eq!(
            fs::canonicalize(resolve_effective_data_dir(data.path()).unwrap()).unwrap(),
            fs::canonicalize(&chosen).unwrap()
        );
        // Volver a la predeterminada.
        let info = db.setup_data_location("default", None).unwrap();
        assert!(!info.is_custom_location);
        assert_eq!(resolve_effective_data_dir(data.path()).unwrap(), data.path().to_path_buf());
        // Opción inválida y carpeta faltante.
        assert!(db.setup_data_location("nube", None).is_err());
        assert!(db.setup_data_location("folder", Some("  ")).is_err());
        // Base existente de otro equipo: se usa y queda lista para iniciar sesión.
        {
            let o = setup(other.path());
            add_customer(&o, "Cliente previo");
        }
        db.setup_data_location("existing", Some(other.path().to_str().unwrap())).unwrap();
        assert!(db.has_admin_user().unwrap());
        db.login("admin", "ClaveSegura#1").unwrap();
        assert_eq!(db.list_customers(None, true).unwrap()[0].name, "Cliente previo");
        // Con administrador ya no se permite (se usa Configuración).
        assert!(db.setup_data_location("default", None).is_err());
    }

    #[test]
    fn setup_saves_default_paper_size() {
        let data = TempDir::new().unwrap();
        let mut db = LocalDatabase::open_in_dir(data.path()).unwrap();
        let mut input = CompleteInitialSetupInput {
            company: SaveCompanyProfileInput { trade_name: "Panadería".to_string(), ..Default::default() },
            admin: CreateInitialAdminInput {
                full_name: "Admin".to_string(),
                username: "admin".to_string(),
                password: "ClaveSegura#1".to_string(),
                password_confirm: "ClaveSegura#1".to_string(),
            },
            paper_size: Some("tabloide".to_string()),
        };
        assert!(db.complete_initial_setup(&input).is_err(), "tamaño inválido");
        assert!(!db.has_admin_user().unwrap(), "no deja nada a medias");
        input.paper_size = Some("roll80".to_string());
        db.complete_initial_setup(&input).unwrap();
        assert_eq!(db.get_business_settings().unwrap().paper_size, "roll80");
    }

    #[test]
    fn daily_backup_runs_once_per_day_and_respects_retention() {
        let data = TempDir::new().unwrap();
        let db = setup(data.path());
        assert!(db.run_daily_backup_if_due("2026-11-10").unwrap().is_some());
        assert!(db.run_daily_backup_if_due("2026-11-10").unwrap().is_none());
        assert!(db.run_daily_backup_if_due("2026-11-11").unwrap().is_some());
        let autos = db
            .list_backups()
            .unwrap()
            .into_iter()
            .filter(|b| b.kind == "auto")
            .count();
        assert_eq!(autos, 2, "sin política explícita se conservan todos");
        db.save_auto_backup_settings(true, 1).unwrap();
        db.create_manual_backup().unwrap();
        assert!(db.run_daily_backup_if_due("2026-11-12").unwrap().is_some());
        let list = db.list_backups().unwrap();
        assert_eq!(list.iter().filter(|b| b.kind == "auto").count(), 1);
        assert_eq!(
            list.iter().filter(|b| b.kind == "manual").count(),
            1,
            "los manuales nunca se depuran"
        );
        db.save_auto_backup_settings(false, 0).unwrap();
        assert!(db.run_daily_backup_if_due("2026-11-13").unwrap().is_none());
    }

    #[test]
    fn login_lockout_after_repeated_failures() {
        let data = TempDir::new().unwrap();
        let mut db = setup(data.path());
        db.logout();
        for _ in 0..5 {
            assert!(db
                .login("admin", "incorrecta")
                .unwrap_err()
                .starts_with("Credenciales"));
        }
        let err = db.login("admin", "ClaveSegura#1").unwrap_err();
        assert!(err.contains("Demasiados intentos"), "{}", err);
    }
}
