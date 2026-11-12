//! Cliente de la app de Android cuando la base principal está en el PC (ADR 0010).
//!
//! Las peticiones salen desde Rust (no desde la página), así no dependen de CORS ni de la
//! política de tráfico sin cifrar del WebView de Android. Solo se habla con direcciones de la
//! red local que el usuario escribió o eligió.

use serde_json::{json, Value};
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(15);

/// Normaliza lo que escribe el usuario: «192.168.1.20», «192.168.1.20:8787» o una URL.
pub fn normalize_base(input: &str) -> Result<String, String> {
    let s = input.trim().trim_end_matches('/');
    let s = s.strip_prefix("http://").unwrap_or(s);
    if s.starts_with("https://") || s.is_empty() || s.contains('/') || s.contains(' ') {
        return Err("Escribe la dirección del PC, por ejemplo 192.168.1.20:8787.".to_string());
    }
    let with_port = if s.rsplit_once(':').is_some_and(|(_, p)| p.parse::<u16>().is_ok()) {
        s.to_string()
    } else {
        format!("{}:{}", s, crate::lan::DEFAULT_PORT)
    };
    // Solo red local: evita mandar la contraseña a Internet por error.
    let addr = with_port
        .to_socket_addrs()
        .map_err(|_| "No se encontró esa dirección en la red.".to_string())?
        .next()
        .ok_or_else(|| "No se encontró esa dirección en la red.".to_string())?;
    if !is_local(addr.ip()) {
        return Err("La dirección debe ser de tu red local (por ejemplo 192.168.x.x).".to_string());
    }
    Ok(format!("http://{}", with_port))
}

fn is_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]),
        IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80,
    }
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(TIMEOUT).build()
}

fn read(res: Result<ureq::Response, ureq::Error>) -> Result<Value, String> {
    match res {
        Ok(r) => r.into_json::<Value>().map_err(|_| "Respuesta no válida del PC.".to_string()),
        Err(ureq::Error::Status(code, r)) => {
            let msg = r
                .into_json::<Value>()
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
                .unwrap_or_else(|| format!("El PC respondió con un error ({}).", code));
            // Prefijo reconocible para que la app vuelva a pedir el inicio de sesión.
            Err(if code == 401 { format!("SESION_PC: {}", msg) } else { msg })
        }
        Err(_) => Err("SIN_CONEXION: No se pudo conectar con el PC. Revisa que esté encendido, con Cartucho abierto y en la misma red WiFi.".to_string()),
    }
}

/// ¿Hay un Cartucho escuchando en esa dirección?
pub fn ping(base: &str) -> Result<Value, String> {
    let base = normalize_base(base)?;
    let v = read(agent().get(&format!("{}/api/ping", base)).timeout(Duration::from_secs(4)).call())?;
    if v.get("app").and_then(|a| a.as_str()) != Some("cartucho-erp") {
        return Err("En esa dirección no hay un PC con Cartucho ERP.".to_string());
    }
    let brand = read(agent().get(&format!("{}/api/brand", base)).call()).unwrap_or(Value::Null);
    Ok(json!({ "base": base, "version": v.get("version"), "tradeName": brand.get("tradeName"), "logoDataUrl": brand.get("logoDataUrl") }))
}

pub fn login(base: &str, username: &str, password: &str) -> Result<Value, String> {
    let base = normalize_base(base)?;
    let v = read(agent().post(&format!("{}/api/login", base)).send_json(json!({ "username": username, "password": password, "client": "app" })))?;
    Ok(json!({ "base": base, "token": v.get("token"), "profile": v.get("profile") }))
}

pub fn logout(base: &str, token: &str) {
    if let Ok(base) = normalize_base(base) {
        let _ = agent().post(&format!("{}/api/logout", base)).set("Authorization", &format!("Bearer {}", token)).call();
    }
}

pub fn rpc(base: &str, token: &str, command: &str, args: Value) -> Result<Value, String> {
    if !command.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
        return Err("Comando no válido.".to_string());
    }
    let base = normalize_base(base)?;
    let v = read(
        agent()
            .post(&format!("{}/api/rpc/{}", base, command))
            .set("Authorization", &format!("Bearer {}", token))
            .send_json(args),
    )?;
    Ok(v.get("data").cloned().unwrap_or(Value::Null))
}

/// Busca PCs con Cartucho en la red del teléfono (misma subred /24, puerto por defecto).
pub fn discover() -> Vec<Value> {
    let mine: Vec<std::net::Ipv4Addr> = crate::lan::local_ipv4_addresses();
    let Some(me) = mine.first().copied() else { return Vec::new() };
    let [a, b, c, _] = me.octets();
    let found = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let handles: Vec<_> = (0u8..8)
        .map(|chunk| {
            let found = found.clone();
            std::thread::spawn(move || {
                for d in (chunk as u16 * 32)..((chunk as u16 + 1) * 32) {
                    if d == 0 || d == 255 {
                        continue;
                    }
                    let ip = std::net::Ipv4Addr::new(a, b, c, d as u8);
                    let addr = std::net::SocketAddr::new(IpAddr::V4(ip), crate::lan::DEFAULT_PORT);
                    if std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
                        if let Ok(v) = ping(&addr.to_string()) {
                            found.lock().unwrap_or_else(|e| e.into_inner()).push(v);
                        }
                    }
                }
            })
        })
        .collect();
    for h in handles {
        let _ = h.join();
    }
    let v = found.lock().unwrap_or_else(|e| e.into_inner()).clone();
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_addresses_are_accepted() {
        assert_eq!(normalize_base("192.168.1.20").unwrap(), "http://192.168.1.20:8787");
        assert_eq!(normalize_base(" http://10.0.0.5:9000/ ").unwrap(), "http://10.0.0.5:9000");
        assert!(normalize_base("8.8.8.8").is_err());
        assert!(normalize_base("https://192.168.1.2").is_err());
        assert!(normalize_base("").is_err());
        assert!(normalize_base("192.168.1.2/api").is_err());
    }
}
