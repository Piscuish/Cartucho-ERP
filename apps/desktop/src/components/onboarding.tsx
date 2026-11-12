/**
 * Pantallas de acceso: asistente de primera ejecución, inicio de sesión y error de arranque.
 */
import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Building2, Check, Database, Eye, EyeOff, FolderInput, FolderOpen, HardDrive, ImageIcon, Lock, Printer, RotateCcw, ShieldCheck, User } from "lucide-react";
import { MODULE_LABELS, type BusinessSettings, type CompanyProfile, type CompleteInitialSetupInput, type LicenseStatus, type PaperSize, type SetupDataMode, type SystemOverview } from "@cartucho/shared";
import { errorMessage, greeting, initials } from "../lib/format";
import { api, pickFolder } from "../services/systemClient";
import { PLAN_LABELS } from "../lib/access";
import { Alert, Button, Field, ImagePicker } from "./ui";
import { PAPER_OPTIONS, PaperIcon, PrintDialog, type PrintableDoc } from "./print";

// ------------------------------------------------------------------ Asistente inicial

const STEPS = [
  { title: "Base de datos", icon: Database },
  { title: "Tu empresa", icon: Building2 },
  { title: "Logotipo", icon: ImageIcon },
  { title: "Impresión", icon: Printer },
  { title: "Administrador", icon: User },
  { title: "Confirmar", icon: ShieldCheck },
];
// Índices de los pasos (más legible que números sueltos).
const S_DATA = 0, S_COMPANY = 1, S_LOGO = 2, S_PRINT = 3, S_ADMIN = 4, S_CONFIRM = 5;

const DATA_OPTIONS: { id: SetupDataMode; title: string; desc: string; icon: typeof Database }[] = [
  { id: "default", title: "En este equipo", desc: "Recomendado. Se guarda en la carpeta del programa y se respalda cada día.", icon: HardDrive },
  { id: "folder", title: "En otra carpeta", desc: "Por ejemplo, otro disco o una carpeta que se sincroniza con OneDrive o Google Drive.", icon: FolderOpen },
  { id: "existing", title: "Ya tengo una base de datos", desc: "De otro equipo o de una copia: elige la carpeta que contiene cartucho_erp.sqlite3.", icon: FolderInput },
];

const SAMPLE_SETTINGS: BusinessSettings = {
  invoicePrefix: "FAC-",
  invoiceNextNumber: 1,
  quotePrefix: "COT-",
  quoteNextNumber: 1,
  defaultDueDays: 0,
  defaultQuoteValidDays: 15,
  defaultNotes: "",
  defaultTerms: "",
  defaultFooter: "",
  paperSize: "letter",
  showLogoOnPrint: true,
};

/** Factura de ejemplo para la página de prueba de impresión. */
function samplePrintable(): PrintableDoc {
  const today = new Date().toISOString().slice(0, 10);
  return {
    kind: "invoice",
    number: "PRUEBA",
    issueDate: today,
    secondDate: null,
    status: "paid",
    customer: { name: "Consumidor final", documentId: null, phone: null, email: null, address: null },
    lines: [
      { id: 1, position: 1, productId: null, description: "Página de prueba de impresión", note: "Si se ve completa y centrada, la impresora quedó lista.", quantity: 1, unitPrice: 0, lineTotal: 0 },
    ],
    total: 0,
    paidAmount: 0,
    balance: 0,
    payments: [],
    notes: null,
    terms: null,
    footer: "Cartucho ERP · Prueba de impresión",
    voidReason: null,
  };
}

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

export function SetupWizard({
  onComplete,
  existingCompany,
  license,
  overview,
  onOverview,
}: {
  onComplete: (input: CompleteInitialSetupInput) => Promise<void>;
  existingCompany: CompanyProfile | null;
  license?: LicenseStatus | null;
  overview: SystemOverview;
  /** Se llama cuando cambia la base (por ejemplo, al usar una existente con usuarios). */
  onOverview: (o: SystemOverview) => void;
}) {
  const [step, setStep] = useState(0);
  // La licencia trae los datos de la empresa: el asistente se llena solo.
  const fromLicense = license?.company ?? null;
  const [company, setCompany] = useState({
    tradeName: existingCompany?.tradeName ?? fromLicense?.tradeName ?? "",
    legalName: existingCompany?.legalName ?? fromLicense?.legalName ?? "",
    taxId: existingCompany?.taxId ?? fromLicense?.taxId ?? "",
    phone: existingCompany?.phone ?? fromLicense?.phone ?? "",
    email: existingCompany?.email ?? fromLicense?.email ?? "",
    address: existingCompany?.address ?? fromLicense?.address ?? "",
  });
  const [dataMode, setDataMode] = useState<SetupDataMode>("default");
  const [dataDir, setDataDir] = useState<{ folder: string | null; existing: string | null }>({ folder: null, existing: null });
  const [dataPath, setDataPath] = useState(overview.database.appDataDir);
  const [paper, setPaper] = useState<PaperSize>("letter");
  const [testPrint, setTestPrint] = useState(false);
  const [logo, setLogo] = useState<{ base64: string; mime: string; dataUrl: string } | null>(null);
  const [admin, setAdmin] = useState({ fullName: "", username: "admin", password: "", passwordConfirm: "" });
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const score = passwordScore(admin.password);

  const validate = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === S_DATA && dataMode !== "default" && !dataDir[dataMode]) e.data = "Elige la carpeta.";
    if (s === S_COMPANY) {
      if (!company.tradeName.trim()) e.tradeName = "Escribe el nombre de tu empresa o negocio.";
      if (company.email && !company.email.includes("@")) e.email = "Revisa el correo electrónico.";
    }
    if (s === S_ADMIN) {
      if (!admin.fullName.trim()) e.fullName = "Escribe tu nombre.";
      if (admin.username.trim().length < 3) e.username = "Mínimo 3 caracteres.";
      else if (!/^[A-Za-z0-9._-]+$/.test(admin.username.trim())) e.username = "Solo letras, números, puntos y guiones, sin espacios.";
      if (admin.password.length < 8) e.password = "Mínimo 8 caracteres.";
      if (admin.password !== admin.passwordConfirm) e.passwordConfirm = "Las contraseñas no coinciden.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = async () => {
    if (!validate(step)) return;
    if (step === S_DATA) {
      // Se aplica la ubicación elegida antes de seguir (la base se crea o se abre ahí).
      setBusy(true);
      setSubmitError(null);
      try {
        const o = await api.setupDataLocation(dataMode, dataMode === "default" ? null : dataDir[dataMode]);
        setDataPath(o.database.appDataDir);
        if (o.hasAdminUser) {
          // Base existente con usuarios: no hace falta configurar nada más; pasa al inicio de sesión.
          onOverview(o);
          return;
        }
      } catch (err) {
        setSubmitError(errorMessage(err));
        return;
      } finally {
        setBusy(false);
      }
    }
    setSubmitError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const chooseFolder = async (mode: "folder" | "existing") => {
    const dir = await pickFolder(mode === "folder" ? "Carpeta donde se guardarán los datos" : "Carpeta que contiene la base de datos");
    if (dir) {
      setDataDir((d) => ({ ...d, [mode]: dir }));
      setDataMode(mode);
      setErrors({});
    }
  };

  const submit = async () => {
    if (!validate(S_COMPANY)) return setStep(S_COMPANY);
    if (!validate(S_ADMIN)) return setStep(S_ADMIN);
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
        paperSize: paper,
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
          {step === S_DATA && (
            <>
              <h2>¿Dónde guardamos tus datos?</h2>
              <p className="muted mb-16">Tus facturas, clientes y productos quedan en un archivo de este equipo. Puedes cambiarlo después en Configuración.</p>
              <div className="setup-options">
                {DATA_OPTIONS.map((o) => {
                  const chosen = o.id === "default" ? null : dataDir[o.id];
                  return (
                    <button
                      key={o.id}
                      type="button"
                      className={`setup-option ${dataMode === o.id ? "is-active" : ""}`}
                      onClick={() => (o.id === "default" || chosen ? setDataMode(o.id) : void chooseFolder(o.id))}
                    >
                      <span className="setup-option-icon">
                        <o.icon size={20} />
                      </span>
                      <span className="setup-option-body">
                        <span className="setup-option-title">{o.title}</span>
                        <span className="setup-option-desc">{o.desc}</span>
                        {o.id === "default" && dataMode === "default" && <span className="setup-option-path">{overview.database.appDataDir}</span>}
                        {chosen && <span className="setup-option-path">{chosen}</span>}
                      </span>
                      {o.id !== "default" && (
                        <span
                          className="btn btn-sm"
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void chooseFolder(o.id as "folder" | "existing");
                          }}
                        >
                          {chosen ? "Cambiar" : "Elegir carpeta"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {errors.data && <div className="field-error mt-8">{errors.data}</div>}
              <p className="subtle mt-16" style={{ fontSize: 12.5 }}>
                No uses una carpeta compartida en red para trabajar desde varios equipos a la vez: puede dañar los datos.
              </p>
              {submitError && (
                <div className="mt-16">
                  <Alert tone="danger">{submitError}</Alert>
                </div>
              )}
            </>
          )}

          {step === S_COMPANY && (
            <>
              <h2>Datos de tu empresa</h2>
              <p className="muted mb-16">Aparecerán en el inicio de sesión y en tus facturas. Puedes cambiarlos después.</p>
              {fromLicense && (
                <div className="mb-16">
                  <Alert tone="success">
                    Tomamos estos datos de tu licencia. Revísalos y corrige lo que haga falta.
                  </Alert>
                </div>
              )}
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

          {step === S_LOGO && (
            <>
              <h2>Logotipo</h2>
              <p className="muted mb-16">Se muestra al iniciar sesión, en el menú y en las facturas impresas. Es opcional.</p>
              <ImagePicker value={logo?.dataUrl ?? null} onChange={setLogo} onRemove={() => setLogo(null)} label="Subir logotipo" maxSide={600} preferPng size={120} />
            </>
          )}

          {step === S_PRINT && (
            <>
              <h2>Impresión</h2>
              <p className="muted mb-16">Elige el tamaño de hoja que más usas. Al imprimir siempre puedes cambiarlo.</p>
              <div className="paper-options">
                {PAPER_OPTIONS.map((p) => (
                  <button key={p.id} type="button" className={`paper-option ${paper === p.id ? "is-active" : ""}`} onClick={() => setPaper(p.id)}>
                    <PaperIcon id={p.id} />
                    <span>{p.label}</span>
                    <span className="subtle" style={{ fontSize: 11 }}>
                      {p.desc}
                    </span>
                  </button>
                ))}
              </div>
              <div className="setup-print-test mt-16">
                <div>
                  <div style={{ fontWeight: 600 }}>¿Ya conectaste la impresora?</div>
                  <div className="subtle" style={{ fontSize: 12.5 }}>
                    Imprime una página de prueba. La impresora se elige en la ventana de Windows y queda recordada.
                  </div>
                </div>
                <Button icon={<Printer size={16} />} onClick={() => setTestPrint(true)}>
                  Página de prueba
                </Button>
              </div>
            </>
          )}

          {step === S_ADMIN && (
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

          {step === S_CONFIRM && (
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
                  <dd style={{ wordBreak: "break-all" }}>{dataPath || "Carpeta predeterminada de este equipo"}</dd>
                  <dt>Hoja</dt>
                  <dd>{PAPER_OPTIONS.find((p) => p.id === paper)?.label}</dd>
                  {license && license.licensingEnabled && license.mode === "licensed" && (
                    <>
                      <dt>Licencia</dt>
                      <dd>
                        {PLAN_LABELS[license.plan ?? ""] ?? license.plan} · {license.modules.map((m) => MODULE_LABELS[m]).join(", ")}
                      </dd>
                    </>
                  )}
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
              <Button variant="primary" loading={busy} onClick={() => void next()}>
                {step === S_LOGO && !logo ? "Omitir por ahora" : step === S_DATA && dataMode === "existing" ? "Usar esta base" : "Continuar"} <ArrowRight size={16} />
              </Button>
            ) : (
              <Button variant="primary" size="lg" loading={busy} onClick={submit} icon={<Check size={16} />}>
                Crear y entrar
              </Button>
            )}
          </div>
        </div>
      </main>
      {testPrint && (
        <PrintDialog
          doc={samplePrintable()}
          company={{
            ...company,
            legalName: company.legalName || null,
            taxId: company.taxId || null,
            phone: company.phone || null,
            email: company.email || null,
            address: company.address || null,
            tradeName: company.tradeName || "Mi negocio",
            logoDataUrl: logo?.dataUrl ?? null,
            logoMimeType: logo?.mime ?? null,
            businessProfileKey: "",
            commercialPlanKey: "",
            enabledModuleKeys: [],
            enabledAddonKeys: [],
            createdAt: "",
            updatedAt: "",
          }}
          settings={{ ...SAMPLE_SETTINGS, paperSize: paper }}
          onClose={() => setTestPrint(false)}
        />
      )}
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
