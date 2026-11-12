//! Pruebas del acceso desde celulares, sobre bases SQLite temporales aisladas.

use super::*;
use crate::db::{CompleteInitialSetupInput, CreateInitialAdminInput, SaveCompanyProfileInput};
use crate::erp::sales::{CustomerSnapshotInput, DocumentLineInput, InvoiceInput, PaymentInput, QuoteInput};
use crate::licensing::LicenseManager;
use crate::users::{RoleInput, UserInput};
use std::collections::{BTreeMap, BTreeSet};
use tempfile::TempDir;

const PASS: &str = "ClaveSegura#1";

struct Fixture {
    _dir: TempDir,
    _lic: TempDir,
    state: AppState,
    sessions: LanSessions,
}

fn fixture() -> Fixture {
    let dir = TempDir::new().unwrap();
    let mut db = LocalDatabase::open_in_dir(dir.path()).unwrap();
    db.complete_initial_setup(&CompleteInitialSetupInput {
        company: SaveCompanyProfileInput { trade_name: "Tienda Prueba".into(), ..Default::default() },
        admin: CreateInitialAdminInput {
            full_name: "Dueña".into(),
            username: "admin".into(),
            password: PASS.into(),
            password_confirm: PASS.into(),
        },
        paper_size: None,
    })
    .unwrap();
    // Una factura con abono y una cotización.
    let customer = Some(CustomerSnapshotInput { name: "Cliente Celular".into(), ..Default::default() });
    let line = DocumentLineInput { product_id: None, description: "Servicio técnico".into(), quantity: 2.0, unit_price: 50_000, note: None };
    db.create_invoice(&InvoiceInput {
        customer: customer.clone(),
        issue_date: "2026-11-12".into(),
        lines: vec![line.clone()],
        initial_payment: Some(PaymentInput { amount: 30_000, method: "cash".into(), paid_at: "2026-11-12".into(), note: None }),
        ..Default::default()
    })
    .unwrap();
    db.create_quote(&QuoteInput { customer, issue_date: "2026-11-12".into(), lines: vec![line], ..Default::default() })
        .unwrap();
    // Vendedor (puede ver facturas) y un rol de bodega sin facturas ni cotizaciones.
    let all: BTreeSet<String> = crate::licensing::ALL_MODULES.iter().map(|m| m.to_string()).collect();
    let mut perms = BTreeMap::new();
    perms.insert("catalog".to_string(), "read".to_string());
    let bodega = db.save_role(&RoleInput { id: None, name: "Bodega".into(), description: None, permissions: perms }, &all).unwrap();
    for (user, role) in [("vendedora", "vendedor".to_string()), ("bodeguero", bodega.key.clone())] {
        db.save_user(&UserInput {
            id: None,
            full_name: user.into(),
            username: user.into(),
            role_key: role,
            password: Some(PASS.into()),
            is_active: true,
        })
        .unwrap();
    }
    let lic = TempDir::new().unwrap();
    let state = AppState {
        db: Mutex::new(Some(db)),
        startup_error: Mutex::new(None),
        license: Mutex::new(LicenseManager::with_parts(lic.path(), None, None, true, "AAAA-BBBB-CCCC-DDDD")),
        lan: Mutex::new(LanController::default()),
    };
    Fixture { _dir: dir, _lic: lic, state, sessions: LanSessions::default() }
}

fn body(r: &HttpResponse) -> Value {
    serde_json::from_slice(&r.body).unwrap()
}

fn login(f: &Fixture, user: &str, pass: &str) -> HttpResponse {
    let b = json!({ "username": user, "password": pass }).to_string();
    handle(&f.state, &f.sessions, "POST", "/api/login", None, b.as_bytes())
}

fn get(f: &Fixture, token: &str, url: &str) -> HttpResponse {
    handle(&f.state, &f.sessions, "GET", url, Some(&format!("Bearer {}", token)), b"")
}

fn token_for(f: &Fixture, user: &str) -> String {
    let r = login(f, user, PASS);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    body(&r)["token"].as_str().unwrap().to_string()
}

fn desktop_user(f: &Fixture) -> Option<String> {
    f.state.with_db(|db| Ok(db.get_authenticated_user()?.map(|u| u.username))).unwrap()
}

#[test]
fn serves_mobile_page_without_login() {
    let f = fixture();
    let r = handle(&f.state, &f.sessions, "GET", "/", None, b"");
    assert_eq!(r.status, 200);
    assert!(r.content_type.starts_with("text/html"));
    assert!(String::from_utf8_lossy(&r.body).contains("Cartucho"));
    assert_eq!(handle(&f.state, &f.sessions, "GET", "/manifest.webmanifest", None, b"").status, 200);
    assert_eq!(handle(&f.state, &f.sessions, "GET", "/nada", None, b"").status, 404);
    let brand = body(&handle(&f.state, &f.sessions, "GET", "/api/brand", None, b""));
    assert_eq!(brand, json!({ "tradeName": "Tienda Prueba", "logoDataUrl": null }));
}

#[test]
fn api_requires_session() {
    let f = fixture();
    for url in ["/api/me", "/api/invoices", "/api/invoices/1", "/api/quotes"] {
        assert_eq!(handle(&f.state, &f.sessions, "GET", url, None, b"").status, 401, "{url}");
        assert_eq!(get(&f, &"0".repeat(64), url).status, 401, "{url}");
        assert_eq!(get(&f, "corto", url).status, 401, "{url}");
    }
}

#[test]
fn wrong_password_is_rejected_without_revealing_which_part_failed() {
    let f = fixture();
    let bad_pass = login(&f, "admin", "otra-clave");
    let bad_user = login(&f, "nadie", PASS);
    assert_eq!(bad_pass.status, 401);
    assert_eq!(body(&bad_pass), body(&bad_user));
    assert!(!String::from_utf8_lossy(&bad_pass.body).contains("otra-clave"));
    assert_eq!(login(&f, "admin", "").status, 400);
    assert_eq!(handle(&f.state, &f.sessions, "POST", "/api/login", None, b"no es json").status, 400);
}

#[test]
fn repeated_failures_lock_logins_for_a_while() {
    let f = fixture();
    for _ in 0..MAX_FAILED_LOGINS {
        assert_eq!(login(&f, "admin", "mala-clave").status, 401);
    }
    // Bloqueado incluso con la contraseña correcta.
    let r = login(&f, "admin", PASS);
    assert_eq!(r.status, 429);
    assert!(body(&r)["error"].as_str().unwrap().contains("Espera"));
}

#[test]
fn admin_sees_invoices_and_quotes() {
    let f = fixture();
    let r = login(&f, "admin", PASS);
    let b = body(&r);
    assert_eq!(b["profile"]["company"]["tradeName"], "Tienda Prueba");
    assert_eq!(b["profile"]["modules"], json!(["invoices", "quotes"]));
    let t = b["token"].as_str().unwrap().to_string();
    assert_eq!(t.len(), 64);

    let list = body(&get(&f, &t, "/api/invoices?q=Cliente+Celular&status=open"));
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["balance"], 70_000);
    let id = list[0]["id"].as_i64().unwrap();
    let detail = body(&get(&f, &t, &format!("/api/invoices/{id}")));
    assert_eq!(detail["total"], 100_000);
    assert_eq!(detail["lines"][0]["description"], "Servicio técnico");
    assert_eq!(detail["payments"].as_array().unwrap().len(), 1);
    assert_eq!(get(&f, &t, "/api/invoices/99999").status, 404);
    assert_eq!(get(&f, &t, "/api/invoices/abc").status, 404);
    assert_eq!(body(&get(&f, &t, "/api/invoices?status=paid")).as_array().unwrap().len(), 0);

    let quotes = body(&get(&f, &t, "/api/quotes"));
    let qid = quotes[0]["id"].as_i64().unwrap();
    assert_eq!(body(&get(&f, &t, &format!("/api/quotes/{qid}")))["lines"].as_array().unwrap().len(), 1);
}

#[test]
fn search_with_wildcards_and_encoding_is_safe() {
    let f = fixture();
    let t = token_for(&f, "admin");
    assert_eq!(body(&get(&f, &t, "/api/invoices?q=%25")).as_array().unwrap().len(), 0);
    assert_eq!(body(&get(&f, &t, "/api/invoices?q=Cliente%20Celular")).as_array().unwrap().len(), 1);
    assert_eq!(body(&get(&f, &t, "/api/invoices?q=%27%3B%20DROP%20TABLE%20invoices%3B--")).as_array().unwrap().len(), 0);
    assert_eq!(body(&get(&f, &t, "/api/invoices")).as_array().unwrap().len(), 1);
    assert_eq!(url_decode("a%2"), "a%2");
    assert_eq!(url_decode("%C3%B1and%C3%BA"), "ñandú");
}

#[test]
fn role_permissions_are_enforced() {
    let f = fixture();
    // La vendedora ve facturas pero no cotizaciones (el rol semilla no las incluye en lectura
    // si así está configurado); lo que diga su perfil debe coincidir con lo que el servidor permite.
    let r = login(&f, "vendedora", PASS);
    let b = body(&r);
    let t = b["token"].as_str().unwrap().to_string();
    let modules: Vec<String> = serde_json::from_value(b["profile"]["modules"].clone()).unwrap();
    assert!(modules.contains(&"invoices".to_string()));
    assert_eq!(get(&f, &t, "/api/invoices").status, 200);
    let quotes_status = get(&f, &t, "/api/quotes").status;
    assert_eq!(quotes_status == 200, modules.contains(&"quotes".to_string()));
    if quotes_status != 200 {
        assert_eq!(quotes_status, 403);
    }

    // Bodega no tiene ni facturas ni cotizaciones: no puede entrar desde el celular.
    let r = login(&f, "bodeguero", PASS);
    assert_eq!(r.status, 403);
    assert!(body(&r).get("token").is_none());
}

#[test]
fn mobile_requests_never_touch_the_desktop_session() {
    let f = fixture();
    // El PC tiene abierta la sesión de la administradora (la del asistente inicial).
    assert_eq!(desktop_user(&f).as_deref(), Some("admin"));
    let t = token_for(&f, "vendedora");
    assert_eq!(get(&f, &t, "/api/invoices").status, 200);
    assert_eq!(desktop_user(&f).as_deref(), Some("admin"));

    // Con el PC sin sesión, el celular igual funciona y el PC sigue sin sesión.
    f.state.with_db(|db| {
        db.logout();
        Ok(())
    })
    .unwrap();
    assert_eq!(get(&f, &t, "/api/invoices").status, 200);
    assert_eq!(get(&f, &t, "/api/me").status, 200);
    assert_eq!(desktop_user(&f), None);
}

#[test]
fn mobile_is_read_only() {
    let f = fixture();
    let t = token_for(&f, "admin");
    let auth = format!("Bearer {}", t);
    for (m, url) in [("POST", "/api/invoices"), ("PUT", "/api/invoices/1"), ("DELETE", "/api/invoices/1"), ("POST", "/api/quotes")] {
        assert_eq!(handle(&f.state, &f.sessions, m, url, Some(&auth), b"{}").status, 405, "{m} {url}");
    }
    let count: i64 = f.state.with_db(|db| Ok(db.connect()?.query_row("SELECT COUNT(*) FROM invoices", [], |r| r.get(0)).unwrap())).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn deactivated_user_loses_access_and_logout_ends_session() {
    let f = fixture();
    let t = token_for(&f, "vendedora");
    f.state
        .with_db(|db| {
            let u = db.list_users()?.into_iter().find(|u| u.username == "vendedora").unwrap();
            db.save_user(&UserInput {
                id: Some(u.id),
                full_name: u.full_name,
                username: u.username,
                role_key: u.role_key,
                password: None,
                is_active: false,
            })?;
            Ok(())
        })
        .unwrap();
    assert_eq!(get(&f, &t, "/api/invoices").status, 401);
    assert_eq!(get(&f, &t, "/api/me").status, 401);

    let t2 = token_for(&f, "admin");
    let r = handle(&f.state, &f.sessions, "POST", "/api/logout", Some(&format!("Bearer {}", t2)), b"");
    assert_eq!(r.status, 200);
    assert_eq!(get(&f, &t2, "/api/me").status, 401);
}

#[test]
fn restricted_license_keeps_invoices_only() {
    // Licencia en modo restringido (vencida): solo lectura de facturas.
    let ent = crate::licensing::Entitlements { mode: crate::licensing::LicenseMode::Restricted, modules: Default::default() };
    assert!(check_gate(&ent, Gate::Read("invoices")).is_ok());
    assert!(check_gate(&ent, Gate::Read("quotes")).is_err());
}

#[test]
fn config_is_saved_in_the_database() {
    let f = fixture();
    f.state
        .with_db(|db| {
            assert_eq!(read_config(db)?, LanConfig { enabled: false, port: DEFAULT_PORT });
            save_config(db, LanConfig { enabled: true, port: 9000 })?;
            assert_eq!(read_config(db)?, LanConfig { enabled: true, port: 9000 });
            assert!(save_config(db, LanConfig { enabled: true, port: 80 }).is_err());
            assert_eq!(read_config(db)?.port, 9000);
            Ok(())
        })
        .unwrap();
}

#[test]
fn qr_code_is_svg() {
    let svg = qr_svg("http://192.168.1.20:8787/").unwrap();
    assert!(svg.contains("<svg"));
}

#[test]
fn real_http_server_end_to_end() {
    let f = Arc::new(fixture());
    let f2 = f.clone();
    let provider: StateProvider = Arc::new(move |cb: &mut dyn FnMut(&AppState)| cb(&f2.state));
    let mut ctl = LanController::default();
    let port = ctl.start(IpAddr::V4(Ipv4Addr::LOCALHOST), 0, provider).unwrap();
    assert!(ctl.is_running());
    let base = format!("http://127.0.0.1:{port}");
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build();

    let page = agent.get(&format!("{base}/")).call().unwrap();
    assert!(page.header("Content-Security-Policy").is_some());
    assert_eq!(page.header("X-Frame-Options"), Some("DENY"));

    let login: Value = agent
        .post(&format!("{base}/api/login"))
        .send_json(json!({ "username": "admin", "password": PASS }))
        .unwrap()
        .into_json()
        .unwrap();
    let token = login["token"].as_str().unwrap();
    let list: Value = agent
        .get(&format!("{base}/api/invoices"))
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .unwrap()
        .into_json()
        .unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(ctl.sessions.active_count(), 1);

    match agent.get(&format!("{base}/api/invoices")).call() {
        Err(ureq::Error::Status(401, _)) => {}
        other => panic!("se esperaba 401: {:?}", other.map(|r| r.status())),
    }
    let big = "x".repeat((MAX_BODY + 10) as usize);
    match agent.post(&format!("{base}/api/login")).send_string(&big) {
        Err(ureq::Error::Status(413, _)) => {}
        other => panic!("se esperaba 413: {:?}", other.map(|r| r.status())),
    }

    // Al detenerlo se cierran las sesiones y el puerto queda libre.
    ctl.stop();
    assert!(!ctl.is_running());
    assert_eq!(ctl.sessions.active_count(), 0);
    assert!(agent.get(&format!("{base}/")).call().is_err());
    let again = ctl
        .start(IpAddr::V4(Ipv4Addr::LOCALHOST), port, Arc::new(move |cb: &mut dyn FnMut(&AppState)| cb(&f.state)))
        .unwrap();
    assert_eq!(again, port);
    ctl.stop();
}

/// Servidor de demostración para revisar la página del celular en un navegador:
/// `CARTUCHO_DEMO_PORT=8799 cargo test lan::tests::demo_server -- --ignored --nocapture`
#[test]
#[ignore]
fn demo_server() {
    let f = Arc::new(fixture());
    f.state
        .with_db(|db| {
            let line = |d: &str, q: f64, p: i64, n: Option<&str>| DocumentLineInput {
                product_id: None, description: d.into(), quantity: q, unit_price: p, note: n.map(Into::into),
            };
            for (i, name) in ["Ferretería El Tornillo", "María Fernanda López", "Distribuciones Andina S.A.S.", "Café La Montaña"].iter().enumerate() {
                let inv = db.create_invoice(&InvoiceInput {
                    customer: Some(CustomerSnapshotInput { name: (*name).into(), document_id: Some(format!("900.12{}.456", i)), phone: Some("300 555 1234".into()), ..Default::default() }),
                    issue_date: format!("2026-11-{:02}", 5 + i),
                    due_date: Some(format!("2026-11-{:02}", 20 + i)),
                    lines: vec![line("Cartucho HP 664 negro", 2.0, 68_000, None), line("Recarga tóner láser", 1.0, 45_000, Some("Incluye limpieza del rodillo"))],
                    notes: Some("Gracias por su compra.".into()),
                    initial_payment: if i % 2 == 0 { Some(PaymentInput { amount: 181_000, method: "transfer".into(), paid_at: format!("2026-11-{:02}", 5 + i), note: None }) } else { None },
                    ..Default::default()
                })?;
                if i == 3 {
                    db.void_invoice(inv.summary.id, "Cliente canceló el pedido")?;
                }
            }
            Ok(())
        })
        .unwrap();
    let port: u16 = std::env::var("CARTUCHO_DEMO_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8799);
    let f2 = f.clone();
    let mut ctl = LanController::default();
    ctl.start(IpAddr::V4(Ipv4Addr::LOCALHOST), port, Arc::new(move |cb: &mut dyn FnMut(&AppState)| cb(&f2.state))).unwrap();
    println!("DEMO http://127.0.0.1:{port}/");
    std::thread::sleep(Duration::from_secs(900));
}

// ------------------------------------------------------------------ App de Android (RPC)

fn app_token(f: &Fixture, user: &str) -> String {
    let b = json!({ "username": user, "password": PASS, "client": "app" }).to_string();
    let r = handle(&f.state, &f.sessions, "POST", "/api/login", None, b.as_bytes());
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    body(&r)["token"].as_str().unwrap().to_string()
}

fn rpc(f: &Fixture, token: &str, cmd: &str, args: Value) -> HttpResponse {
    handle(&f.state, &f.sessions, "POST", &format!("/api/rpc/{}", cmd), Some(&format!("Bearer {}", token)), args.to_string().as_bytes())
}

#[test]
fn app_rpc_reads_with_the_user_role_and_writes_only_when_allowed() {
    let f = fixture();
    // Sin sesión no hay acceso.
    assert_eq!(handle(&f.state, &f.sessions, "POST", "/api/rpc/list_invoices", None, b"{}").status, 401);
    // El rol de bodega entra desde la app (aunque no vea facturas) y solo ve su módulo.
    let bodega = app_token(&f, "bodeguero");
    assert_eq!(rpc(&f, &bodega, "list_products", json!({})).status, 200);
    assert_eq!(rpc(&f, &bodega, "list_invoices", json!({ "filter": {} })).status, 403);

    let t = app_token(&f, "vendedora");
    let r = rpc(&f, &t, "list_invoices", json!({ "filter": {} }));
    assert_eq!(r.status, 200);
    assert_eq!(body(&r)["data"].as_array().unwrap().len(), 1);
    // Resumen del sistema con la sesión del celular (no la del PC).
    let r = rpc(&f, &t, "get_system_overview", json!({}));
    assert_eq!(body(&r)["data"]["currentUser"]["username"], "vendedora");
    // Opciones que solo existen en el PC.
    for cmd in ["restore_backup", "save_user", "set_lan_access", "complete_initial_setup", "no_existe"] {
        let r = rpc(&f, &t, cmd, json!({}));
        assert_eq!(r.status, 403, "{cmd}");
    }

    // Registrar: apagado por defecto.
    let sale = json!({ "input": {
        "customer": { "name": "Cliente App" }, "issueDate": "2026-11-12",
        "lines": [{ "description": "Venta desde el celular", "quantity": 1, "unitPrice": 12000 }],
        "initialPayment": { "amount": 12000, "method": "cash", "paidAt": "2026-11-12" }
    }});
    let r = rpc(&f, &t, "create_invoice", sale.clone());
    assert_eq!(r.status, 403);
    assert!(body(&r)["error"].as_str().unwrap().contains("Permitir registrar"));
    f.state.with_db(|db| save_writes_allowed(db, true)).unwrap();
    let r = rpc(&f, &t, "create_invoice", sale);
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    assert_eq!(body(&r)["data"]["balance"], 0);
    // Quedó a nombre de la vendedora y el PC sigue sin sesión.
    let (who, pc_session) = f.state.with_db(|db| {
        let who: Option<String> = db
            .connect()?
            .query_row("SELECT u.username FROM invoices i JOIN app_users u ON u.id = i.created_by ORDER BY i.id DESC LIMIT 1", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        Ok((who, db.require_authenticated_user().ok().map(|u| u.username)))
    }).unwrap();
    assert_eq!(who.as_deref(), Some("vendedora"));
    let pc_before = f.state.with_db(|db| Ok(db.require_authenticated_user().ok().map(|u| u.username))).unwrap();
    assert_eq!(pc_session, pc_before, "la sesión del PC no cambia");
    assert_ne!(pc_session.as_deref(), Some("vendedora"));
    // Su rol no puede borrar gastos (sin permiso de escritura en gastos).
    assert_eq!(rpc(&f, &t, "delete_expense", json!({ "id": 1 })).status, 403);
    // Datos mal formados.
    assert_eq!(rpc(&f, &t, "get_invoice", json!({ "id": "x" })).status, 400);
}

#[test]
fn ping_identifies_cartucho_without_login() {
    let f = fixture();
    let r = handle(&f.state, &f.sessions, "GET", "/api/ping", None, b"");
    assert_eq!(r.status, 200);
    assert_eq!(body(&r)["app"], "cartucho-erp");
}
