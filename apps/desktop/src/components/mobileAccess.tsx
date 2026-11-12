/**
 * Configuración › Celulares (solo administrador).
 *
 * Activa el servidor de red local para que los celulares de la misma red WiFi consulten
 * facturas y cotizaciones (ADR 0009). La lógica y las validaciones están en Rust.
 */
import { useEffect, useState } from "react";
import { Copy, Smartphone, Unplug } from "lucide-react";
import type { LanStatus } from "@cartucho/shared";
import { api } from "../services/systemClient";
import { errorMessage } from "../lib/format";
import { Alert, Badge, Button, Field, SkeletonRows, Switch, useToast } from "./ui";

export function MobileAccessSettings() {
  const toast = useToast();
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [port, setPort] = useState("");

  const refresh = (updatePort = false) =>
    api
      .getLanStatus()
      .then((s) => {
        setStatus(s);
        if (updatePort) setPort(String(s.port));
      })
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    void refresh(true);
    // Mantiene al día el número de celulares conectados.
    const t = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const run = async (key: string, fn: () => Promise<LanStatus>, ok?: string) => {
    setBusy(key);
    setError(null);
    try {
      const s = await fn();
      setStatus(s);
      setPort(String(s.port));
      if (ok && !s.error) toast(ok);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!status) return error ? <Alert tone="danger">{error}</Alert> : <SkeletonRows />;

  const portNumber = Number(port);
  const portValid = Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;
  const mainUrl = status.urls[0];

  return (
    <>
      {error && (
        <div className="mb-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="card mb-16">
        <div className="card-body">
          <div className="form-section-title">Acceso desde celulares</div>
          <div className="form-section-desc">
            Consulta facturas y cotizaciones desde el celular, conectado a la misma red WiFi que este PC. Desde el celular solo se consulta: no se crea ni se modifica nada.
          </div>
          <Switch
            checked={status.enabled}
            onChange={(v) =>
              void run("toggle", () => api.setLanAccess(v, portValid ? portNumber : status.port), v ? "Acceso desde celulares activado." : "Acceso desde celulares desactivado.")
            }
            label="Permitir consultas desde celulares"
            description={
              status.running
                ? "Activo. Se vuelve a abrir solo cada vez que inicias Cartucho en este PC."
                : "Apagado. Ningún equipo de la red puede conectarse a Cartucho."
            }
          />
          {status.error && (
            <div className="mt-8">
              <Alert tone="danger">{status.error}</Alert>
            </div>
          )}
          {status.enabled && (
            <div className="mt-16">
              <Switch
                checked={!!status.writesAllowed}
                onChange={(v) =>
                  void run("writes", () => api.setLanWrites(v), v ? "La app de Android ya puede registrar." : "La app de Android solo consulta.")
                }
                label="Permitir registrar desde la app de Android"
                description="Vender, cobrar, crear clientes, productos y gastos desde la app, con los permisos del rol de cada usuario. Apagado: la app solo consulta."
              />
            </div>
          )}
        </div>
      </div>

      {status.running && (
        <div className="card mb-16">
          <div className="card-body">
            <div className="row-between">
              <div className="form-section-title" style={{ marginBottom: 0 }}>
                Conectar un celular
              </div>
              <Badge tone={status.activeSessions > 0 ? "success" : "neutral"}>
                {status.activeSessions === 0
                  ? "Ningún celular conectado"
                  : status.activeSessions === 1
                    ? "1 sesión abierta"
                    : `${status.activeSessions} sesiones abiertas`}
              </Badge>
            </div>
            {mainUrl ? (
              <div className="row mt-8" style={{ gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
                {status.qrSvg && (
                  <div
                    aria-label={`Código QR de ${mainUrl}`}
                    style={{ width: 200, height: 200, flex: "none", borderRadius: 12, overflow: "hidden", background: "#fff", border: "1px solid var(--border)" }}
                    // El SVG lo genera el programa (Rust) a partir de la dirección del PC.
                    dangerouslySetInnerHTML={{ __html: status.qrSvg.replace("<svg", '<svg width="200" height="200"') }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 260 }}>
                  <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                    <li>Conecta el celular a la misma red WiFi que este PC.</li>
                    <li>Escanea el código con la cámara o escribe la dirección en Chrome.</li>
                    <li>Entra con tu usuario y contraseña de Cartucho.</li>
                    <li>
                      Para tenerlo como app: en Chrome toca <strong>⋮</strong> › <strong>Agregar a la pantalla principal</strong>.
                    </li>
                  </ol>
                  <div className="path-box mt-8 row-between" style={{ gap: 12 }}>
                    <strong style={{ fontSize: 16 }}>{mainUrl}</strong>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Copy size={14} />}
                      onClick={() =>
                        void navigator.clipboard?.writeText(mainUrl).then(
                          () => toast("Dirección copiada."),
                          () => toast("No se pudo copiar.", "error"),
                        )
                      }
                    >
                      Copiar
                    </Button>
                  </div>
                  {status.urls.length > 1 && (
                    <div className="muted mt-8" style={{ fontSize: 13 }}>
                      Si no abre, prueba con: {status.urls.slice(1).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-8">
                <Alert tone="warning" title="No se encontró una red local">
                  Conecta este PC a la red WiFi o por cable para que los celulares puedan encontrarlo.
                </Alert>
              </div>
            )}
            <div className="row mt-16" style={{ flexWrap: "wrap" }}>
              <Button
                icon={<Unplug size={16} />}
                loading={busy === "disconnect"}
                disabled={status.activeSessions === 0}
                onClick={() => void run("disconnect", () => api.disconnectLanDevices(), "Se cerró la sesión en todos los celulares.")}
              >
                Cerrar sesión en todos los celulares
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="card mb-16">
        <div className="card-body">
          <div className="form-section-title">Antes de usarlo</div>
          <div className="stack" style={{ gap: 10 }}>
            <Alert tone="info" title="Permiso de Windows">
              La primera vez, Windows preguntará si Cartucho ERP puede usar la red. Marca <strong>Redes privadas</strong> y toca <strong>Permitir</strong>. Si el celular no abre la página, revisa ese permiso en el Firewall de Windows.
            </Alert>
            <Alert tone="warning" title="Úsalo solo en tu red de confianza">
              La conexión dentro de la red local no va cifrada. Actívalo en la red de tu negocio o de tu casa, no en redes WiFi públicas o compartidas.
            </Alert>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
              <Smartphone size={14} style={{ verticalAlign: "-2px" }} /> Cada usuario ve solo lo que permite su rol. El PC debe estar encendido y con Cartucho abierto. Las sesiones de los celulares se cierran tras 12 horas sin uso.
            </div>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-body">
          <div className="form-section-title">Opciones avanzadas</div>
          <div className="row" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <Field label="Puerto" hint="Cámbialo solo si otro programa ya usa el 8787." error={port && !portValid ? "Usa un número entre 1024 y 65535." : undefined}>
              <input className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))} style={{ width: 140 }} />
            </Field>
            <Button
              loading={busy === "port"}
              disabled={!portValid || portNumber === status.port}
              onClick={() => void run("port", () => api.setLanAccess(status.enabled, portNumber), "Puerto actualizado.")}
            >
              Guardar puerto
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
