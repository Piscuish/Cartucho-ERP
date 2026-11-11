/**
 * Licencia: pantalla de activación (antes del asistente inicial) y pestaña «Licencia» en Configuración.
 */
import { FormEvent, useState } from "react";
import { BadgeCheck, Copy, KeyRound, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { ALL_MODULES, LicenseStatus, MODULE_LABELS } from "@cartucho/shared";
import type { PageProps } from "./views";
import { api } from "../services/systemClient";
import { errorMessage, fmtDateTime } from "../lib/format";
import { PLAN_LABELS } from "../lib/access";
import { Alert, Badge, Button, Field, Segmented, useToast } from "./ui";

/** Da formato CE-XXXX-XXXX-XXXX-XXXX mientras se escribe. */
function formatKeyInput(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length <= 2 && "CE".startsWith(clean)) return clean; // permite borrar por completo
  const body = clean.startsWith("CE") ? clean.slice(2) : clean;
  const groups = body.slice(0, 16).match(/.{1,4}/g) ?? [];
  return ["CE", ...groups].join("-");
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ Formulario de activación

function ActivationForm({ license, onActivated, compact }: { license: LicenseStatus; onActivated: (s: LicenseStatus) => void; compact?: boolean }) {
  const [method, setMethod] = useState<"online" | "offline">("online");
  const [key, setKey] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const status = method === "online" ? await api.activateOnline(key) : await api.activateOffline(code.trim());
      if (status.mode === "licensed") onActivated(status);
      else setError(status.message ?? "No se pudo activar la licencia.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} style={{ gap: 16 }}>
      <Segmented
        value={method}
        onChange={(v) => {
          setMethod(v);
          setError(null);
        }}
        options={[
          { value: "online", label: <><KeyRound size={14} /> Con clave</> },
          { value: "offline", label: <><WifiOff size={14} /> Sin Internet</> },
        ]}
      />
      {method === "online" ? (
        <>
          {!license.serverConfigured && (
            <Alert tone="warning">Esta copia no tiene servidor de licencias configurado. Usa la activación sin Internet.</Alert>
          )}
          <Field label="Clave de licencia" hint="Te la entrega tu proveedor. Este equipo necesita Internet solo para activarse.">
            <input
              className="input license-key-input"
              autoFocus={!compact}
              value={key}
              onChange={(e) => setKey(formatKeyInput(e.target.value))}
              placeholder="CE-XXXX-XXXX-XXXX-XXXX"
              spellCheck={false}
              autoComplete="off"
            />
          </Field>
        </>
      ) : (
        <>
          <Field label="Código de este equipo" hint="Envíaselo a tu proveedor; él te devuelve un código de activación.">
            <div className="device-code">
              <span>{license.deviceCode}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={<Copy size={14} />}
                onClick={async () => setCopied(await copy(license.deviceCode))}
              >
                {copied ? "Copiado" : "Copiar"}
              </Button>
            </div>
          </Field>
          <Field label="Código de activación">
            <textarea className="textarea" rows={4} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Pega aquí el código que te enviaron" spellCheck={false} />
          </Field>
        </>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        type="submit"
        variant="primary"
        size={compact ? "md" : "lg"}
        block={!compact}
        loading={busy}
        disabled={method === "online" ? key.length < 22 : code.trim().length < 20}
      >
        Activar
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ Pantalla de activación

export function ActivationScreen({ license, onActivated }: { license: LicenseStatus; onActivated: () => Promise<void> }) {
  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="auth-brand-top">
          <span className="sb-logo" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 11 }}>CE</span>
          Cartucho ERP
        </div>
        <div className="auth-company">
          <div className="auth-logo is-initials">
            <BadgeCheck size={34} />
          </div>
          <div>
            <div className="auth-company-name">Activa tu copia</div>
            <div className="auth-company-sub">Tu licencia define los módulos de tu instalación.</div>
          </div>
        </div>
        <div className="auth-brand-foot">Después de activarla funciona sin Internet; se valida sola cuando hay conexión.</div>
      </section>
      <section className="auth-form-side">
        <div className="auth-form">
          <div>
            <div className="auth-greeting">Bienvenido</div>
            <p className="auth-hint">{license.message ?? "Ingresa la clave que te entregó tu proveedor."}</p>
          </div>
          <ActivationForm license={license} onActivated={() => void onActivated()} />
          {license.support && <p className="subtle" style={{ fontSize: 13 }}>¿Necesitas ayuda? {license.support}</p>}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Configuración › Licencia

const MODE_BADGE: Record<LicenseStatus["mode"], { tone: string; label: string }> = {
  licensed: { tone: "success", label: "Activa" },
  restricted: { tone: "danger", label: "Desactivada" },
  unlicensed: { tone: "warning", label: "Sin activar" },
  dev: { tone: "info", label: "Desarrollo" },
};

export function LicenseSettings({ overview, reloadOverview }: PageProps) {
  const toast = useToast();
  const [lic, setLic] = useState<LicenseStatus | null>(overview.license ?? null);
  const [checking, setChecking] = useState(false);
  const [changing, setChanging] = useState(false);

  if (!lic) {
    return <Alert tone="info">Esta versión no informa el estado de la licencia.</Alert>;
  }

  const badge = MODE_BADGE[lic.mode];
  const enabled = new Set(lic.modules);

  const check = async () => {
    setChecking(true);
    try {
      const s = await api.checkLicense();
      setLic(s);
      await reloadOverview();
      if (s.lastCheckError) toast(s.lastCheckError, "error");
      else toast("Licencia validada");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      {lic.mode === "restricted" && (
        <Alert tone="danger" title="Contacta a soporte">
          {lic.message}
          {lic.support && <div style={{ marginTop: 6 }}><strong>Soporte:</strong> {lic.support}</div>}
        </Alert>
      )}
      <div className="card mb-16 mt-16">
        <div className="card-body">
          <div className="row-between mb-16">
            <div>
              <div className="form-section-title">Licencia</div>
              <div className="form-section-desc" style={{ margin: 0 }}>
                {lic.mode === "dev" ? "Compilación de desarrollo: todos los módulos habilitados, sin validar licencia." : "Controla qué módulos tiene esta instalación."}
              </div>
            </div>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <dl className="kv">
            {lic.customer && (
              <>
                <dt>Cliente</dt>
                <dd>{lic.customer}</dd>
              </>
            )}
            {lic.plan && (
              <>
                <dt>Plan</dt>
                <dd>{PLAN_LABELS[lic.plan] ?? lic.plan}</dd>
              </>
            )}
            {lic.licenseKeyMasked && (
              <>
                <dt>Clave</dt>
                <dd className="num">{lic.licenseKeyMasked}</dd>
              </>
            )}
            {lic.maxDevices != null && (
              <>
                <dt>Equipos permitidos</dt>
                <dd>{lic.maxDevices}</dd>
              </>
            )}
            <dt>Código del equipo</dt>
            <dd className="num">{lic.deviceCode}</dd>
            {lic.validUntil && (
              <>
                <dt>Válida sin conexión hasta</dt>
                <dd>
                  {fmtDateTime(lic.validUntil)}
                  {lic.daysLeft != null && <span className="subtle"> · {lic.daysLeft} {lic.daysLeft === 1 ? "día" : "días"}</span>}
                </dd>
              </>
            )}
            {lic.licenseExpiresAt && (
              <>
                <dt>Vence</dt>
                <dd>{fmtDateTime(lic.licenseExpiresAt)}</dd>
              </>
            )}
            {lic.lastCheckAt && (
              <>
                <dt>Última validación</dt>
                <dd>{fmtDateTime(lic.lastCheckAt)}</dd>
              </>
            )}
          </dl>
          {lic.lastCheckError && lic.mode !== "restricted" && (
            <div className="mt-16">
              <Alert tone="warning">{lic.lastCheckError}</Alert>
            </div>
          )}
        </div>
        {lic.mode !== "dev" && (
          <div className="drawer-footer" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
            {lic.serverConfigured && lic.licenseKeyMasked && (
              <Button icon={<RefreshCw size={16} />} loading={checking} onClick={check}>
                Validar ahora
              </Button>
            )}
            <Button variant={lic.mode === "licensed" ? "ghost" : "primary"} icon={<KeyRound size={16} />} onClick={() => setChanging((v) => !v)}>
              {lic.mode === "licensed" ? "Cambiar clave" : "Activar licencia"}
            </Button>
          </div>
        )}
      </div>

      {changing && (
        <div className="card mb-16">
          <div className="card-body">
            <div className="form-section-title">Activar una licencia</div>
            <ActivationForm
              compact
              license={lic}
              onActivated={async (s) => {
                setLic(s);
                setChanging(false);
                await reloadOverview();
                toast("Licencia activada");
              }}
            />
          </div>
        </div>
      )}

      <div className="card mb-16">
        <div className="card-body">
          <div className="form-section-title">Módulos</div>
          <div className="form-section-desc">Los módulos los define tu licencia. Para agregar más, contacta a tu proveedor.</div>
          <div className="module-grid">
            {ALL_MODULES.map((m) => (
              <div key={m} className={`module-chip ${enabled.has(m) ? "is-on" : ""}`}>
                {enabled.has(m) ? <BadgeCheck size={16} /> : <ShieldAlert size={16} />}
                <span>{MODULE_LABELS[m]}</span>
                {lic.mode === "restricted" && m === "invoices" && <span className="subtle" style={{ fontSize: 12 }}>solo lectura</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
