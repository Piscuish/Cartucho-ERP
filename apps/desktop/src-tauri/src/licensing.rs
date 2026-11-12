//! Licencias y módulos de Cartucho ERP.
//!
//! - El proveedor (dueño de Cartucho ERP) entrega una **clave de licencia** por cliente.
//! - La aplicación se activa contra el servidor de licencias (Cloudflare) o, sin Internet,
//!   con un **código de activación** que el proveedor genera para el «código de equipo».
//! - El servidor devuelve un **token firmado con Ed25519** que dice qué módulos están
//!   habilitados, cuántos equipos permite la licencia y hasta cuándo es válido sin conexión
//!   (30 días). La aplicación verifica la firma con la clave pública incluida al compilar,
//!   así que el token no se puede alterar.
//! - Si la licencia o el equipo se desactivan, o pasan más de 30 días sin validar, la
//!   aplicación entra en **modo restringido**: solo se pueden ver facturas (y exportar una
//!   copia de los datos). Nunca se borran ni se bloquean los datos del cliente.
//!
//! La licencia se guarda en `license.json` dentro de la carpeta predeterminada de datos de
//! la aplicación (no dentro de la base de datos), porque pertenece al equipo y no a los datos:
//! restaurar o mover la base no cambia la licencia del equipo.

use base64::engine::general_purpose::{STANDARD as B64, URL_SAFE_NO_PAD as B64URL};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Clave pública del proveedor (Base64 de 32 bytes). La genera `license-server/scripts/generate-keys.mjs`.
const EMBEDDED_PUBLIC_KEY: &str = include_str!("../license_public_key.txt");
/// URL del servidor de licencias, por ejemplo `https://licencias.midominio.workers.dev`.
const EMBEDDED_SERVER_URL: &str = include_str!("../license_server_url.txt");

pub const LICENSE_FILE: &str = "license.json";
pub const OFFLINE_GRACE_DAYS: i64 = 30;
const CLOCK_TOLERANCE_SECS: i64 = 36 * 3600;

/// Módulos que se pueden activar o desactivar por licencia.
pub const ALL_MODULES: &[&str] = &["invoices", "quotes", "customers", "catalog", "inventory", "expenses", "finance"];

/// Dependencias: un módulo solo funciona si su módulo base también está activo.
pub fn module_requires(module: &str) -> Option<&'static str> {
    match module {
        "quotes" => Some("invoices"),
        "inventory" => Some("catalog"),
        "finance" => Some("invoices"),
        _ => None,
    }
}

/// Deja solo módulos conocidos y cuyas dependencias estén presentes.
pub fn normalize_modules<I: IntoIterator<Item = String>>(modules: I) -> BTreeSet<String> {
    let mut set: BTreeSet<String> = modules.into_iter().filter(|m| ALL_MODULES.contains(&m.as_str())).collect();
    loop {
        let before = set.len();
        set = set
            .iter()
            .filter(|m| module_requires(m).map(|dep| set.contains(dep)).unwrap_or(true))
            .cloned()
            .collect();
        if set.len() == before {
            return set;
        }
    }
}

// ------------------------------------------------------------------ Token firmado

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicensePayload {
    pub v: u32,
    /// Clave de licencia.
    pub lic: String,
    pub customer: String,
    pub plan: String,
    pub modules: Vec<String>,
    pub max_devices: u32,
    /// Código del equipo al que pertenece este token.
    pub device: String,
    /// `active`, `revoked` (licencia desactivada) o `device_revoked` (equipo desactivado).
    pub status: String,
    /// Emitido (segundos Unix).
    pub iat: i64,
    /// Válido sin conexión hasta (segundos Unix).
    pub exp: i64,
    /// Fecha de vencimiento de la licencia, si tiene.
    #[serde(default)]
    pub lic_exp: Option<i64>,
    /// Texto de contacto de soporte que muestra la aplicación.
    #[serde(default)]
    pub support: Option<String>,
    /// Datos de la empresa registrados con la licencia: el asistente inicial los usa para
    /// llenarse solo. Opcional (tokens anteriores no lo traen).
    #[serde(default)]
    pub company: Option<LicenseCompany>,
    /// Menú personalizado del cliente (ocultar/renombrar opciones y funciones exclusivas).
    #[serde(default)]
    pub ui: Option<LicenseUi>,
}

/// Menú personalizado por cliente. Es solo visual: los permisos los siguen dando los módulos.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseUi {
    #[serde(default)]
    pub hide: Vec<String>,
    #[serde(default)]
    pub labels: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub features: Vec<String>,
}

impl LicenseUi {
    /// Limita tamaños por si un token trae datos inesperados (el token igual va firmado).
    fn sanitized(&self) -> LicenseUi {
        let short = |s: &str, n: usize| s.trim().chars().take(n).collect::<String>();
        LicenseUi {
            hide: self.hide.iter().take(30).map(|s| short(s, 40)).filter(|s| !s.is_empty()).collect(),
            labels: self
                .labels
                .iter()
                .take(30)
                .map(|(k, v)| (short(k, 40), short(v, 30)))
                .filter(|(k, v)| !k.is_empty() && !v.is_empty())
                .collect(),
            features: self.features.iter().take(20).map(|s| short(s, 40)).filter(|s| !s.is_empty()).collect(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseCompany {
    #[serde(default)]
    pub trade_name: Option<String>,
    #[serde(default)]
    pub legal_name: Option<String>,
    #[serde(default)]
    pub tax_id: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub address: Option<String>,
}

/// Verifica la firma de un token `payload.firma` y devuelve su contenido.
pub fn verify_token(token: &str, key: &VerifyingKey) -> Result<LicensePayload, String> {
    let token = token.trim();
    let (payload_b64, sig_b64) = token
        .split_once('.')
        .ok_or_else(|| "El código de activación no tiene un formato válido.".to_string())?;
    let sig_bytes = B64URL
        .decode(sig_b64.trim())
        .map_err(|_| "El código de activación está incompleto o dañado.".to_string())?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "El código de activación está incompleto o dañado.".to_string())?;
    key.verify(payload_b64.as_bytes(), &Signature::from_bytes(&sig_arr))
        .map_err(|_| "El código de activación no es auténtico.".to_string())?;
    let json = B64URL
        .decode(payload_b64)
        .map_err(|_| "El código de activación está dañado.".to_string())?;
    let payload: LicensePayload =
        serde_json::from_slice(&json).map_err(|_| "El código de activación no es compatible con esta versión.".to_string())?;
    if payload.v != 1 {
        return Err("El código de activación es de una versión no compatible.".to_string());
    }
    Ok(payload)
}

pub fn parse_public_key(b64: &str) -> Option<VerifyingKey> {
    let bytes = B64.decode(b64.trim()).ok()?;
    let arr: [u8; 32] = bytes.as_slice().try_into().ok()?;
    VerifyingKey::from_bytes(&arr).ok()
}

// ------------------------------------------------------------------ Estado

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LicenseMode {
    /// Compilación de desarrollo sin clave configurada: todos los módulos.
    Dev,
    Licensed,
    /// Solo lectura de facturas.
    Restricted,
    /// Falta activar.
    Unlicensed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatus {
    pub mode: LicenseMode,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub customer: Option<String>,
    pub plan: Option<String>,
    pub modules: Vec<String>,
    pub max_devices: Option<u32>,
    pub valid_until: Option<String>,
    pub days_left: Option<i64>,
    pub license_expires_at: Option<String>,
    pub last_check_at: Option<String>,
    pub last_check_error: Option<String>,
    pub device_code: String,
    pub server_configured: bool,
    pub license_key_masked: Option<String>,
    pub support: Option<String>,
    /// Empresa registrada con la licencia (para llenar el asistente inicial).
    pub company: Option<LicenseCompany>,
    /// `false` cuando esta copia no tiene licencias configuradas (todo habilitado).
    pub licensing_enabled: bool,
    /// Menú personalizado del cliente.
    pub ui: Option<LicenseUi>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LicenseFile {
    license_key: Option<String>,
    token: Option<String>,
    last_check_at: Option<String>,
    last_check_error: Option<String>,
    #[serde(default)]
    max_seen_unix: i64,
    #[serde(default)]
    fallback_device_seed: Option<String>,
}

/// Permisos efectivos que usa la capa de comandos.
#[derive(Debug, Clone, PartialEq)]
pub struct Entitlements {
    pub mode: LicenseMode,
    pub modules: BTreeSet<String>,
}

impl Entitlements {
    pub fn all() -> Self {
        Self { mode: LicenseMode::Dev, modules: ALL_MODULES.iter().map(|s| s.to_string()).collect() }
    }

    pub fn has(&self, module: &str) -> bool {
        matches!(self.mode, LicenseMode::Dev | LicenseMode::Licensed) && self.modules.contains(module)
    }
}

/// Qué exige cada comando.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    /// Lectura básica: resumen del sistema, iniciar o cerrar sesión.
    Core,
    /// Cambios en empresa, usuario, apariencia, numeración.
    CoreWrite,
    /// Leer datos de un módulo.
    Read(&'static str),
    /// Crear o modificar datos de un módulo.
    Write(&'static str),
    /// Activar o validar la licencia.
    License,
    /// Solo administradores (usuarios, roles, apariencia). La licencia lo trata como Core.
    Admin,
    /// Exportar una copia de los datos (permitido incluso en modo restringido).
    DataExport,
    /// Restaurar, mover carpeta, respaldos automáticos.
    DataAdmin,
}

pub const RESTRICTED_MSG: &str = "Tu licencia no permite esta acción en este momento. Contacta a soporte.";

pub fn check_gate(ent: &Entitlements, gate: Gate) -> Result<(), String> {
    match ent.mode {
        LicenseMode::Dev | LicenseMode::Licensed => match gate {
            Gate::Read(m) | Gate::Write(m) if !ent.modules.contains(m) => {
                Err("Este módulo no está incluido en tu licencia.".to_string())
            }
            _ => Ok(()),
        },
        LicenseMode::Restricted => match gate {
            Gate::Core | Gate::Admin | Gate::License | Gate::DataExport | Gate::Read("invoices") => Ok(()),
            _ => Err(RESTRICTED_MSG.to_string()),
        },
        LicenseMode::Unlicensed => match gate {
            Gate::Core | Gate::Admin | Gate::License => Ok(()),
            _ => Err("Activa tu licencia para usar Cartucho ERP.".to_string()),
        },
    }
}

// ------------------------------------------------------------------ Comunicación con el servidor

pub trait LicenseTransport: Send + Sync {
    fn post(&self, path: &str, body: serde_json::Value) -> Result<serde_json::Value, String>;
}

pub struct HttpTransport {
    base_url: String,
}

impl HttpTransport {
    pub fn new(base_url: &str) -> Self {
        Self { base_url: base_url.to_string() }
    }
}

impl LicenseTransport for HttpTransport {
    fn post(&self, path: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(15)).build();
        match agent.post(&url).send_json(body) {
            Ok(resp) => resp.into_json().map_err(|_| "Respuesta no válida del servidor de licencias.".to_string()),
            Err(ureq::Error::Status(_, resp)) => resp
                .into_json()
                .map_err(|_| "El servidor de licencias respondió con un error.".to_string()),
            Err(_) => Err("No hay conexión con el servidor de licencias. Revisa tu Internet.".to_string()),
        }
    }
}

// ------------------------------------------------------------------ Administrador de licencia

pub struct LicenseManager {
    dir: PathBuf,
    verifying_key: Option<VerifyingKey>,
    transport: Option<Box<dyn LicenseTransport>>,
    dev_bypass: bool,
    device_code: String,
    file: LicenseFile,
}

impl LicenseManager {
    /// Configuración real: clave pública y URL incluidas al compilar, código del equipo real.
    pub fn from_build_config(dir: &Path) -> Self {
        let verifying_key = parse_public_key(EMBEDDED_PUBLIC_KEY);
        let server = EMBEDDED_SERVER_URL.trim().to_string();
        let transport: Option<Box<dyn LicenseTransport>> = if server.starts_with("http") {
            Some(Box::new(HttpTransport { base_url: server }))
        } else {
            None
        };
        // Sin clave pública incluida al compilar, esta copia no usa licencias: todo habilitado
        // (así funciona el instalador mientras el servidor de licencias no esté publicado).
        // Con la clave configurada, CARTUCHO_SIN_LICENCIA=1 lo permite solo en desarrollo.
        let dev_bypass = verifying_key.is_none()
            || (cfg!(debug_assertions) && std::env::var("CARTUCHO_SIN_LICENCIA").map(|v| v == "1").unwrap_or(false));
        let mut file = load_file(dir);
        let device_code = machine_device_code(&mut file);
        let mgr = Self { dir: dir.to_path_buf(), verifying_key, transport, dev_bypass, device_code, file };
        mgr.save();
        mgr
    }

    /// Construcción para pruebas.
    pub fn with_parts(
        dir: &Path,
        verifying_key: Option<VerifyingKey>,
        transport: Option<Box<dyn LicenseTransport>>,
        dev_bypass: bool,
        device_code: &str,
    ) -> Self {
        Self {
            dir: dir.to_path_buf(),
            verifying_key,
            transport,
            dev_bypass,
            device_code: device_code.to_string(),
            file: load_file(dir),
        }
    }

    pub fn device_code(&self) -> &str {
        &self.device_code
    }

    pub fn has_license_key(&self) -> bool {
        self.file.license_key.is_some()
    }

    fn save(&self) {
        let _ = fs::create_dir_all(&self.dir);
        if let Ok(json) = serde_json::to_string_pretty(&self.file) {
            let tmp = self.dir.join(format!("{}.tmp", LICENSE_FILE));
            if fs::write(&tmp, json).is_ok() {
                let target = self.dir.join(LICENSE_FILE);
                let _ = fs::remove_file(&target);
                let _ = fs::rename(&tmp, &target);
            }
        }
    }

    fn base_status(&self) -> LicenseStatus {
        LicenseStatus {
            mode: LicenseMode::Unlicensed,
            reason: None,
            message: None,
            customer: None,
            plan: None,
            modules: vec![],
            max_devices: None,
            valid_until: None,
            days_left: None,
            license_expires_at: None,
            last_check_at: self.file.last_check_at.clone(),
            last_check_error: self.file.last_check_error.clone(),
            device_code: self.device_code.clone(),
            server_configured: self.transport.is_some(),
            license_key_masked: self.file.license_key.as_deref().map(mask_key),
            support: None,
            company: None,
            licensing_enabled: self.verifying_key.is_some() && !self.dev_bypass,
            ui: None,
        }
    }

    /// Evalúa el estado actual. `now` en segundos Unix.
    pub fn status(&mut self, now: i64) -> LicenseStatus {
        let mut st = self.base_status();
        if self.dev_bypass {
            st.mode = LicenseMode::Dev;
            st.modules = ALL_MODULES.iter().map(|s| s.to_string()).collect();
            st.message = Some(if self.verifying_key.is_none() {
                "Esta copia no tiene licencias configuradas: todos los módulos están habilitados.".to_string()
            } else {
                "Modo desarrollo: todos los módulos habilitados.".to_string()
            });
            return st;
        }
        let Some(key) = self.verifying_key else {
            st.reason = Some("not_configured".to_string());
            st.message = Some("Esta copia de Cartucho ERP no tiene configurada la verificación de licencias. Contacta a tu proveedor.".to_string());
            return st;
        };
        let Some(token) = self.file.token.clone() else {
            st.reason = Some("not_activated".to_string());
            st.message = Some("Activa Cartucho ERP con la clave de licencia que te dio tu proveedor.".to_string());
            return st;
        };
        let payload = match verify_token(&token, &key) {
            Ok(p) => p,
            Err(e) => {
                st.reason = Some("invalid".to_string());
                st.message = Some(format!("{} Activa de nuevo la licencia.", e));
                return st;
            }
        };
        if payload.device != self.device_code {
            st.reason = Some("other_device".to_string());
            st.message = Some("Esta licencia se activó en otro equipo. Actívala de nuevo en este equipo.".to_string());
            return st;
        }

        // Datos comunes del token.
        st.customer = Some(payload.customer.clone());
        st.plan = Some(payload.plan.clone());
        st.max_devices = Some(payload.max_devices);
        st.support = payload.support.clone();
        st.company = payload.company.clone();
        st.ui = payload.ui.as_ref().map(LicenseUi::sanitized);
        st.valid_until = chrono::DateTime::from_timestamp(payload.exp, 0).map(|d| d.to_rfc3339());
        st.license_expires_at = payload.lic_exp.and_then(|t| chrono::DateTime::from_timestamp(t, 0)).map(|d| d.to_rfc3339());
        st.days_left = Some(((payload.exp - now) as f64 / 86400.0).ceil().max(0.0) as i64);
        if st.license_key_masked.is_none() {
            st.license_key_masked = Some(mask_key(&payload.lic));
        }

        // Protección básica contra atrasar el reloj para extender el plazo sin conexión.
        if now > self.file.max_seen_unix {
            self.file.max_seen_unix = now;
            self.save();
        }
        let restricted = |st: &mut LicenseStatus, reason: &str, msg: String| {
            st.mode = LicenseMode::Restricted;
            st.reason = Some(reason.to_string());
            st.message = Some(msg);
            st.modules = vec!["invoices".to_string()];
        };
        let support_suffix = payload.support.as_deref().map(|s| format!(" {}", s)).unwrap_or_default();

        if payload.status == "revoked" {
            restricted(&mut st, "revoked", format!("Tu licencia está desactivada. Contacta a soporte.{}", support_suffix));
        } else if payload.status == "device_revoked" {
            restricted(&mut st, "device_revoked", format!("Este equipo fue desactivado. Contacta a soporte.{}", support_suffix));
        } else if payload.lic_exp.map(|t| now > t).unwrap_or(false) {
            restricted(&mut st, "license_expired", format!("Tu licencia venció. Contacta a soporte para renovarla.{}", support_suffix));
        } else if now + CLOCK_TOLERANCE_SECS < self.file.max_seen_unix || now + CLOCK_TOLERANCE_SECS < payload.iat {
            restricted(&mut st, "clock", "La fecha u hora de este equipo parece incorrecta. Corrígela y pulsa «Validar ahora».".to_string());
        } else if now > payload.exp {
            restricted(
                &mut st,
                "offline_expired",
                format!("Han pasado más de {} días sin validar la licencia. Conéctate a Internet y pulsa «Validar ahora».", OFFLINE_GRACE_DAYS),
            );
        } else {
            st.mode = LicenseMode::Licensed;
            st.modules = normalize_modules(payload.modules.clone()).into_iter().collect();
            if st.days_left.unwrap_or(0) <= 5 {
                st.message = Some("Tu licencia necesita validarse pronto. Conéctate a Internet.".to_string());
            }
        }
        st
    }

    pub fn entitlements(&mut self, now: i64) -> Entitlements {
        let st = self.status(now);
        Entitlements { mode: st.mode, modules: st.modules.into_iter().collect() }
    }

    fn accept_token(&mut self, token: &str, license_key: Option<&str>, now: i64) -> Result<LicenseStatus, String> {
        let key = self
            .verifying_key
            .ok_or_else(|| "Esta copia no tiene configurada la verificación de licencias.".to_string())?;
        let payload = verify_token(token, &key)?;
        if payload.device != self.device_code {
            return Err(format!(
                "Ese código de activación es para otro equipo. El código de este equipo es {}.",
                self.device_code
            ));
        }
        self.file.token = Some(token.trim().to_string());
        self.file.license_key = Some(license_key.map(|k| k.to_string()).unwrap_or(payload.lic.clone()));
        self.file.last_check_at = Some(now_rfc3339(now));
        self.file.last_check_error = None;
        self.save();
        Ok(self.status(now))
    }

    /// Activación sin Internet con el código que generó el proveedor.
    pub fn activate_offline(&mut self, token: &str, now: i64) -> Result<LicenseStatus, String> {
        self.accept_token(token, None, now)
    }

    /// Activación en línea con la clave de licencia.
    pub fn activate_online(&mut self, license_key: &str, device_name: &str, app_version: &str, now: i64) -> Result<LicenseStatus, String> {
        let key = normalize_key(license_key)?;
        let transport = self
            .transport
            .as_ref()
            .ok_or_else(|| "Esta copia no tiene configurado el servidor de licencias. Usa la activación sin Internet.".to_string())?;
        let resp = transport.post(
            "/v1/activate",
            serde_json::json!({
                "licenseKey": key,
                "deviceCode": self.device_code,
                "deviceName": device_name,
                "os": std::env::consts::OS,
                "appVersion": app_version,
            }),
        )?;
        let token = server_token(&resp)?;
        self.accept_token(&token, Some(&key), now)
    }

    /// Reporte periódico: renueva el token, aplica cambios de plan o desactivaciones.
    /// Si no hay conexión, conserva el token y anota el error.
    pub fn check_in(&mut self, device_name: &str, app_version: &str, now: i64) -> Result<LicenseStatus, String> {
        let Some(license_key) = self.file.license_key.clone() else {
            return Err("No hay una licencia activada en este equipo.".to_string());
        };
        let Some(transport) = self.transport.as_ref() else {
            return Err("Esta copia no tiene configurado el servidor de licencias.".to_string());
        };
        let result = transport.post(
            "/v1/checkin",
            serde_json::json!({
                "licenseKey": license_key,
                "deviceCode": self.device_code,
                "deviceName": device_name,
                "os": std::env::consts::OS,
                "appVersion": app_version,
            }),
        );
        match result.and_then(|resp| server_token(&resp)) {
            Ok(token) => self.accept_token(&token, Some(&license_key), now),
            Err(e) => {
                self.file.last_check_error = Some(e.clone());
                self.save();
                Err(e)
            }
        }
    }
}

fn server_token(resp: &serde_json::Value) -> Result<String, String> {
    if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        if let Some(t) = resp.get("token").and_then(|v| v.as_str()) {
            return Ok(t.to_string());
        }
    }
    Err(resp
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("El servidor de licencias rechazó la solicitud.")
        .to_string())
}

fn load_file(dir: &Path) -> LicenseFile {
    fs::read_to_string(dir.join(LICENSE_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn now_rfc3339(now: i64) -> String {
    chrono::DateTime::from_timestamp(now, 0).map(|d| d.to_rfc3339()).unwrap_or_default()
}

const CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

fn encode_code(bytes: &[u8]) -> String {
    let chars: Vec<char> = bytes.iter().take(16).map(|b| CODE_ALPHABET[(*b as usize) % 32] as char).collect();
    chars.chunks(4).map(|c| c.iter().collect::<String>()).collect::<Vec<_>>().join("-")
}

/// Código de equipo estable: derivado del identificador de la máquina (en Windows,
/// MachineGuid). Se publica cifrado con SHA-256, nunca el identificador original.
fn machine_device_code(file: &mut LicenseFile) -> String {
    let base = match machine_uid::get() {
        Ok(id) if !id.trim().is_empty() => id,
        _ => file
            .fallback_device_seed
            .get_or_insert_with(|| {
                let mut h = Sha256::new();
                h.update(format!("{:?}{}", std::time::SystemTime::now(), std::process::id()));
                hex(&h.finalize())
            })
            .clone(),
    };
    let mut h = Sha256::new();
    h.update(b"cartucho-erp-device:");
    h.update(base.trim().as_bytes());
    encode_code(&h.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Normaliza una clave escrita por el usuario: mayúsculas, sin espacios, con guiones.
pub fn normalize_key(raw: &str) -> Result<String, String> {
    let cleaned: String = raw.to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let body = cleaned.strip_prefix("CE").unwrap_or(&cleaned);
    if body.len() != 16 || !body.bytes().all(|b| CODE_ALPHABET.contains(&b)) {
        return Err("La clave de licencia no es válida. Debe verse así: CE-XXXX-XXXX-XXXX-XXXX.".to_string());
    }
    let groups: Vec<String> = body.as_bytes().chunks(4).map(|c| String::from_utf8_lossy(c).to_string()).collect();
    Ok(format!("CE-{}", groups.join("-")))
}

fn mask_key(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("CE-••••-••••-••••-{}", tail)
}

/// Nombre del equipo para mostrar en el panel del proveedor.
pub fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| fs::read_to_string("/etc/hostname").ok())
        .map(|s| s.trim().chars().take(60).collect())
        .filter(|s: &String| !s.is_empty())
        .unwrap_or_else(|| "Equipo".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    const DEVICE: &str = "AAAA-BBBB-CCCC-DDDD";
    const KEY: &str = "CE-2345-6789-ABCD-EFGH";
    const DAY: i64 = 86400;

    fn signing() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn sign(payload: &LicensePayload) -> String {
        let p = B64URL.encode(serde_json::to_vec(payload).unwrap());
        let s = signing().sign(p.as_bytes());
        format!("{}.{}", p, B64URL.encode(s.to_bytes()))
    }

    fn payload(now: i64, status: &str, modules: &[&str]) -> LicensePayload {
        LicensePayload {
            v: 1,
            lic: KEY.to_string(),
            customer: "Ferretería Prueba".to_string(),
            plan: "tienda".to_string(),
            modules: modules.iter().map(|s| s.to_string()).collect(),
            max_devices: 2,
            device: DEVICE.to_string(),
            status: status.to_string(),
            iat: now,
            exp: now + 30 * DAY,
            lic_exp: None,
            support: Some("WhatsApp 300 000 0000".to_string()),
            company: Some(LicenseCompany {
                trade_name: Some("Ferretería Prueba".to_string()),
                tax_id: Some("900.123.456-7".to_string()),
                phone: Some("300 000 0000".to_string()),
                ..Default::default()
            }),
            ui: None,
        }
    }

    /// Servidor falso: responde con un token firmado según el estado configurado.
    struct FakeServer {
        status: Arc<Mutex<String>>,
        online: Arc<Mutex<bool>>,
        now: i64,
    }

    impl LicenseTransport for FakeServer {
        fn post(&self, path: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
            if !*self.online.lock().unwrap() {
                return Err("No hay conexión con el servidor de licencias. Revisa tu Internet.".to_string());
            }
            if body["licenseKey"] != KEY {
                return Ok(serde_json::json!({"ok": false, "error": "not_found", "message": "La clave de licencia no existe."}));
            }
            assert!(path == "/v1/activate" || path == "/v1/checkin");
            let mut p = payload(self.now, &self.status.lock().unwrap(), &["invoices", "customers", "catalog", "inventory"]);
            p.device = body["deviceCode"].as_str().unwrap().to_string();
            Ok(serde_json::json!({"ok": true, "token": sign(&p)}))
        }
    }

    fn manager(dir: &Path, server: Option<FakeServer>) -> LicenseManager {
        LicenseManager::with_parts(
            dir,
            Some(signing().verifying_key()),
            server.map(|s| Box::new(s) as Box<dyn LicenseTransport>),
            false,
            DEVICE,
        )
    }

    #[test]
    fn normalizes_modules_and_dependencies() {
        let m = normalize_modules(vec!["inventory".into(), "quotes".into(), "finance".into(), "x".into(), "customers".into()]);
        assert_eq!(m.into_iter().collect::<Vec<_>>(), vec!["customers".to_string()]);
        let m = normalize_modules(vec!["inventory".into(), "catalog".into(), "invoices".into(), "quotes".into()]);
        assert_eq!(m.len(), 4);
    }

    #[test]
    fn key_format_is_validated_and_normalized() {
        assert_eq!(normalize_key("ce 2345 6789 abcd efgh").unwrap(), KEY);
        assert!(normalize_key("CE-0000-1111-2222-3333").is_err(), "0 y 1 no existen en el alfabeto");
        assert!(normalize_key("hola").is_err());
    }

    #[test]
    fn unlicensed_until_activated_and_dev_bypass() {
        let dir = TempDir::new().unwrap();
        let mut m = manager(dir.path(), None);
        assert_eq!(m.status(1_000).mode, LicenseMode::Unlicensed);
        let ent = m.entitlements(1_000);
        assert!(check_gate(&ent, Gate::License).is_ok());
        assert!(check_gate(&ent, Gate::Read("invoices")).is_err());
        let mut dev = LicenseManager::with_parts(dir.path(), None, None, true, DEVICE);
        assert_eq!(dev.status(1_000).mode, LicenseMode::Dev);
        assert!(dev.entitlements(1_000).has("finance"));
    }

    #[test]
    fn token_brings_company_data_and_old_tokens_still_work() {
        let dir = TempDir::new().unwrap();
        let now = 1_800_000_000;
        let mut m = manager(dir.path(), None);
        let st = m.activate_offline(&sign(&payload(now, "active", &["invoices"])), now).unwrap();
        let c = st.company.expect("empresa en el token");
        assert_eq!(c.trade_name.as_deref(), Some("Ferretería Prueba"));
        assert_eq!(c.tax_id.as_deref(), Some("900.123.456-7"));
        assert!(st.licensing_enabled);
        // Un token emitido antes (sin «company») sigue siendo válido.
        let mut old = payload(now, "active", &["invoices"]);
        old.company = None;
        let json = serde_json::to_value(&old).unwrap();
        let mut obj = json.as_object().unwrap().clone();
        obj.remove("company");
        let b64 = B64URL.encode(serde_json::to_vec(&obj).unwrap());
        let sig = signing().sign(b64.as_bytes());
        let token = format!("{}.{}", b64, B64URL.encode(sig.to_bytes()));
        let st = m.activate_offline(&token, now).unwrap();
        assert_eq!(st.mode, LicenseMode::Licensed);
        assert!(st.company.is_none());
        assert!(st.ui.is_none());
    }

    #[test]
    fn token_brings_custom_menu() {
        let dir = TempDir::new().unwrap();
        let now = 1_800_000_000;
        let mut m = manager(dir.path(), None);
        let mut p = payload(now, "active", &["invoices", "quotes"]);
        let mut labels = std::collections::BTreeMap::new();
        labels.insert("quotes".to_string(), "Pedidos".to_string());
        labels.insert("invoices".to_string(), "x".repeat(80));
        p.ui = Some(LicenseUi { hide: vec!["cash-close".to_string()], labels, features: vec!["pedidos-domicilio".to_string()] });
        let st = m.activate_offline(&sign(&p), now).unwrap();
        let ui = st.ui.expect("menú en el token");
        assert_eq!(ui.hide, vec!["cash-close"]);
        assert_eq!(ui.labels.get("quotes").map(String::as_str), Some("Pedidos"));
        assert_eq!(ui.labels.get("invoices").unwrap().chars().count(), 30, "nombres largos se recortan");
        assert_eq!(ui.features, vec!["pedidos-domicilio"]);
        // El menú no cambia los módulos: siguen siendo los de la licencia.
        assert_eq!(st.modules, vec!["invoices", "quotes"]);
    }

    #[test]
    fn offline_activation_verifies_signature_and_device() {
        let dir = TempDir::new().unwrap();
        let now = 1_800_000_000;
        let mut m = manager(dir.path(), None);
        let good = sign(&payload(now, "active", &["invoices", "inventory"]));
        // Firma alterada
        let mut tampered = good.clone();
        tampered.replace_range(5..6, if &good[5..6] == "A" { "B" } else { "A" });
        assert!(m.activate_offline(&tampered, now).is_err());
        // Otro equipo
        let mut other = payload(now, "active", &["invoices"]);
        other.device = "ZZZZ-ZZZZ-ZZZZ-ZZZZ".to_string();
        assert!(m.activate_offline(&sign(&other), now).unwrap_err().contains(DEVICE));
        // Correcto: inventario sin catálogo se descarta por dependencia
        let st = m.activate_offline(&good, now).unwrap();
        assert_eq!(st.mode, LicenseMode::Licensed);
        assert_eq!(st.modules, vec!["invoices".to_string()]);
        // Persiste al reabrir
        let mut again = manager(dir.path(), None);
        assert_eq!(again.status(now + DAY).mode, LicenseMode::Licensed);
    }

    #[test]
    fn online_activation_checkin_revocation_and_reactivation() {
        let dir = TempDir::new().unwrap();
        let now = 1_800_000_000;
        let status = Arc::new(Mutex::new("active".to_string()));
        let online = Arc::new(Mutex::new(true));
        let mut m = manager(dir.path(), Some(FakeServer { status: status.clone(), online: online.clone(), now }));
        assert!(m.activate_online("CE-AAAA-AAAA-AAAA-AAAA", "PC", "0.3.0", now).unwrap_err().contains("no existe"));
        let st = m.activate_online("ce-2345-6789-abcd-efgh", "PC-Caja", "0.3.0", now).unwrap();
        assert_eq!(st.mode, LicenseMode::Licensed);
        assert!(m.entitlements(now).has("inventory"));
        assert!(!m.entitlements(now).has("finance"));

        // El proveedor desactiva la licencia → modo restringido en el siguiente reporte.
        *status.lock().unwrap() = "revoked".to_string();
        let st = m.check_in("PC-Caja", "0.3.0", now + 3600).unwrap();
        assert_eq!(st.mode, LicenseMode::Restricted);
        assert!(st.message.unwrap().contains("Contacta a soporte"));
        let ent = m.entitlements(now + 3600);
        assert!(check_gate(&ent, Gate::Read("invoices")).is_ok());
        assert!(check_gate(&ent, Gate::Write("invoices")).is_err());
        assert!(check_gate(&ent, Gate::Read("customers")).is_err());
        assert!(check_gate(&ent, Gate::DataExport).is_ok());

        // Reactivada → vuelve a la normalidad.
        *status.lock().unwrap() = "active".to_string();
        assert_eq!(m.check_in("PC-Caja", "0.3.0", now + 7200).unwrap().mode, LicenseMode::Licensed);

        // Sin conexión: conserva el token y anota el error.
        *online.lock().unwrap() = false;
        assert!(m.check_in("PC-Caja", "0.3.0", now + 3 * DAY).is_err());
        let st = m.status(now + 3 * DAY);
        assert_eq!(st.mode, LicenseMode::Licensed);
        assert!(st.last_check_error.is_some());
    }

    #[test]
    fn offline_grace_expires_after_30_days_and_clock_rollback_is_detected() {
        let dir = TempDir::new().unwrap();
        let now = 1_800_000_000;
        let mut m = manager(dir.path(), None);
        m.activate_offline(&sign(&payload(now, "active", &["invoices"])), now).unwrap();
        assert_eq!(m.status(now + 29 * DAY).mode, LicenseMode::Licensed);
        let st = m.status(now + 31 * DAY);
        assert_eq!(st.mode, LicenseMode::Restricted);
        assert_eq!(st.reason.as_deref(), Some("offline_expired"));
        // Atrasar el reloj no recupera el acceso.
        let st = m.status(now + 2 * DAY);
        assert_eq!(st.reason.as_deref(), Some("clock"));
    }

    #[test]
    fn license_expiry_and_device_revocation() {
        let dir = TempDir::new().unwrap();
        let now = 1_800_000_000;
        let mut m = manager(dir.path(), None);
        let mut p = payload(now, "active", &["invoices"]);
        p.lic_exp = Some(now + DAY);
        m.activate_offline(&sign(&p), now).unwrap();
        assert_eq!(m.status(now + 2 * DAY).reason.as_deref(), Some("license_expired"));
        m.activate_offline(&sign(&payload(now, "device_revoked", &["invoices"])), now).unwrap();
        assert_eq!(m.status(now).reason.as_deref(), Some("device_revoked"));
    }
}

/// Prueba de punta a punta contra el servidor de licencias local (`wrangler dev --local`).
/// No corre con `cargo test` normal. Ver `license-server/scripts/e2e-local.mjs`.
#[cfg(test)]
mod e2e_local_server {
    use super::*;
    use tempfile::TempDir;

    fn env(name: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| panic!("Falta la variable {}", name))
    }

    fn admin(method: &str, path: &str, body: serde_json::Value) -> serde_json::Value {
        let url = format!("{}{}", env("CARTUCHO_E2E_SERVER"), path);
        let req = ureq::request(method, &url).set("authorization", &format!("Bearer {}", env("CARTUCHO_E2E_ADMIN")));
        let res = if method == "GET" || method == "DELETE" { req.call() } else { req.send_json(body) };
        match res {
            Ok(r) => r.into_json().unwrap(),
            Err(ureq::Error::Status(_, r)) => r.into_json().unwrap(),
            Err(e) => panic!("{}", e),
        }
    }

    fn device(dir: &TempDir, code: &str) -> LicenseManager {
        LicenseManager::with_parts(
            dir.path(),
            parse_public_key(&env("CARTUCHO_E2E_PUBKEY")),
            Some(Box::new(HttpTransport::new(&env("CARTUCHO_E2E_SERVER")))),
            false,
            code,
        )
    }

    #[test]
    #[ignore]
    fn activation_limits_revocation_and_offline_code() {
        let now = chrono::Utc::now().timestamp();
        let created = admin("POST", "/api/licenses", serde_json::json!({
            "customer": "Ferretería E2E", "plan": "basico", "maxDevices": 1, "support": "WhatsApp 300 E2E"
        }));
        assert_eq!(created["ok"], true, "{created}");
        let key = created["license"]["key"].as_str().unwrap().to_string();
        let lic_path = format!("/api/licenses/{}", key);

        // 1. Equipo A activa con la clave.
        let (da, db, dc) = (TempDir::new().unwrap(), TempDir::new().unwrap(), TempDir::new().unwrap());
        let mut a = device(&da, "AAAA-BBBB-CCCC-DDDD");
        let st = a.activate_online(&key.to_lowercase().replace('-', ""), "PC-A", "0.3.0", now).unwrap();
        assert_eq!(st.mode, LicenseMode::Licensed);
        assert_eq!(st.modules, vec!["customers", "invoices"]);
        assert_eq!(st.customer.as_deref(), Some("Ferretería E2E"));
        assert_eq!(st.support.as_deref(), Some("WhatsApp 300 E2E"));
        assert_eq!(st.days_left, Some(30));
        println!("1. activación OK: {:?}", st.modules);

        // 2. Equipo B: límite de 1 equipo.
        let mut b = device(&db, "EEEE-FFFF-GGGG-HHHH");
        let err = b.activate_online(&key, "PC-B", "0.3.0", now).unwrap_err();
        assert!(err.contains("máximo"), "{err}");
        assert_eq!(b.status(now).mode, LicenseMode::Unlicensed);
        println!("2. límite de equipos OK: {err}");

        // 3. Cambio de plan → llega en la siguiente validación.
        assert_eq!(admin("PATCH", &lic_path, serde_json::json!({ "plan": "completo" }))["ok"], true);
        let st = a.check_in("PC-A", "0.3.0", now).unwrap();
        assert_eq!(st.modules.len(), ALL_MODULES.len());
        println!("3. cambio de plan OK: {:?}", st.modules);

        // 4. Licencia desactivada → solo facturas.
        assert_eq!(admin("PATCH", &lic_path, serde_json::json!({ "status": "revoked" }))["ok"], true);
        let st = a.check_in("PC-A", "0.3.0", now).unwrap();
        assert_eq!(st.mode, LicenseMode::Restricted);
        assert_eq!(st.reason.as_deref(), Some("revoked"));
        assert_eq!(st.modules, vec!["invoices"]);
        assert!(check_gate(&a.entitlements(now), Gate::Read("invoices")).is_ok());
        assert!(check_gate(&a.entitlements(now), Gate::Write("invoices")).is_err());
        println!("4. desactivación OK: {:?}", st.message);

        // 5. Reactivada.
        admin("PATCH", &lic_path, serde_json::json!({ "status": "active" }));
        assert_eq!(a.check_in("PC-A", "0.3.0", now).unwrap().mode, LicenseMode::Licensed);
        println!("5. reactivación OK");

        // 6. Desactivar el equipo A (duplicado) libera el cupo para B.
        let detail = admin("GET", &lic_path, serde_json::Value::Null);
        let id_a = detail["devices"][0]["id"].as_i64().unwrap();
        assert_eq!(detail["devices"][0]["online"], true);
        assert_eq!(admin("POST", &format!("/api/devices/{}/revoke", id_a), serde_json::json!({}))["ok"], true);
        let st = a.check_in("PC-A", "0.3.0", now).unwrap();
        assert_eq!((st.mode, st.reason.as_deref()), (LicenseMode::Restricted, Some("device_revoked")));
        let st = b.activate_online(&key, "PC-B", "0.3.0", now).unwrap();
        assert_eq!(st.mode, LicenseMode::Licensed);
        println!("6. equipo desactivado y cupo liberado OK");

        // 7. Activación sin Internet: requiere cupo.
        let r = admin("POST", &format!("{}/offline-code", lic_path), serde_json::json!({ "deviceCode": "JJJJ-KKKK-LLLL-MMMM" }));
        assert_eq!(r["ok"], false);
        admin("PATCH", &lic_path, serde_json::json!({ "maxDevices": 2 }));
        let r = admin("POST", &format!("{}/offline-code", lic_path), serde_json::json!({ "deviceCode": "jjjjkkkkllllmmmm" }));
        let code = r["token"].as_str().unwrap();
        let mut c = LicenseManager::with_parts(dc.path(), parse_public_key(&env("CARTUCHO_E2E_PUBKEY")), None, false, "JJJJ-KKKK-LLLL-MMMM");
        assert_eq!(c.activate_offline(code, now).unwrap().mode, LicenseMode::Licensed);
        // El mismo código no sirve en otro equipo.
        assert!(device(&TempDir::new().unwrap(), "NNNN-PPPP-QQQQ-RRRR").activate_offline(code, now).is_err());
        println!("7. código sin Internet OK");

        // 8. Clave inexistente y equipos conectados.
        let err = device(&TempDir::new().unwrap(), "SSSS-TTTT-UUUU-VVVV").activate_online("CE-2222-3333-4444-5555", "X", "0.3.0", now).unwrap_err();
        assert!(err.contains("no existe"), "{err}");
        let online = admin("GET", "/api/online", serde_json::Value::Null);
        assert!(online["devices"].as_array().unwrap().iter().any(|d| d["deviceCode"] == "EEEE-FFFF-GGGG-HHHH"));
        println!("8. clave inexistente y lista de conectados OK");

        // 9. Datos de empresa y menú personalizado llegan en la validación.
        let r = admin("PATCH", &lic_path, serde_json::json!({
            "taxId": "900.123.456-7",
            "ui": { "hide": ["cash-close", "no-existe"], "labels": { "quotes": "Pedidos" }, "features": "Pedidos-Domicilio, mal nombre" }
        }));
        assert_eq!(r["ok"], true, "{r}");
        let st = b.check_in("PC-B", "0.3.1", now).unwrap();
        assert_eq!(st.company.as_ref().and_then(|c| c.tax_id.as_deref()), Some("900.123.456-7"));
        let ui = st.ui.expect("menú");
        assert_eq!(ui.hide, vec!["cash-close"], "solo opciones conocidas");
        assert_eq!(ui.labels.get("quotes").map(String::as_str), Some("Pedidos"));
        assert_eq!(ui.features, vec!["pedidos-domicilio"], "funciones normalizadas");
        // Versión y última conexión del equipo.
        let detail = admin("GET", &lic_path, serde_json::Value::Null);
        assert!(detail["devices"].as_array().unwrap().iter().any(|d| d["appVersion"] == "0.3.1"));
        println!("9. empresa y menú personalizado OK");

        // 10. Pago con «paga hasta» extiende el vencimiento y llega a la app.
        let until = now + 40 * 86400;
        let r = admin("POST", &format!("{}/payments", lic_path), serde_json::json!({ "amount": 50000, "method": "Nequi", "coversUntil": until }));
        assert_eq!(r["ok"], true, "{r}");
        let detail = admin("GET", &lic_path, serde_json::Value::Null);
        assert_eq!(detail["license"]["expiresAt"].as_i64(), Some(until));
        assert_eq!(detail["payments"][0]["amount"], 50000);
        let st = b.check_in("PC-B", "0.3.1", now).unwrap();
        assert!(st.license_expires_at.is_some());
        let summary = admin("GET", "/api/summary", serde_json::Value::Null);
        assert!(summary["summary"]["paidThisMonth"].as_i64().unwrap() >= 50000);
        assert!(admin("POST", &format!("{}/payments", lic_path), serde_json::json!({ "amount": -5 }))["ok"] == false);
        // Eliminar un pago no cambia el vencimiento.
        let pid = detail["payments"][0]["id"].as_i64().unwrap();
        assert_eq!(admin("DELETE", &format!("/api/payments/{}", pid), serde_json::Value::Null)["ok"], true);
        let detail = admin("GET", &lic_path, serde_json::Value::Null);
        assert_eq!(detail["payments"].as_array().unwrap().len(), 0);
        assert_eq!(detail["license"]["expiresAt"].as_i64(), Some(until));
        println!("10. pagos y vencimiento OK");
    }
}
