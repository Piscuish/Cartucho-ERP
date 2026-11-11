/**
 * Pantallas de acceso: asistente de primera ejecución, inicio de sesión y error de arranque.
 */
import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Eye, EyeOff, HardDrive, ImageIcon, Lock, RotateCcw, ShieldCheck, User } from "lucide-react";
import type { CompanyProfile, CompleteInitialSetupInput } from "@cartucho/shared";
import { errorMessage, greeting, initials } from "../lib/format";
import { Alert, Button, Field, ImagePicker } from "./ui";

// ------------------------------------------------------------------ Asistente inicial

const STEPS = [
  { title: "Tu empresa", icon: Building2 },
  { title: "Logotipo", icon: ImageIcon },
  { title: "Administrador", icon: User },
  { title: "Confirmar", icon: ShieldCheck },
];

function passwordScore(p: string): number {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

const STRENGTH = [
  { label: "Muy débil", color: "var(--danger)" },
  { label: "Débil", color: "var(--danger)" },
  { label: "Aceptable", color: "var(--warning)" },
  { label: "Buena", color: "var(--success)" },
  { label: "Excelente", color: "var(--success)" },
];

export function SetupWizard({ onComplete, existingCompany }: { onComplete: (input: CompleteInitialSetupInput) => Promise<void>; existingCompany: CompanyProfile | null }) {
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState({
    tradeName: existingCompany?.tradeName ?? "",
    legalName: existingCompany?.legalName ?? "",
    taxId: existingCompany?.taxId ?? "",
    phone: existingCompany?.phone ?? "",
    email: existingCompany?.email ?? "",
    address: existingCompany?.address ?? "",
  });
  const [logo, setLogo] = useState<{ base64: string; mime: string; dataUrl: string } | null>(null);
  const [admin, setAdmin] = useState({ fullName: "", username: "admin", password: "", passwordConfirm: "" });
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const score = passwordScore(admin.password);

  const validate = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!company.tradeName.trim()) e.tradeName = "Escribe el nombre de tu empresa o negocio.";
      if (company.email && !company.email.includes("@")) e.email = "Revisa el correo electrónico.";
    }
    if (s === 2) {
      if (!admin.fullName.trim()) e.fullName = "Escribe tu nombre.";
      if (admin.username.trim().length < 3) e.username = "Mínimo 3 caracteres.";
      else if (!/^[A-Za-z0-9._-]+$/.test(admin.username.trim())) e.username = "Solo letras, números, puntos y guiones, sin espacios.";
      if (admin.password.length < 8) e.password = "Mínimo 8 caracteres.";
      if (admin.password !== admin.passwordConfirm) e.passwordConfirm = "Las contraseñas no coinciden.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (validate(step)) setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const submit = async () => {
    if (!validate(0) || !validate(2)) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await onComplete({
        company: {
          ...company,
          logoBase64: logo?.base64 ?? null,
          logoMimeType: logo?.mime ?? null,
        },
        admin,
      });
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setC = (k: keyof typeof company) => (e: React.ChangeEvent<HTMLInputElement>) => setCompany({ ...company, [k]: e.target.value });

  return (
    <div className="wizard">
      <aside className="wizard-side">
        <div>
          <div className="sb-logo" style={{ width: 44, height: 44, marginBottom: 20 }}>
            CE
          </div>
          <div className="wizard-title">Bienvenido a Cartucho ERP</div>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>Configura tu negocio en menos de dos minutos. Todo se guarda en este equipo, sin Internet.</p>
        </div>
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className={`wizard-step ${i === step ? "is-active" : ""} ${i < step ? "is-done" : ""}`}>
              <span className="wizard-step-num">{i < step ? <Check size={14} /> : i + 1}</span>
              <span>{s.title}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "auto", fontSize: 12, color: "var(--sb-muted)" }}>
          <Lock size={12} style={{ verticalAlign: -1, marginRight: 6 }} />
          La contraseña se guarda cifrada con Argon2id.
        </div>
      </aside>

      <main className="wizard-main">
        <div className="wizard-panel" key={step}>
          {step === 0 && (
            <>
              <h2>Datos de tu empresa</h2>
              <p className="muted mb-16">Aparecerán en el inicio de sesión y en tus facturas. Puedes cambiarlos después.</p>
              <div className="form-grid">
                <Field label="Nombre comercial" error={errors.tradeName} className="span-all">
                  <input className={`input ${errors.tradeName ? "has-error" : ""}`} value={company.tradeName} onChange={setC("tradeName")} placeholder="Papelería El Cartucho" autoFocus />
                </Field>
                <Field label="Razón social" optional>
                  <input className="input" value={company.legalName} onChange={setC("legalName")} placeholder="El Cartucho S.A.S." />
                </Field>
                <Field label="NIT o documento" optional>
                  <input className="input" value={company.taxId} onChange={setC("taxId")} placeholder="901.234.567-8" />
                </Field>
                <Field label="Teléfono" optional>
                  <input className="input" value={company.phone} onChange={setC("phone")} placeholder="310 555 1234" />
                </Field>
                <Field label="Correo" optional error={errors.email}>
                  <input className="input" value={company.email} onChange={setC("email")} placeholder="ventas@miempresa.co" />
                </Field>
                <Field label="Dirección" optional className="span-all">
                  <input className="input" value={company.address} onChange={setC("address")} placeholder="Cra 7 # 45-12, Bogotá" />
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2>Logotipo</h2>
              <p className="muted mb-16">Se muestra al iniciar sesión, en el menú y en las facturas impresas. Es opcional.</p>
              <ImagePicker value={logo?.dataUrl ?? null} onChange={setLogo} onRemove={() => setLogo(null)} label="Subir logotipo" maxSide={600} preferPng size={120} />
            </>
          )}

          {step === 2 && (
            <>
              <h2>Cuenta de administrador</h2>
              <p className="muted mb-16">Con esta cuenta entrarás al programa cada vez que lo abras.</p>
              <div className="form-grid">
                <Field label="Tu nombre" error={errors.fullName} className="span-all">
                  <input className="input" value={admin.fullName} onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })} placeholder="Laura Gómez" autoFocus />
                </Field>
                <Field label="Usuario" error={errors.username} hint="Sin espacios. Ejemplo: admin" className="span-all">
                  <input className="input" value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} autoComplete="username" />
                </Field>
                <Field label="Contraseña" error={errors.password}>
                  <div className="input-group">
                    <input
                      className="input"
                      style={{ paddingLeft: 12, paddingRight: 40 }}
                      type={showPass ? "text" : "password"}
                      value={admin.password}
                      onChange={(e) => setAdmin({ ...admin, password: e.target.value })}
                      autoComplete="new-password"
                    />
                    <span className="input-suffix">
                      <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setShowPass((v) => !v)} aria-label="Mostrar contraseña">
                        {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </span>
                  </div>
                </Field>
                <Field label="Repite la contraseña" error={errors.passwordConfirm}>
                  <input className="input" type={showPass ? "text" : "password"} value={admin.passwordConfirm} onChange={(e) => setAdmin({ ...admin, passwordConfirm: e.target.value })} autoComplete="new-password" />
                </Field>
                {admin.password && (
                  <div className="span-all">
                    <div className="password-strength">
                      <span style={{ width: `${(score + 1) * 20}%`, background: STRENGTH[score].color }} />
                    </div>
                    <span className="field-hint">Seguridad: {STRENGTH[score].label}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2>Todo listo</h2>
              <p className="muted mb-16">Revisa los datos antes de crear tu espacio de trabajo.</p>
              <div className="card card-pad">
                <div className="row" style={{ gap: 16 }}>
                  <div className="auth-logo" style={{ width: 72, height: 72, borderRadius: 18, boxShadow: "none", border: "1px solid var(--border)" }}>
                    {logo ? <img src={logo.dataUrl} alt="" /> : <span style={{ fontWeight: 700, fontSize: 22, color: "var(--accent-text)" }}>{initials(company.tradeName)}</span>}
                  </div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{company.tradeName}</div>
                    <div className="muted">{[company.taxId, company.phone, company.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</div>
                  </div>
                </div>
                <div className="divider" />
                <dl className="kv">
                  <dt>Administrador</dt>
                  <dd>{admin.fullName}</dd>
                  <dt>Usuario</dt>
                  <dd>{admin.username}</dd>
                  <dt>Datos</dt>
                  <dd>Guardados en este equipo (SQLite)</dd>
                </dl>
              </div>
              {submitError && (
                <div className="mt-16">
                  <Alert tone="danger">{submitError}</Alert>
                </div>
              )}
            </>
          )}

          <div className="wizard-nav">
            <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStep((s) => Math.max(0, s - 1))} style={{ visibility: step === 0 ? "hidden" : "visible" }}>
              Atrás
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={next}>
                {step === 1 && !logo ? "Omitir por ahora" : "Continuar"} <ArrowRight size={16} />
              </Button>
            ) : (
              <Button variant="primary" size="lg" loading={busy} onClick={submit} icon={<Check size={16} />}>
                Crear y entrar
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ------------------------------------------------------------------ Inicio de sesión

export function LoginScreen({ company, onLogin }: { company: CompanyProfile | null; onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hello = useMemo(greeting, []);
  const name = company?.tradeName ?? "Cartucho ERP";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Escribe tu usuario y contraseña.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="auth-brand-top">
          <span className="sb-logo" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 11 }}>CE</span>
          Cartucho ERP
        </div>
        <div className="auth-company">
          <div className={`auth-logo ${company?.logoDataUrl ? "" : "is-initials"}`}>
            {company?.logoDataUrl ? <img src={company.logoDataUrl} alt={name} /> : initials(name)}
          </div>
          <div>
            <div className="auth-company-name">{name}</div>
            <div className="auth-company-sub">Facturación y gestión de tu negocio</div>
          </div>
        </div>
        <div className="auth-brand-foot">Tus datos se guardan en este equipo.</div>
      </section>

      <section className="auth-form-side">
        <form className="auth-form" onSubmit={submit}>
          <div>
            <div className="auth-greeting">{hello}</div>
            <p className="auth-hint">Ingresa para continuar en {name}.</p>
          </div>
          <Field label="Usuario">
            <div className="input-group">
              <User size={16} />
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" placeholder="admin" />
            </div>
          </Field>
          <Field label="Contraseña">
            <div className="input-group">
              <Lock size={16} />
              <input
                className="input"
                style={{ paddingRight: 40 }}
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
              />
              <span className="input-suffix">
                <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => setShow((v) => !v)} aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </span>
            </div>
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Entrar
          </Button>
        </form>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Error de arranque

export function StartupErrorScreen({ message, onRetry, onReset }: { message: string; onRetry: () => Promise<void>; onReset: () => Promise<void> }) {
  const [busy, setBusy] = useState<"retry" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = (kind: "retry" | "reset", fn: () => Promise<void>) => async () => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="center-screen">
      <div className="card card-pad" style={{ width: "min(560px, 92vw)" }}>
        <div className="empty-icon" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
          <HardDrive size={26} />
        </div>
        <h2 style={{ fontSize: 20 }}>No se pudo abrir la base de datos</h2>
        <p className="muted mt-8">{message}</p>
        <p className="muted mt-8" style={{ fontSize: 13 }}>
          Si moviste los datos a una memoria USB o disco externo, conéctalo y pulsa «Reintentar». Volver a la ubicación predeterminada no borra nada: solo deja de usar la carpeta configurada.
        </p>
        {error && (
          <div className="mt-16">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        <div className="row mt-24" style={{ justifyContent: "flex-end" }}>
          <Button variant="ghost" loading={busy === "reset"} onClick={run("reset", onReset)}>
            Usar ubicación predeterminada
          </Button>
          <Button variant="primary" icon={<RotateCcw size={16} />} loading={busy === "retry"} onClick={run("retry", onRetry)}>
            Reintentar
          </Button>
        </div>
      </div>
    </div>
  );
}
