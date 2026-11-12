//! Acceso desde celulares por la red local (ADR 0009).
//!
//! El PC donde está la base de datos levanta un pequeño servidor HTTP. Los celulares de la
//! misma red WiFi abren una página web liviana (incluida en el programa), inician sesión con
//! su usuario de Cartucho y **consultan** facturas y cotizaciones. No hay operaciones de
//! escritura: el celular no crea, modifica ni borra nada.
//!
//! - SQLite sigue en un solo equipo; el servidor usa los mismos métodos de `LocalDatabase`.
//! - Cada petición se ejecuta con la sesión del usuario del celular (`run_as_user`) bajo el
//!   mismo bloqueo de la base, así que la sesión del PC no se ve afectada.
//! - Se aplican la licencia y el rol del usuario, igual que en el programa.
//! - Viene apagado; solo un administrador lo activa. La conexión es HTTP sin cifrar dentro de
//!   la red local (ver limitaciones en el ADR).

use crate::db::LocalDatabase;
use crate::erp::sales::InvoiceFilter;
use crate::licensing::{check_gate, Gate};
use crate::AppState;
use password_hash::rand_core::{OsRng, RngCore};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const DEFAULT_PORT: u16 = 8787;
const META_ENABLED: &str = "lan_access_enabled";
const META_PORT: &str = "lan_access_port";
/// ¿La app de Android puede registrar (ventas, clientes, gastos…)? Apagado por defecto.
const META_WRITES: &str = "lan_access_writes";
/// La sesión del celular se cierra tras 12 horas sin uso.
const SESSION_IDLE: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_SESSIONS: usize = 100;
const MAX_FAILED_LOGINS: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(120);
/// Las fotos de productos viajan en base64 desde la app: se permite hasta 8 MB por petición.
const MAX_BODY: u64 = 8 * 1024 * 1024;
const WORKERS: usize = 4;
/// Módulos que se pueden consultar desde el celular.
pub const MOBILE_MODULES: &[&str] = &["invoices", "quotes"];

const MOBILE_HTML: &str = include_str!("mobile.html");
const MANIFEST: &str = r##"{"name":"Cartucho ERP","short_name":"Cartucho","start_url":"/","display":"standalone","background_color":"#f6f6fb","theme_color":"#6d5dd3","icons":[{"src":"/icon.svg","sizes":"any","type":"image/svg+xml"}]}"##;
const ICON_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="22" fill="#6d5dd3"/><path d="M62 30a24 24 0 1 0 0 36" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round"/></svg>"##;

// ------------------------------------------------------------------------ Configuración

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LanConfig {
    pub enabled: bool,
    pub port: u16,
}

pub fn read_config(db: &LocalDatabase) -> Result<LanConfig, String> {
    let conn = db.connect()?;
    let get = |key: &str| -> Option<String> {
        conn.query_row("SELECT value FROM _app_metadata WHERE key = ?1", params![key], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    };
    Ok(LanConfig {
        enabled: get(META_ENABLED).as_deref() == Some("1"),
        port: get(META_PORT).and_then(|p| p.parse().ok()).filter(|p| valid_port(*p)).unwrap_or(DEFAULT_PORT),
    })
}

pub fn save_config(db: &LocalDatabase, cfg: LanConfig) -> Result<(), String> {
    if !valid_port(cfg.port) {
        return Err("El puerto debe estar entre 1024 y 65535.".to_string());
    }
    let conn = db.connect()?;
    let now = chrono::Utc::now().to_rfc3339();
    for (k, v) in [(META_ENABLED, if cfg.enabled { "1".to_string() } else { "0".to_string() }), (META_PORT, cfg.port.to_string())] {
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![k, v, now],
        )
        .map_err(|_| "No se pudo guardar la configuración del acceso desde celulares.".to_string())?;
    }
    Ok(())
}

/// ¿El administrador permite registrar desde la app de Android?
pub fn writes_allowed(db: &LocalDatabase) -> bool {
    db.connect()
        .ok()
        .and_then(|c| {
            c.query_row("SELECT value FROM _app_metadata WHERE key = ?1", params![META_WRITES], |r| r.get::<_, String>(0))
                .optional()
                .ok()
                .flatten()
        })
        .as_deref()
        == Some("1")
}

pub fn save_writes_allowed(db: &LocalDatabase, allowed: bool) -> Result<(), String> {
    let conn = db.connect()?;
    conn.execute(
        "INSERT INTO _app_metadata (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![META_WRITES, if allowed { "1" } else { "0" }, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(|_| "No se pudo guardar el permiso de la app.".to_string())?;
    Ok(())
}

pub mod rpc;

fn valid_port(p: u16) -> bool {
    p >= 1024
}

// ------------------------------------------------------------------------ Sesiones

struct Session {
    user_id: i64,
    last_used: Instant,
}

#[derive(Default)]
pub struct LanSessions {
    map: Mutex<HashMap<String, Session>>,
    failed: Mutex<(u32, Option<Instant>)>,
}

impl LanSessions {
    fn create(&self, user_id: i64) -> String {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let token: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, s| s.last_used.elapsed() < SESSION_IDLE);
        if map.len() >= MAX_SESSIONS {
            if let Some(oldest) = map.iter().min_by_key(|(_, s)| s.last_used).map(|(k, _)| k.clone()) {
                map.remove(&oldest);
            }
        }
        map.insert(token.clone(), Session { user_id, last_used: Instant::now() });
        token
    }

    fn user_for(&self, token: &str) -> Option<i64> {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        match map.get_mut(token) {
            Some(s) if s.last_used.elapsed() < SESSION_IDLE => {
                s.last_used = Instant::now();
                Some(s.user_id)
            }
            Some(_) => {
                map.remove(token);
                None
            }
            None => None,
        }
    }

    fn remove(&self, token: &str) {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).remove(token);
    }

    pub fn clear(&self) {
        self.map.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    pub fn active_count(&self) -> usize {
        self.map
            .lock()
            .map(|m| m.values().filter(|s| s.last_used.elapsed() < SESSION_IDLE).count())
            .unwrap_or(0)
    }

    fn locked_for(&self) -> Option<u64> {
        let mut f = self.failed.lock().unwrap_or_else(|e| e.into_inner());
        match f.1 {
            Some(until) if Instant::now() < until => Some((until - Instant::now()).as_secs() + 1),
            Some(_) => {
                f.1 = None;
                None
            }
            None => None,
        }
    }

    fn register_failure(&self) {
        let mut f = self.failed.lock().unwrap_or_else(|e| e.into_inner());
        f.0 += 1;
        if f.0 >= MAX_FAILED_LOGINS {
            f.0 = 0;
            f.1 = Some(Instant::now() + LOCKOUT);
        }
    }

    fn register_success(&self) {
        self.failed.lock().unwrap_or_else(|e| e.into_inner()).0 = 0;
    }
}

// ------------------------------------------------------------------------ Peticiones

pub struct HttpResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
}

impl HttpResponse {
    fn json(status: u16, v: Value) -> Self {
        Self { status, content_type: "application/json; charset=utf-8", body: v.to_string().into_bytes() }
    }
    fn error(status: u16, msg: &str) -> Self {
        Self::json(status, json!({ "error": msg }))
    }
    fn text(content_type: &'static str, body: &str) -> Self {
        Self { status: 200, content_type, body: body.as_bytes().to_vec() }
    }
}

#[derive(Deserialize)]
struct LoginBody {
    username: String,
    password: String,
    /// "app" cuando entra la app de Android (puede usar cualquier módulo de su rol).
    #[serde(default)]
    client: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MobileProfile {
    full_name: String,
    username: String,
    role_name: String,
    modules: Vec<&'static str>,
    company: Value,
}

fn parse_query(q: &str) -> HashMap<String, String> {
    q.split('&')
        .filter_map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            if k.is_empty() {
                None
            } else {
                Some((url_decode(k), url_decode(v)))
            }
        })
        .collect()
}

fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 2;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn is_auth_error(msg: &str) -> bool {
    msg == crate::db::UNAUTHORIZED_MSG || msg.starts_with("Tu sesión terminó")
}

fn map_err(msg: String) -> HttpResponse {
    if msg.contains("permiso") || msg.contains("licencia") || msg.contains("Activa tu") {
        HttpResponse::error(403, &msg)
    } else if is_auth_error(&msg) {
        HttpResponse::error(401, "Tu sesión terminó. Vuelve a entrar.")
    } else if msg.contains("no existe") {
        HttpResponse::error(404, &msg)
    } else {
        HttpResponse::error(400, &msg)
    }
}

fn to_json<T: Serialize>(r: Result<T, String>) -> HttpResponse {
    match r {
        Ok(v) => HttpResponse::json(200, serde_json::to_value(v).unwrap_or(Value::Null)),
        Err(e) => map_err(e),
    }
}

fn profile(state: &AppState, user_id: i64) -> Result<MobileProfile, String> {
    let ent = state.entitlements();
    state.with_db(|db| {
        db.run_as_user(user_id, |db| {
            let user = db.require_authenticated_user()?;
            let access = db.current_access()?.ok_or_else(|| "Tu sesión terminó.".to_string())?;
            let modules: Vec<&'static str> = MOBILE_MODULES
                .iter()
                .copied()
                .filter(|m| check_gate(&ent, Gate::Read(m)).is_ok() && access.can_read(m))
                .collect();
            let company = db
                .get_company_profile()?
                .map(|c| {
                    json!({
                        "tradeName": c.trade_name, "legalName": c.legal_name, "taxId": c.tax_id,
                        "address": c.address, "phone": c.phone, "email": c.email,
                        "logoDataUrl": c.logo_data_url,
                    })
                })
                .unwrap_or(Value::Null);
            Ok(MobileProfile {
                full_name: user.full_name,
                username: user.username,
                role_name: if user.role_name.is_empty() { user.role.clone() } else { user.role_name },
                modules,
                company,
            })
        })
    })
}

/// Atiende una petición. No depende de la red: las pruebas la llaman directamente.
pub fn handle(
    state: &AppState,
    sessions: &LanSessions,
    method: &str,
    url: &str,
    authorization: Option<&str>,
    body: &[u8],
) -> HttpResponse {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let path = path.trim_end_matches('/');
    let path = if path.is_empty() { "/" } else { path };

    match (method, path) {
        ("GET", "/") | ("GET", "/index.html") => return HttpResponse::text("text/html; charset=utf-8", MOBILE_HTML),
        ("GET", "/manifest.webmanifest") => return HttpResponse::text("application/manifest+json", MANIFEST),
        ("GET", "/icon.svg") => return HttpResponse::text("image/svg+xml", ICON_SVG),
        ("POST", "/api/login") => return login(state, sessions, body),
        ("GET", "/api/brand") => return brand(state),
        // La app de Android lo usa para reconocer un PC con Cartucho en la red.
        ("GET", "/api/ping") => {
            return HttpResponse::json(200, json!({ "app": "cartucho-erp", "version": env!("CARGO_PKG_VERSION") }));
        }
        _ => {}
    }
    if !path.starts_with("/api/") {
        return HttpResponse::error(404, "No encontrado.");
    }
    let is_rpc = method == "POST" && path.starts_with("/api/rpc/");
    if method != "GET" && !(method == "POST" && path == "/api/logout") && !is_rpc {
        return HttpResponse::error(405, "Desde el celular solo se puede consultar.");
    }

    let token = authorization.and_then(|h| h.strip_prefix("Bearer ")).map(str::trim).unwrap_or("");
    let user_id = match (token.len() == 64).then(|| sessions.user_for(token)).flatten() {
        Some(id) => id,
        None => return HttpResponse::error(401, "Inicia sesión para continuar."),
    };

    let q = parse_query(query);
    let segments: Vec<&str> = path.trim_start_matches("/api/").split('/').collect();
    let resp = match (method, segments.as_slice()) {
        ("POST", ["logout"]) => {
            sessions.remove(token);
            HttpResponse::json(200, json!({ "ok": true }))
        }
        ("GET", ["me"]) => to_json(profile(state, user_id)),
        ("POST", ["rpc", cmd]) => {
            let args: Value = if body.is_empty() {
                Value::Object(Default::default())
            } else {
                match serde_json::from_slice(body) {
                    Ok(v) => v,
                    Err(_) => return HttpResponse::error(400, "Solicitud no válida."),
                }
            };
            let writes = state.with_db(|db| Ok(writes_allowed(db))).unwrap_or(false);
            match rpc::dispatch(state, user_id, cmd, &args, writes) {
                Ok(v) => HttpResponse::json(200, json!({ "ok": true, "data": v })),
                Err(e) if e == rpc::WRITES_DISABLED || e == rpc::ONLY_ON_PC => HttpResponse::error(403, &e),
                Err(e) => map_err(e),
            }
        }
        ("GET", ["invoices"]) => {
            let filter = InvoiceFilter {
                search: q.get("q").cloned(),
                status: q.get("status").cloned().filter(|s| ["open", "pending", "partial", "paid", "void"].contains(&s.as_str())),
                date_from: None,
                date_to: None,
                customer_id: None,
                limit: Some(q.get("limit").and_then(|l| l.parse().ok()).unwrap_or(100).clamp(1, 300)),
                created_by: None,
            };
            to_json(state.gated_as(user_id, Gate::Read("invoices"), |db| db.list_invoices(&filter)))
        }
        ("GET", ["invoices", id]) => match id.parse::<i64>() {
            Ok(id) => to_json(state.gated_as(user_id, Gate::Read("invoices"), |db| db.get_invoice(id))),
            Err(_) => HttpResponse::error(404, "La factura no existe."),
        },
        ("GET", ["quotes"]) => {
            let status = q.get("status").cloned().filter(|s| ["open", "converted", "cancelled"].contains(&s.as_str()));
            let search = q.get("q").cloned();
            to_json(state.gated_as(user_id, Gate::Read("quotes"), |db| {
                db.list_quotes(search, status).map(|mut v| {
                    v.truncate(300);
                    v
                })
            }))
        }
        ("GET", ["quotes", id]) => match id.parse::<i64>() {
            Ok(id) => to_json(state.gated_as(user_id, Gate::Read("quotes"), |db| db.get_quote(id))),
            Err(_) => HttpResponse::error(404, "La cotización no existe."),
        },
        _ => HttpResponse::error(404, "No encontrado."),
    };
    if resp.status == 401 {
        sessions.remove(token);
    }
    resp
}

/// Nombre y logo de la empresa para la pantalla de entrada (no requiere sesión: es lo mismo
/// que muestra el programa antes de iniciar sesión).
fn brand(state: &AppState) -> HttpResponse {
    let r = state.with_db(|db| db.get_company_profile()).ok().flatten();
    HttpResponse::json(
        200,
        match r {
            Some(c) => json!({ "tradeName": c.trade_name, "logoDataUrl": c.logo_data_url }),
            None => json!({ "tradeName": null, "logoDataUrl": null }),
        },
    )
}

fn login(state: &AppState, sessions: &LanSessions, body: &[u8]) -> HttpResponse {
    if let Some(secs) = sessions.locked_for() {
        return HttpResponse::error(
            429,
            &format!("Demasiados intentos fallidos. Espera {} segundos antes de volver a intentarlo.", secs),
        );
    }
    let input: LoginBody = match serde_json::from_slice(body) {
        Ok(b) => b,
        Err(_) => return HttpResponse::error(400, "Introduce tu nombre de usuario y contraseña."),
    };
    if check_gate(&state.entitlements(), Gate::Core).is_err() {
        return HttpResponse::error(403, "El programa del PC no tiene una licencia activa.");
    }
    let verified = state.with_db(|db| db.verify_credentials(&input.username, &input.password));
    let user_id = match verified {
        Ok(id) => id,
        Err(e) => {
            if e.starts_with("Credenciales incorrectas") {
                sessions.register_failure();
                return HttpResponse::error(401, &e);
            }
            return HttpResponse::error(400, &e);
        }
    };
    sessions.register_success();
    let is_app = input.client.as_deref() == Some("app");
    match profile(state, user_id) {
        Ok(p) if p.modules.is_empty() && !is_app => HttpResponse::error(
            403,
            "Tu rol no tiene permiso para ver facturas ni cotizaciones. Pídele acceso al administrador.",
        ),
        Ok(p) => {
            let token = sessions.create(user_id);
            HttpResponse::json(200, json!({ "token": token, "profile": p }))
        }
        Err(e) => map_err(e),
    }
}

// ------------------------------------------------------------------------ Servidor

/// Da acceso al estado de la aplicación desde los hilos del servidor.
pub type StateProvider = Arc<dyn Fn(&mut dyn FnMut(&AppState)) + Send + Sync>;

struct Running {
    server: Arc<tiny_http::Server>,
    port: u16,
    stop: Arc<AtomicBool>,
    workers: Vec<std::thread::JoinHandle<()>>,
}

#[derive(Default)]
pub struct LanController {
    running: Option<Running>,
    last_error: Option<String>,
    pub sessions: Arc<LanSessions>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    /// Direcciones para abrir en el celular (la primera es la recomendada).
    pub urls: Vec<String>,
    /// Código QR (SVG) de la primera dirección.
    pub qr_svg: Option<String>,
    pub active_sessions: usize,
    pub error: Option<String>,
    /// La app de Android puede registrar ventas, clientes y gastos.
    pub writes_allowed: bool,
}

impl LanController {
    pub fn is_running(&self) -> bool {
        self.running.is_some()
    }

    pub fn port(&self) -> Option<u16> {
        self.running.as_ref().map(|r| r.port)
    }

    /// Inicia el servidor en todas las interfaces (`bind_ip` permite limitarlo en pruebas).
    pub fn start(&mut self, bind_ip: IpAddr, port: u16, provider: StateProvider) -> Result<u16, String> {
        self.stop();
        let server = match tiny_http::Server::http((bind_ip, port)) {
            Ok(s) => Arc::new(s),
            Err(_) => {
                let msg = format!(
                    "No se pudo abrir el puerto {}. Puede que otro programa lo esté usando: prueba con otro número.",
                    port
                );
                self.last_error = Some(msg.clone());
                return Err(msg);
            }
        };
        let real_port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
        let stop = Arc::new(AtomicBool::new(false));
        let workers = (0..WORKERS)
            .map(|_| {
                let server = server.clone();
                let stop = stop.clone();
                let provider = provider.clone();
                let sessions = self.sessions.clone();
                std::thread::spawn(move || {
                    while !stop.load(Ordering::SeqCst) {
                        let rq = match server.recv() {
                            Ok(rq) => rq,
                            Err(_) => break,
                        };
                        if stop.load(Ordering::SeqCst) {
                            break;
                        }
                        serve_one(rq, &provider, &sessions);
                    }
                })
            })
            .collect();
        self.running = Some(Running { server, port: real_port, stop, workers });
        self.last_error = None;
        Ok(real_port)
    }

    /// Detiene el servidor y cierra las sesiones de los celulares.
    pub fn stop(&mut self) {
        if let Some(r) = self.running.take() {
            r.stop.store(true, Ordering::SeqCst);
            for _ in 0..r.workers.len() {
                r.server.unblock();
            }
            for w in r.workers {
                let _ = w.join();
            }
        }
        self.sessions.clear();
    }

    pub fn status(&self, cfg: LanConfig) -> LanStatus {
        let port = self.port().unwrap_or(cfg.port);
        let urls: Vec<String> = if self.is_running() {
            local_ipv4_addresses().iter().map(|ip| format!("http://{}:{}/", ip, port)).collect()
        } else {
            Vec::new()
        };
        LanStatus {
            enabled: cfg.enabled,
            running: self.is_running(),
            port,
            qr_svg: urls.first().and_then(|u| qr_svg(u)),
            urls,
            active_sessions: if self.is_running() { self.sessions.active_count() } else { 0 },
            error: self.last_error.clone(),
            writes_allowed: false,
        }
    }
}

fn serve_one(mut rq: tiny_http::Request, provider: &StateProvider, sessions: &LanSessions) {
    let method = rq.method().as_str().to_uppercase();
    let url = rq.url().to_string();
    let auth = rq
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str().to_string());
    let mut body = Vec::new();
    let too_big = rq.body_length().is_some_and(|l| l as u64 > MAX_BODY);
    let resp = if too_big || rq.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() || body.len() as u64 > MAX_BODY {
        HttpResponse::error(413, "Solicitud demasiado grande.")
    } else {
        let mut out = None;
        provider(&mut |state: &AppState| {
            out = Some(handle(state, sessions, &method, &url, auth.as_deref(), &body));
        });
        out.unwrap_or_else(|| HttpResponse::error(503, "El programa no está disponible."))
    };
    let is_html = resp.content_type.starts_with("text/html");
    let mut response = tiny_http::Response::from_data(resp.body).with_status_code(resp.status);
    let mut headers = vec![
        ("Content-Type", resp.content_type),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
        ("X-Frame-Options", "DENY"),
        ("Cache-Control", "no-store"),
    ];
    if is_html {
        headers.push((
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        ));
    }
    for (k, v) in headers {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            response.add_header(h);
        }
    }
    let _ = rq.respond(response);
}

// ------------------------------------------------------------------------ Red y QR

fn is_private_v4(ip: &Ipv4Addr) -> bool {
    ip.is_private() && !ip.is_loopback() && !ip.is_link_local()
}

/// Direcciones IPv4 de la red local de este equipo. Primero la de la ruta principal.
pub fn local_ipv4_addresses() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    // Truco habitual: «conectar» un socket UDP no envía nada, pero revela la interfaz de salida.
    if let Ok(sock) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if sock.connect("192.168.1.1:9").is_ok() || sock.connect("10.255.255.255:9").is_ok() {
            if let Ok(IpAddr::V4(ip)) = sock.local_addr().map(|a| a.ip()) {
                if is_private_v4(&ip) {
                    out.push(ip);
                }
            }
        }
    }
    let interfaces: Vec<Ipv4Addr> = local_ip_address::list_afinet_netifas()
        .map(|list| list.into_iter().filter_map(|(_, ip)| match ip { IpAddr::V4(v4) => Some(v4), _ => None }).collect())
        .unwrap_or_default();
    for v4 in &interfaces {
        if is_private_v4(v4) && !out.contains(v4) {
            out.push(*v4);
        }
    }
    // Redes poco comunes (sin direcciones privadas): se ofrecen las demás direcciones del equipo.
    if out.is_empty() {
        for v4 in interfaces {
            if !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified() && !out.contains(&v4) {
                out.push(v4);
            }
        }
    }
    out
}

pub fn qr_svg(text: &str) -> Option<String> {
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    Some(
        code.render::<qrcode::render::svg::Color>()
            .min_dimensions(220, 220)
            .quiet_zone(true)
            .dark_color(qrcode::render::svg::Color("#111111"))
            .light_color(qrcode::render::svg::Color("#ffffff"))
            .build(),
    )
}

#[cfg(test)]
mod tests;
