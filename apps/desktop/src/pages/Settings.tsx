import { CSSProperties, useEffect, useState } from "react";
import { Building2, Database, FolderInput, FolderOpen, HardDriveDownload, Info, KeyRound, Palette, Printer, RotateCcw, BadgeCheck, Check, Save, ShieldCheck } from "lucide-react";
import type { BusinessSettings, DataLocationInfo, PaperSize, ThemePreference } from "@cartucho/shared";
import { ACCENTS, APPEARANCE_PRESETS, DARK_BACKGROUNDS, DEFAULT_APPEARANCE, LAYOUTS, LIGHT_BACKGROUNDS } from "@cartucho/shared";
import type { AccentId, Appearance, AppearancePreset, LayoutId } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { SETTINGS_TABS, SettingsTab } from "../config/moduleRegistry";
import { api, isDesktop, pickBackupFile, pickFolder } from "../services/systemClient";
import { bytes, errorMessage, fmtDate, fmtDateTime } from "../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Field, ImagePicker, PageHeader, SkeletonRows, Switch, useToast } from "../components/ui";
import { PAPER_OPTIONS, PaperIcon } from "../components/print";
import { LicenseSettings } from "../components/license";
import { useAccess } from "../lib/access";

const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
  company: <Building2 size={16} />,
  billing: <Printer size={16} />,
  appearance: <Palette size={16} />,
  security: <KeyRound size={16} />,
  data: <Database size={16} />,
  license: <BadgeCheck size={16} />,
  about: <Info size={16} />,
};

export function SettingsPage(props: PageProps & { tab?: SettingsTab }) {
  const access = useAccess();
  // Con la licencia desactivada solo quedan las opciones que no modifican datos del negocio.
  const tabs = access.restricted ? SETTINGS_TABS.filter((t) => t.id !== "company" && t.id !== "billing") : SETTINGS_TABS;
  const [tab, setTab] = useState<SettingsTab>(props.tab ?? (access.restricted ? "license" : "company"));
  return (
    <div className="page">
      <PageHeader title="Configuración" subtitle="Datos de la empresa, facturación, apariencia, seguridad y respaldos." />
      <div className="settings-layout">
        <nav className="settings-nav">
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
              {TAB_ICONS[t.id]} {t.label}
            </button>
          ))}
        </nav>
        <div key={tab} style={{ animation: "page-in 200ms var(--ease)" }}>
          {tab === "company" && <CompanySettings {...props} />}
          {tab === "billing" && <BillingSettings />}
          {tab === "appearance" && <AppearanceSettings {...props} />}
          {tab === "security" && <SecuritySettings {...props} />}
          {tab === "data" && <DataSettings {...props} />}
          {tab === "license" && <LicenseSettings {...props} />}
          {tab === "about" && <AboutSettings {...props} />}
        </div>
      </div>
    </div>
  );
}

function Section({ title, desc, children, footer }: { title: string; desc?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="card mb-16">
      <div className="card-body">
        <div className="form-section-title">{title}</div>
        {desc && <div className="form-section-desc">{desc}</div>}
        {children}
      </div>
      {footer && <div className="drawer-footer" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>{footer}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Empresa

function CompanySettings({ overview, setOverview }: PageProps) {
  const toast = useToast();
  const c = overview.company!;
  const [form, setForm] = useState({ tradeName: c.tradeName, legalName: c.legalName ?? "", taxId: c.taxId ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "" });
  const [logo, setLogo] = useState<string | null>(c.logoDataUrl);
  const [newLogo, setNewLogo] = useState<{ base64: string; mime: string } | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setOverview(await api.saveCompany({ ...form, logoBase64: newLogo?.base64 ?? null, logoMimeType: newLogo?.mime ?? null, removeLogo }));
      setNewLogo(null);
      setRemoveLogo(false);
      toast("Datos de la empresa guardados");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Mi empresa"
      desc="Se muestran en el inicio de sesión, en el menú y en todos los documentos impresos."
      footer={
        <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={save}>
          Guardar cambios
        </Button>
      }
    >
      <div className="stack-lg">
        <ImagePicker
          value={logo}
          size={104}
          preferPng
          maxSide={600}
          label="Subir logotipo"
          onChange={(img) => {
            setLogo(img.dataUrl);
            setNewLogo(img);
            setRemoveLogo(false);
          }}
          onRemove={() => {
            setLogo(null);
            setNewLogo(null);
            setRemoveLogo(true);
          }}
        />
        <div className="form-grid">
          <Field label="Nombre comercial" className="span-all">
            <input className="input" value={form.tradeName} onChange={set("tradeName")} />
          </Field>
          <Field label="Razón social" optional>
            <input className="input" value={form.legalName} onChange={set("legalName")} />
          </Field>
          <Field label="NIT o documento" optional>
            <input className="input" value={form.taxId} onChange={set("taxId")} />
          </Field>
          <Field label="Teléfono" optional>
            <input className="input" value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="Correo" optional>
            <input className="input" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Dirección" optional className="span-all">
            <input className="input" value={form.address} onChange={set("address")} />
          </Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ Facturación

function BillingSettings() {
  const toast = useToast();
  const [s, setS] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getBusinessSettings().then(setS).catch((e) => setError(errorMessage(e)));
  }, []);
  if (!s) return error ? <Alert tone="danger">{error}</Alert> : <SkeletonRows />;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setS(await api.saveBusinessSettings(s));
      toast("Configuración de facturación guardada");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const num = (v: string) => Math.max(0, parseInt(v.replace(/\D/g, ""), 10) || 0);

  return (
    <>
      <Section title="Numeración" desc="Prefijo y siguiente consecutivo. Por seguridad, el número solo puede aumentar.">
        <div className="form-grid">
          <Field label="Prefijo de facturas" hint={`Próxima: ${s.invoicePrefix}${String(s.invoiceNextNumber).padStart(5, "0")}`}>
            <input className="input" value={s.invoicePrefix} onChange={(e) => setS({ ...s, invoicePrefix: e.target.value })} />
          </Field>
          <Field label="Siguiente número de factura">
            <input className="input num" value={s.invoiceNextNumber} onChange={(e) => setS({ ...s, invoiceNextNumber: num(e.target.value) })} />
          </Field>
          <Field label="Prefijo de cotizaciones" hint={`Próxima: ${s.quotePrefix}${String(s.quoteNextNumber).padStart(5, "0")}`}>
            <input className="input" value={s.quotePrefix} onChange={(e) => setS({ ...s, quotePrefix: e.target.value })} />
          </Field>
          <Field label="Siguiente número de cotización">
            <input className="input num" value={s.quoteNextNumber} onChange={(e) => setS({ ...s, quoteNextNumber: num(e.target.value) })} />
          </Field>
          <Field label="Días para el vencimiento" hint="0 = sin fecha de vencimiento (pago de contado).">
            <input className="input num" value={s.defaultDueDays} onChange={(e) => setS({ ...s, defaultDueDays: Math.min(365, num(e.target.value)) })} />
          </Field>
          <Field label="Días de validez de cotizaciones">
            <input className="input num" value={s.defaultQuoteValidDays} onChange={(e) => setS({ ...s, defaultQuoteValidDays: Math.min(365, num(e.target.value)) })} />
          </Field>
        </div>
      </Section>

      <Section title="Impresión" desc="Tamaño de hoja predeterminado. Al imprimir siempre puedes elegir otro.">
        <div className="paper-options">
          {PAPER_OPTIONS.map((p) => (
            <button key={p.id} className={`paper-option ${s.paperSize === p.id ? "is-active" : ""}`} onClick={() => setS({ ...s, paperSize: p.id as PaperSize })}>
              <PaperIcon id={p.id} />
              <span>{p.label}</span>
              <span className="subtle" style={{ fontSize: 11 }}>
                {p.desc}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-16">
          <Switch checked={s.showLogoOnPrint} onChange={(v) => setS({ ...s, showLogoOnPrint: v })} label="Mostrar logotipo en los documentos" />
        </div>
      </Section>

      <Section
        title="Textos por defecto"
        desc="Se agregan automáticamente a cada factura y cotización nueva (puedes editarlos en cada documento)."
        footer={
          <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={save}>
            Guardar cambios
          </Button>
        }
      >
        <div className="form-grid">
          <Field label="Notas" optional className="span-all">
            <textarea className="textarea" rows={2} value={s.defaultNotes} onChange={(e) => setS({ ...s, defaultNotes: e.target.value })} />
          </Field>
          <Field label="Condiciones" optional hint="Ej.: cuenta bancaria, garantía, políticas de cambio.">
            <textarea className="textarea" rows={4} value={s.defaultTerms} onChange={(e) => setS({ ...s, defaultTerms: e.target.value })} />
          </Field>
          <Field label="Pie de página" optional>
            <textarea className="textarea" rows={4} value={s.defaultFooter} onChange={(e) => setS({ ...s, defaultFooter: e.target.value })} />
          </Field>
        </div>
        {error && (
          <div className="mt-16">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Apariencia

function LayoutMini({ layout, colors, accent }: { layout: LayoutId; colors: { bg: string; surface: string; sidebar: string; line: string; text: string }; accent: string }) {
  const vars = {
    "--m-bg": colors.bg,
    "--m-surface": colors.surface,
    "--m-side": colors.sidebar,
    "--m-line": colors.line,
    "--m-text": colors.text,
    "--m-accent": accent,
  } as CSSProperties;
  const body = (
    <>
      <div className="lm-side">
        <div className="lm-logo" />
        <div className="lm-item on" />
        <div className="lm-item" />
        <div className="lm-item" />
        <div className="lm-item" />
      </div>
      <div className="lm-main">
        <div className="lm-row">
          <div className="lm-top" />
          <div className="lm-btn" />
        </div>
        <div className="lm-row">
          <div className="lm-card" />
          <div className="lm-card" />
          <div className="lm-card" />
        </div>
        <div className="lm-card big" />
      </div>
    </>
  );
  return (
    <div className={`lm is-${layout}`} style={vars}>
      {layout === "flotante" ? <div className="lm-inner">{body}</div> : body}
    </div>
  );
}

function AppearanceSettings({ overview, setOverview }: PageProps) {
  const toast = useToast();
  const current = overview.preferences.theme;
  const ap = overview.preferences.appearance ?? DEFAULT_APPEARANCE;
  const dark = document.documentElement.dataset.theme === "dark";
  const accentOf = (id: AccentId, isDark: boolean) => {
    const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
    return isDark ? a.dark : a.light;
  };
  const swatchNow = dark
    ? (DARK_BACKGROUNDS.find((b) => b.id === ap.bgDark) ?? DARK_BACKGROUNDS[0]).swatch
    : (LIGHT_BACKGROUNDS.find((b) => b.id === ap.bgLight) ?? LIGHT_BACKGROUNDS[0]).swatch;

  const save = async (patch: Partial<Appearance>, theme?: ThemePreference) => {
    try {
      setOverview(await api.setAppearance({ ...ap, ...patch }, theme));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const options: { id: ThemePreference; label: string; light: boolean | null }[] = [
    { id: "light", label: "Claro", light: true },
    { id: "dark", label: "Oscuro", light: false },
    { id: "system", label: "Según el sistema", light: null },
  ];
  const presetActive = (p: AppearancePreset) =>
    p.appearance.layout === ap.layout &&
    p.appearance.accent === ap.accent &&
    p.appearance.tintedBorders === ap.tintedBorders &&
    (p.theme === "dark" ? p.appearance.bgDark === ap.bgDark && dark : p.appearance.bgLight === ap.bgLight && !dark);

  return (
    <>
      <Section title="Combinaciones rápidas" desc="Un clic aplica diseño, fondo y color. Después puedes ajustar cada parte por separado.">
        <div className="ap-grid">
          {APPEARANCE_PRESETS.map((p) => {
            const isDark = p.theme === "dark";
            const sw = isDark
              ? DARK_BACKGROUNDS.find((b) => b.id === p.appearance.bgDark)!.swatch
              : LIGHT_BACKGROUNDS.find((b) => b.id === p.appearance.bgLight)!.swatch;
            const on = presetActive(p);
            return (
              <button key={p.id} type="button" className={`ap-card ${on ? "is-active" : ""}`} onClick={() => save(p.appearance, p.theme)}>
                <LayoutMini layout={p.appearance.layout} colors={sw} accent={accentOf(p.appearance.accent, isDark)} />
                <div className="ap-card-name">
                  {p.label}
                  {on && <Check size={16} color="var(--accent)" />}
                </div>
                <div className="ap-card-desc">{p.description}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Diseño" desc="La forma del menú, las tarjetas y las esquinas.">
        <div className="ap-grid">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" className={`ap-card ${ap.layout === l.id ? "is-active" : ""}`} onClick={() => ap.layout !== l.id && save({ layout: l.id })}>
              <LayoutMini layout={l.id} colors={swatchNow} accent={accentOf(ap.accent, dark)} />
              <div className="ap-card-name">
                {l.label}
                {ap.layout === l.id && <Check size={16} color="var(--accent)" />}
              </div>
              <div className="ap-card-desc">{l.description}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Tema" desc="Claro, oscuro o según la configuración de Windows. Cada uno usa su fondo elegido abajo.">
        <div className="theme-options">
          {options.map((o) => (
            <button
              key={o.id}
              className={`theme-option ${current === o.id ? "is-active" : ""}`}
              onClick={async () => {
                try {
                  setOverview(await api.setTheme(o.id));
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}
            >
              <div className="theme-swatch">
                <div className="s1" style={{ background: o.light === null ? "linear-gradient(180deg,#ffffff 50%,#0a0d13 50%)" : o.light ? "#ffffff" : "#0a0d13", borderRight: "1px solid #e4e7ec" }} />
                <div className="s2" style={{ background: o.light === null ? "linear-gradient(90deg,#f4f5f8 50%,#0e1117 50%)" : o.light ? "#f4f5f8" : "#0e1117" }}>
                  <div className="ln" style={{ width: "60%", background: "var(--accent)" }} />
                  <div className="ln" style={{ width: "80%", background: o.light === false ? "#262d3a" : "#d0d5dd" }} />
                  <div className="ln" style={{ width: "45%", background: o.light === false ? "#262d3a" : "#d0d5dd" }} />
                </div>
              </div>
              <span style={{ fontWeight: 500 }}>{o.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Fondo" desc="El color de la pantalla, las tarjetas y el menú. Al elegir uno se cambia al tema correspondiente.">
        <div className="ap-subtitle">Oscuros</div>
        <div className="swatch-row mb-16">
          {DARK_BACKGROUNDS.map((b) => (
            <BgSwatch key={b.id} label={b.label} sw={b.swatch} accent={accentOf(ap.accent, true)} active={ap.bgDark === b.id && dark} onClick={() => save({ bgDark: b.id }, dark ? undefined : "dark")} />
          ))}
        </div>
        <div className="ap-subtitle">Claros</div>
        <div className="swatch-row">
          {LIGHT_BACKGROUNDS.map((b) => (
            <BgSwatch key={b.id} label={b.label} sw={b.swatch} accent={accentOf(ap.accent, false)} active={ap.bgLight === b.id && !dark} onClick={() => save({ bgLight: b.id }, dark ? "light" : undefined)} />
          ))}
        </div>
      </Section>

      <Section title="Color de acento" desc="Botones, elemento activo del menú, enlaces y resaltados.">
        <div className="swatch-row">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`accent-dot ${ap.accent === a.id ? "is-active" : ""}`}
              style={{ background: dark ? a.dark : a.light }}
              title={a.label}
              aria-label={a.label}
              onClick={() => ap.accent !== a.id && save({ accent: a.id })}
            >
              {ap.accent === a.id && <Check size={16} color={a.id === "mono" && dark ? "#111" : a.id === "ambar" && dark ? "#1c1302" : "#fff"} strokeWidth={3} />}
            </button>
          ))}
        </div>
        <div className="mt-16">
          <Switch
            checked={ap.tintedBorders}
            onChange={(v) => save({ tintedBorders: v })}
            label="Bordes del color de acento"
            description="Tarjetas, campos y menú con bordes teñidos (por ejemplo, fondo negro con bordes azules)."
          />
        </div>
        <p className="subtle mt-16" style={{ fontSize: 12.5 }}>
          Atajos: Ctrl K para buscar · Ctrl B para contraer el menú.
        </p>
      </Section>
    </>
  );
}

function BgSwatch({
  label,
  sw,
  accent,
  active,
  onClick,
}: {
  label: string;
  sw: { bg: string; surface: string; sidebar: string; line: string };
  accent: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`bg-swatch ${active ? "is-active" : ""}`} onClick={onClick}>
      <span className="bg-swatch-box" style={{ background: sw.bg }}>
        <span style={{ width: "30%", background: sw.sidebar, borderRight: `1px solid ${sw.line}`, display: "flex", flexDirection: "column", gap: 4, padding: "8px 5px" }}>
          <span style={{ height: 4, borderRadius: 2, background: accent }} />
          <span style={{ height: 4, borderRadius: 2, background: sw.line }} />
        </span>
        <span style={{ flex: 1, padding: 7 }}>
          <span style={{ display: "block", height: "100%", borderRadius: 5, background: sw.surface, border: `1px solid ${sw.line}` }} />
        </span>
      </span>
      {label}
    </button>
  );
}

// ------------------------------------------------------------------ Seguridad

function SecuritySettings({ overview, setOverview }: PageProps) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = overview.currentUser!;

  const save = async () => {
    if (form.newPassword.length < 8) return setError("La nueva contraseña debe tener al menos 8 caracteres.");
    if (form.newPassword !== form.newPasswordConfirm) return setError("Las contraseñas nuevas no coinciden.");
    setBusy(true);
    setError(null);
    try {
      setOverview(await api.changePassword(form));
      setForm({ currentPassword: "", newPassword: "", newPasswordConfirm: "" });
      toast("Contraseña actualizada");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title="Tu cuenta">
        <dl className="kv">
          <dt>Nombre</dt>
          <dd>{user.fullName}</dd>
          <dt>Usuario</dt>
          <dd>{user.username}</dd>
          <dt>Rol</dt>
          <dd>
            <Badge tone="accent">Administrador</Badge>
          </dd>
          <dt>Último ingreso</dt>
          <dd>{fmtDateTime(user.lastLoginAt)}</dd>
        </dl>
      </Section>
      <Section
        title="Cambiar contraseña"
        desc="Tras 5 intentos fallidos de inicio de sesión, el acceso se bloquea 30 segundos."
        footer={
          <Button variant="primary" icon={<ShieldCheck size={16} />} loading={busy} onClick={save}>
            Actualizar contraseña
          </Button>
        }
      >
        <div className="form-grid">
          <Field label="Contraseña actual" className="span-all">
            <input className="input" type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="Nueva contraseña">
            <input className="input" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Repite la nueva contraseña">
            <input className="input" type="password" value={form.newPasswordConfirm} onChange={(e) => setForm({ ...form, newPasswordConfirm: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        {error && (
          <div className="mt-16">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
      </Section>
      <Alert tone="info">
        El inicio de sesión protege el acceso al programa, pero no cifra el archivo de la base de datos. Guarda tus respaldos en un lugar seguro.
      </Alert>
    </>
  );
}

// ------------------------------------------------------------------ Datos y respaldos

const BACKUP_KIND: Record<string, string> = {
  auto: "Automático",
  manual: "Manual",
  pre_migration: "Antes de actualizar",
  pre_restore: "Antes de restaurar",
  pre_move: "Antes de mover",
};

function DataSettings({ reloadOverview }: PageProps) {
  const toast = useToast();
  const [info, setInfo] = useState<DataLocationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "restore" | "move" | "use"; path: string } | null>(null);
  const [keep, setKeep] = useState("0");

  const load = () =>
    api
      .getDataLocation()
      .then((i) => {
        setInfo(i);
        setKeep(String(i.autoBackupKeep));
      })
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (!info) return error ? <Alert tone="danger">{error}</Alert> : <SkeletonRows />;
  const desktop = isDesktop();

  return (
    <>
      {!desktop && (
        <div className="mb-16">
          <Alert tone="warning" title="Vista previa en navegador">
            Estás usando la vista previa: los datos viven en este navegador y las funciones de archivos solo están disponibles en la aplicación de escritorio.
          </Alert>
        </div>
      )}
      {error && (
        <div className="mb-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <Section title="Ubicación de los datos" desc="Toda la información del negocio está en un único archivo SQLite en este equipo.">
        <div className="stack">
          <div className="row-between">
            <span className="muted">Carpeta actual</span>
            {info.isCustomLocation ? <Badge tone="info">Ubicación personalizada</Badge> : <Badge dot={false}>Predeterminada</Badge>}
          </div>
          <div className="path-box">{info.dataDir}</div>
          <div className="row" style={{ gap: 24, fontSize: 13 }}>
            <span>
              Base de datos: <strong>{bytes(info.databaseSizeBytes)}</strong>
            </span>
            <span>
              Respaldos: <strong>{bytes(info.backupsTotalBytes)}</strong> ({info.backups.length})
            </span>
          </div>
          <div className="row mt-8" style={{ flexWrap: "wrap" }}>
            <Button
              icon={<FolderOpen size={16} />}
              loading={busy === "move"}
              onClick={() =>
                run("move", async () => {
                  const dir = await pickFolder("Elige la carpeta nueva para los datos");
                  if (dir) setConfirm({ kind: "move", path: dir });
                })
              }
            >
              Mover a otra carpeta
            </Button>
            <Button
              icon={<FolderInput size={16} />}
              loading={busy === "use"}
              onClick={() =>
                run("use", async () => {
                  const dir = await pickFolder("Elige la carpeta que contiene cartucho_erp.sqlite3");
                  if (dir) setConfirm({ kind: "use", path: dir });
                })
              }
            >
              Usar una carpeta existente
            </Button>
          </div>
          <p className="subtle" style={{ fontSize: 12.5 }}>
            «Mover» copia los datos a la carpeta nueva y la deja en uso; la copia anterior se conserva. «Usar existente» sirve para abrir datos traídos de otro equipo. No uses carpetas de red compartidas: para varios equipos llegará el modo servidor.
          </p>
        </div>
      </Section>

      <Section title="Copias de seguridad" desc="Las copias se hacen con la API de respaldo de SQLite y se verifican antes de darlas por válidas.">
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Button
            variant="primary"
            icon={<HardDriveDownload size={16} />}
            loading={busy === "export"}
            onClick={() =>
              run("export", async () => {
                const dir = await pickFolder("¿Dónde guardar la copia? (por ejemplo, una memoria USB)");
                if (!dir) return;
                const path = await api.exportBackup(dir);
                toast(`Copia guardada en ${path}`);
              })
            }
          >
            Exportar copia…
          </Button>
          <Button
            icon={<Save size={16} />}
            loading={busy === "manual"}
            onClick={() =>
              run("manual", async () => {
                await api.createManualBackup();
                toast("Respaldo creado");
                await load();
              })
            }
          >
            Crear respaldo ahora
          </Button>
          <Button
            variant="danger"
            icon={<RotateCcw size={16} />}
            loading={busy === "restore"}
            onClick={() =>
              run("restore", async () => {
                const file = await pickBackupFile("Elige el archivo de respaldo a restaurar");
                if (file) setConfirm({ kind: "restore", path: file });
              })
            }
          >
            Restaurar…
          </Button>
        </div>

        <div className="divider" />
        <Switch
          checked={info.autoBackupEnabled}
          onChange={(v) => run("auto", async () => setInfo(await api.saveAutoBackup(v, Number(keep) || 0)))}
          label="Respaldo automático diario"
          description={info.lastAutoBackupDate ? `Último: ${fmtDate(info.lastAutoBackupDate)}. Se crea al abrir el programa una vez al día.` : "Se crea al abrir el programa una vez al día."}
        />
        {info.autoBackupEnabled && (
          <div className="row mt-16" style={{ alignItems: "flex-end" }}>
            <Field label="Respaldos automáticos a conservar" hint="0 = conservar todos. Los manuales y los previos a actualizaciones nunca se borran.">
              <input className="input num" style={{ width: 120 }} value={keep} onChange={(e) => setKeep(e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Button
              size="sm"
              loading={busy === "keep"}
              onClick={() =>
                run("keep", async () => {
                  setInfo(await api.saveAutoBackup(true, Number(keep) || 0));
                  toast("Política de respaldos guardada");
                })
              }
            >
              Guardar
            </Button>
          </div>
        )}

        {info.backups.length > 0 && (
          <>
            <div className="divider" />
            <div className="field-label mb-16" style={{ marginBottom: 8 }}>
              Respaldos en {info.backupsDir}
            </div>
            <div className="card list" style={{ maxHeight: 280, overflowY: "auto" }}>
              {info.backups.map((b) => (
                <div className="list-item" key={b.path}>
                  <div className="list-item-main">
                    <div className="cell-main" style={{ fontSize: 13 }}>
                      {fmtDateTime(b.modifiedAt)}
                    </div>
                    <div className="cell-sub">{b.fileName}</div>
                  </div>
                  <Badge dot={false}>{BACKUP_KIND[b.kind] ?? b.kind}</Badge>
                  <span className="subtle" style={{ fontSize: 12.5, minWidth: 64, textAlign: "right" }}>
                    {bytes(b.sizeBytes)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "restore", path: b.path })}>
                    Restaurar
                  </Button>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>

      {confirm?.kind === "restore" && (
        <ConfirmDialog
          title="¿Restaurar este respaldo?"
          text={
            <>
              Todos los datos actuales (facturas, clientes, productos, gastos y usuario) se reemplazarán por los del archivo:
              <div className="path-box mt-8">{confirm.path}</div>
              <div className="mt-8">Antes de hacerlo se guardará automáticamente una copia del estado actual. Después tendrás que iniciar sesión de nuevo.</div>
            </>
          }
          confirmLabel="Restaurar"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await api.restoreBackup(confirm.path);
            toast(`Datos restaurados. Copia previa en ${r.safetyBackupPath}`);
            await reloadOverview();
          }}
        />
      )}
      {confirm?.kind === "move" && (
        <ConfirmDialog
          title="¿Mover los datos a esta carpeta?"
          text={
            <>
              <div className="path-box">{confirm.path}</div>
              <div className="mt-8">Se creará una copia verificada allí y el programa empezará a usarla. La carpeta actual queda intacta con una nota explicativa.</div>
            </>
          }
          confirmLabel="Mover datos"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            setInfo(await api.moveDataLocation(confirm.path));
            toast("Datos movidos correctamente");
          }}
        />
      )}
      {confirm?.kind === "use" && (
        <ConfirmDialog
          title="¿Usar los datos de esta carpeta?"
          text={
            <>
              <div className="path-box">{confirm.path}</div>
              <div className="mt-8">El programa abrirá la base de datos de esa carpeta (se verifica antes). Tus datos actuales no se borran y se respaldan primero. Tendrás que iniciar sesión con el usuario de esa base.</div>
            </>
          }
          confirmLabel="Usar esta carpeta"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await api.useExistingDataLocation(confirm.path);
            await reloadOverview();
          }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------ Acerca de

function AboutSettings({ overview }: PageProps) {
  const db = overview.database;
  return (
    <>
      <Section title="Cartucho ERP" desc="Facturación y gestión para pequeñas empresas. Funciona sin Internet; tus datos se quedan en tu equipo.">
        <dl className="kv">
          <dt>Versión</dt>
          <dd>{overview.appVersion}</dd>
          <dt>Etapa</dt>
          <dd>{overview.phase}</dd>
          <dt>Modo</dt>
          <dd>{overview.runtimeMode === "tauri-desktop" ? "Aplicación de escritorio" : "Vista previa en navegador"}</dd>
          <dt>Sistema</dt>
          <dd>
            {overview.osPlatform} · {overview.osArch}
          </dd>
          <dt>Motor de datos</dt>
          <dd>
            SQLite {db.sqliteVersion} · {db.journalMode.toUpperCase()} · claves foráneas {db.foreignKeysEnabled ? "activas" : "inactivas"}
          </dd>
          <dt>Esquema</dt>
          <dd>v{db.schemaVersion}</dd>
          <dt>Aperturas</dt>
          <dd>{db.startupCount}</dd>
          <dt>Creada</dt>
          <dd>{fmtDateTime(db.firstInitializedAt)}</dd>
        </dl>
      </Section>
      <Alert tone="info" title="Preparado para crecer">
        La lógica del negocio vive en un núcleo independiente de la interfaz. Así se podrá añadir más adelante un modo servidor para trabajar desde varios equipos en red local y, después, sincronización en la nube, sin rehacer el programa.
      </Alert>
    </>
  );
}
