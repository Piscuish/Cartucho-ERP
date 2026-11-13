/**
 * Configuración › Apariencia.
 *
 * Tres decisiones independientes, cada una en su pestaña:
 *  - Diseño del panel: cómo se distribuye la información (A, B o C). No cambia colores.
 *  - Tema de color: cómo se colorea (Blanco, Negro o Gris). No cambia la distribución.
 *  - Widgets: qué bloques aparecen y en qué orden.
 * La cuarta pestaña muestra la combinación antes de aplicarla. Nada de esto modifica datos
 * del negocio, permisos ni módulos.
 */
import { CSSProperties, DragEvent, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, GripVertical, LayoutDashboard, Palette, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ACCENTS, COLOR_THEMES, DASHBOARD_LAYOUTS, DEFAULT_APPEARANCE, DEFAULT_UI_PREFERENCES, LAYOUTS, WIDGET_SIZE_LABELS } from "@cartucho/shared";
import type { AccentId, Appearance, ColorThemeId, ColorThemeInfo, DashboardLayoutId, UiPreferences, WidgetId, WidgetSize } from "@cartucho/shared";
import type { PageProps } from "./views";
import { api } from "../services/systemClient";
import { errorMessage } from "../lib/format";
import { useAccess } from "../lib/access";
import { availableWidgets, visibleWidgets, widgetSize } from "../config/widgetCatalog";
import { Badge, Button, ConfirmDialog, Switch, useToast } from "./ui";

// ------------------------------------------------------------------ Vista previa (datos de ejemplo)

const DEMO_BARS = [38, 52, 47, 66, 74, 90];
const DEMO_LINE = "0,62 16,50 32,54 48,36 64,42 82,22 100,10";

/**
 * Miniatura de un diseño con un tema. Usa cifras de ejemplo: nunca muestra datos reales de
 * la empresa. El tema solo cambia los colores; el diseño solo cambia la distribución.
 */
export function DashPreview({ layout, theme, large = false }: { layout: DashboardLayoutId; theme: ColorThemeInfo; large?: boolean }) {
  const sw = theme.swatch;
  const vars = {
    "--p-bg": sw.bg,
    "--p-surface": sw.surface,
    "--p-border": sw.border,
    "--p-text": sw.text,
    "--p-text2": sw.text2,
    "--p-accent": sw.accent,
  } as CSSProperties;
  const kpi = (label: string, value: string) => (
    <div className="dp-card dp-kpi">
      <span className="dp-label">{label}</span>
      <span className="dp-value">{value}</span>
    </div>
  );
  const bars = (
    <div className="dp-card dp-chart">
      <span className="dp-label">Ingresos vs. gastos</span>
      <div className="dp-bars">
        {DEMO_BARS.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
  const line = (
    <div className="dp-card dp-chart">
      <span className="dp-label">Evolución de ventas</span>
      <svg viewBox="0 0 100 70" preserveAspectRatio="none" className="dp-line" aria-hidden="true">
        <polygon points={`${DEMO_LINE} 100,70 0,70`} />
        <polyline points={DEMO_LINE} />
      </svg>
    </div>
  );
  const ring = (
    <div className="dp-card dp-ring-card">
      <span className="dp-ring" />
    </div>
  );
  const list = (label: string) => (
    <div className="dp-card dp-list">
      <span className="dp-label">{label}</span>
      <i />
      <i />
      <i />
    </div>
  );
  return (
    <div className={`dp is-${layout} ${large ? "is-large" : ""}`} style={vars} role="img" aria-label={`Vista previa con datos de ejemplo: diseño ${DASHBOARD_LAYOUTS.find((l) => l.id === layout)?.label}, tema ${theme.label}`}>
      <div className="dp-side">
        <span className="dp-logo" />
        <i className="on" />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="dp-main">
        {layout === "columns" && (
          <>
            <div className="dp-row dp-4">
              {kpi("Ventas", "$ 24,5 M")}
              {kpi("Recibido", "$ 19,2 M")}
              {kpi("Gastos", "$ 8,6 M")}
              {kpi("Balance", "$ 10,6 M")}
            </div>
            <div className="dp-row dp-main-side">
              {bars}
              {list("Accesos rápidos")}
            </div>
            <div className="dp-row">{list("Últimas facturas")}</div>
          </>
        )}
        {layout === "analytics" && (
          <>
            <div className="dp-row dp-3">
              {kpi("Ventas", "$ 24,5 M")}
              {kpi("Recibido", "$ 19,2 M")}
              {kpi("Gastos", "$ 8,6 M")}
            </div>
            <div className="dp-row dp-main-side is-tall">
              {line}
              {list("Indicadores")}
            </div>
            <div className="dp-row dp-3">
              {ring}
              {ring}
              {list("Más vendidos")}
            </div>
          </>
        )}
        {layout === "widgets" && (
          <>
            <div className="dp-row dp-3">
              {ring}
              {kpi("Ventas", "$ 24,5 M")}
              {list("Por cobrar")}
            </div>
            <div className="dp-row dp-3 is-tall">
              {list("Más vendidos")}
              {list("Stock bajo")}
              <div className="dp-card dp-cal">
                <span className="dp-label">Calendario</span>
                <div>
                  {Array.from({ length: 21 }, (_, i) => (
                    <b key={i} className={i === 9 ? "on" : ""} />
                  ))}
                </div>
              </div>
            </div>
            <div className="dp-row">{line}</div>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Editor de widgets

/**
 * Lista para activar, ordenar y cambiar el tamaño de los widgets. Se puede reordenar
 * arrastrando o con los botones de subir y bajar (teclado).
 */
export function WidgetListEditor({ prefs, onChange }: { prefs: UiPreferences; onChange: (p: UiPreferences) => void }) {
  const access = useAccess();
  const available = availableWidgets(access);
  const shown = visibleWidgets(prefs, access);
  const shownIds = shown.map((w) => w.id);
  const hidden = available.filter((w) => !shownIds.includes(w.id));
  const [dragId, setDragId] = useState<WidgetId | null>(null);
  const [overId, setOverId] = useState<WidgetId | null>(null);
  const modular = prefs.dashboardLayout === "widgets";

  const setOrder = (ids: WidgetId[]) => onChange({ ...prefs, dashboardWidgets: ids });
  const move = (id: WidgetId, delta: number) => {
    const i = shownIds.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= shownIds.length) return;
    const next = [...shownIds];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const dropOn = (target: WidgetId) => {
    if (!dragId || dragId === target) return;
    const next = shownIds.filter((x) => x !== dragId);
    next.splice(next.indexOf(target), 0, dragId);
    setOrder(next);
  };
  const setSize = (id: WidgetId, size: WidgetSize) => onChange({ ...prefs, dashboardWidgets: shownIds, widgetSizes: { ...prefs.widgetSizes, [id]: size } });

  return (
    <div className="wl">
      <div className="wl-title">En tu panel ({shown.length})</div>
      {shown.length === 0 && <p className="widget-empty">No hay widgets en tu panel. Agrega alguno de la lista de abajo.</p>}
      <ul className="wl-list">
        {shown.map((w, idx) => {
          const used = modular || w.layouts.includes(prefs.dashboardLayout);
          return (
            <li
              key={w.id}
              className={`wl-item ${dragId === w.id ? "is-dragging" : ""} ${overId === w.id && dragId !== w.id ? "is-over" : ""}`}
              draggable
              onDragStart={(e: DragEvent) => {
                setDragId(w.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(w.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(w.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <span className="wl-grip" aria-hidden="true" title="Arrastra para reordenar">
                <GripVertical size={16} />
              </span>
              <div className="wl-main">
                <div className="wl-name">
                  {w.title} <Badge tone="neutral" dot={false}>{w.kind}</Badge>
                </div>
                <div className="wl-desc">{used ? w.description : "El diseño elegido no incluye este bloque; sí aparece en el diseño Modular."}</div>
              </div>
              {modular && w.sizes.length > 1 && (
                <select className="select wl-size" value={widgetSize(prefs, w)} aria-label={`Tamaño de ${w.title}`} onChange={(e) => setSize(w.id, e.target.value as WidgetSize)}>
                  {w.sizes.map((s) => (
                    <option key={s} value={s}>
                      {WIDGET_SIZE_LABELS[s]}
                    </option>
                  ))}
                </select>
              )}
              <div className="wl-actions">
                <button type="button" className="icon-btn" aria-label={`Subir ${w.title}`} title="Subir" disabled={idx === 0} onClick={() => move(w.id, -1)}>
                  <ArrowUp size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Bajar ${w.title}`} title="Bajar" disabled={idx === shown.length - 1} onClick={() => move(w.id, 1)}>
                  <ArrowDown size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label={`Quitar ${w.title} del panel`} title="Quitar del panel" onClick={() => setOrder(shownIds.filter((x) => x !== w.id))}>
                  <EyeOff size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {hidden.length > 0 && (
        <>
          <div className="wl-title mt-16">Disponibles para agregar ({hidden.length})</div>
          <ul className="wl-list">
            {hidden.map((w) => (
              <li key={w.id} className="wl-item is-off">
                <div className="wl-main">
                  <div className="wl-name">
                    {w.title} <Badge tone="neutral" dot={false}>{w.kind}</Badge>
                  </div>
                  <div className="wl-desc">{w.description}</div>
                </div>
                <Button size="sm" icon={<Plus size={14} />} onClick={() => setOrder([...shownIds, w.id])} aria-label={`Agregar ${w.title}`}>
                  Agregar
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="subtle mt-16" style={{ fontSize: 12.5 }}>
        Solo aparecen los bloques de los módulos activos a los que tu rol tiene acceso.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Pantalla

type ApTab = "layout" | "theme" | "widgets" | "preview";

const AP_TABS: { id: ApTab; label: string; icon: React.ReactNode }[] = [
  { id: "layout", label: "Diseño del panel", icon: <LayoutDashboard size={15} /> },
  { id: "theme", label: "Tema de color", icon: <Palette size={15} /> },
  { id: "widgets", label: "Widgets", icon: <SlidersHorizontal size={15} /> },
  { id: "preview", label: "Vista previa y restaurar", icon: <Eye size={15} /> },
];

const sameUi = (a: UiPreferences, b: UiPreferences) => JSON.stringify(a) === JSON.stringify(b);

export function AppearanceSettings({ overview, setOverview }: PageProps) {
  const toast = useToast();
  const access = useAccess();
  const saved = overview.preferences.ui ?? DEFAULT_UI_PREFERENCES;
  const [tab, setTab] = useState<ApTab>("layout");
  const [draft, setDraft] = useState<UiPreferences>(saved);
  const [asDefault, setAsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const dirty = !sameUi(draft, saved);

  // Tema efectivo cuando aún no se ha elegido uno: el que ya se está viendo.
  const currentTheme = (document.documentElement.dataset.palette as ColorThemeId | undefined) ?? "white";
  const themeId = draft.colorTheme ?? currentTheme;
  const theme = COLOR_THEMES.find((t) => t.id === themeId) ?? COLOR_THEMES[0];
  const layoutInfo = DASHBOARD_LAYOUTS.find((l) => l.id === draft.dashboardLayout) ?? DASHBOARD_LAYOUTS[0];

  const apply = async () => {
    setBusy(true);
    try {
      let next = await api.setUiPreferences(draft, false);
      if (asDefault && access.isAdmin) next = await api.setUiPreferences(draft, true);
      setOverview(next);
      setDraft(next.preferences.ui ?? draft);
      setAsDefault(false);
      toast(asDefault && access.isAdmin ? "Apariencia aplicada y guardada como predeterminada" : "Apariencia aplicada");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const next = await api.resetUiPreferences(false);
    setOverview(next);
    setDraft(next.preferences.ui ?? DEFAULT_UI_PREFERENCES);
    toast("Se restauraron los valores predeterminados");
  };

  return (
    <>
      <div className="card mb-16">
        <div className="card-body">
          <div className="form-section-title">Apariencia</div>
          <div className="form-section-desc">
            El <strong>diseño</strong> decide cómo se organiza tu panel de inicio; el <strong>tema</strong> decide los colores; los <strong>widgets</strong> deciden qué información aparece. Puedes combinar cualquier diseño con cualquier tema. Esta
            configuración es personal: cada usuario tiene la suya.
          </div>
          <div className="ap-tabs" role="tablist" aria-label="Secciones de apariencia">
            {AP_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {tab === "layout" && (
            <div role="tabpanel">
              <div className="choice-grid">
                {DASHBOARD_LAYOUTS.map((l) => {
                  const on = draft.dashboardLayout === l.id;
                  return (
                    <button key={l.id} type="button" className={`choice-card ${on ? "is-active" : ""}`} aria-pressed={on} onClick={() => setDraft({ ...draft, dashboardLayout: l.id })}>
                      <DashPreview layout={l.id} theme={theme} />
                      <span className="choice-name">
                        <span className="choice-letter">{l.letter}</span> {l.label}
                        {on && <Check size={16} color="var(--accent)" />}
                      </span>
                      <span className="choice-desc">{l.description}</span>
                      <ul className="choice-pros">
                        {l.advantages.map((a) => (
                          <li key={a}>
                            <Check size={13} aria-hidden="true" /> {a}
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>
              <p className="subtle mt-16" style={{ fontSize: 12.5 }}>
                Cambiar el diseño solo cambia la distribución del panel de inicio. No altera tus datos, permisos ni módulos.
              </p>
            </div>
          )}

          {tab === "theme" && (
            <div role="tabpanel">
              <div className="choice-grid">
                {COLOR_THEMES.map((t) => {
                  const on = themeId === t.id;
                  return (
                    <button key={t.id} type="button" className={`choice-card ${on ? "is-active" : ""}`} aria-pressed={on} onClick={() => setDraft({ ...draft, colorTheme: t.id })}>
                      <DashPreview layout={draft.dashboardLayout} theme={t} />
                      <span className="choice-name">
                        {t.label}
                        {on && <Check size={16} color="var(--accent)" />}
                      </span>
                      <span className="choice-desc">{t.description}</span>
                      <span className="theme-chips" aria-hidden="true">
                        {[t.swatch.bg, t.swatch.surface, t.swatch.border, t.swatch.text, t.swatch.accent].map((c, i) => (
                          <i key={i} style={{ background: c }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="subtle mt-16" style={{ fontSize: 12.5 }}>
                El tema se aplica a todas las pantallas. No mueve tarjetas, no cambia gráficas ni oculta widgets.
              </p>
            </div>
          )}

          {tab === "widgets" && (
            <div role="tabpanel">
              {draft.dashboardLayout !== "widgets" && (
                <p className="ap-note">
                  El diseño <strong>{layoutInfo.label}</strong> tiene posiciones fijas: aquí eliges qué bloques muestra. El orden y los tamaños libres son del diseño <strong>Modular</strong>.
                </p>
              )}
              <WidgetListEditor prefs={draft} onChange={setDraft} />
            </div>
          )}

          {tab === "preview" && (
            <div role="tabpanel">
              <div className="ap-preview">
                <DashPreview layout={draft.dashboardLayout} theme={theme} large />
                <div className="ap-preview-info">
                  <dl className="kv">
                    <dt>Diseño del panel</dt>
                    <dd>
                      {layoutInfo.letter} · {layoutInfo.label}
                    </dd>
                    <dt>Tema de color</dt>
                    <dd>{theme.label}</dd>
                    <dt>Widgets</dt>
                    <dd>{visibleWidgets(draft, access).length} en el panel</dd>
                  </dl>
                  <p className="subtle" style={{ fontSize: 12.5 }}>
                    La vista previa usa cifras de ejemplo, no los datos de tu empresa.
                  </p>
                  <Button icon={<RotateCcw size={16} />} onClick={() => setConfirmReset(true)}>
                    Restaurar valores predeterminados
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="drawer-footer ap-footer" style={{ borderRadius: "0 0 var(--radius-lg) var(--radius-lg)" }}>
          <span className="ap-footer-state" role="status">
            {dirty ? "Tienes cambios sin aplicar." : overview.preferences.uiPersonal ? "Estás usando tu apariencia personal." : "Estás usando la apariencia predeterminada de la instalación."}
          </span>
          {access.isAdmin && dirty && (
            <label className="ap-default">
              <input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} /> Usar también como predeterminada para los demás usuarios
            </label>
          )}
          <Button variant="ghost" disabled={!dirty || busy} onClick={() => setDraft(saved)}>
            Cancelar
          </Button>
          {tab !== "preview" && dirty && <Button onClick={() => setTab("preview")}>Vista previa</Button>}
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={apply}>
            Aplicar
          </Button>
        </div>
      </div>

      {access.isAdmin && <InstallationLook overview={overview} setOverview={setOverview} dark={theme.base === "dark"} />}

      {confirmReset && (
        <ConfirmDialog
          title="Restaurar la apariencia"
          text="Vuelves al diseño, tema y widgets predeterminados de la instalación. No se modifica ningún dato de tu empresa: facturas, clientes, productos y permisos quedan igual."
          confirmLabel="Restaurar"
          onConfirm={restore}
          onClose={() => setConfirmReset(false)}
        />
      )}
    </>
  );
}

/** Color principal y estilo del menú: valen para toda la instalación (solo administrador). */
function InstallationLook({ overview, setOverview, dark }: Pick<PageProps, "overview" | "setOverview"> & { dark: boolean }) {
  const toast = useToast();
  const ap = overview.preferences.appearance ?? DEFAULT_APPEARANCE;
  // Se aplica al instante (optimista) y luego se confirma con el backend.
  const save = async (patch: Partial<Appearance>) => {
    const before = overview;
    const next = { ...ap, ...patch };
    setOverview({ ...overview, preferences: { ...overview.preferences, appearance: next } });
    try {
      setOverview(await api.setAppearance(next));
    } catch (e) {
      setOverview(before);
      toast(errorMessage(e), "error");
    }
  };
  const checkColor = (id: AccentId) => (id === "mono" && dark ? "#111" : id === "ambar" && dark ? "#1c1302" : "#fff");
  return (
    <div className="card mb-16">
      <div className="card-body">
        <div className="form-section-title">Opciones de la instalación</div>
        <div className="form-section-desc">Valen para todos los usuarios de este equipo. Solo las cambia un administrador.</div>

        <div className="ap-subtitle">Color principal</div>
        <p className="subtle" style={{ margin: "0 0 10px", fontSize: 12.5 }}>
          Botones, opción activa del menú y enlaces. Verde, ámbar y rojo se reservan para estados.
        </p>
        <div className="swatch-row">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`accent-dot ${ap.accent === a.id ? "is-active" : ""}`}
              style={{ background: dark ? a.dark : a.light }}
              title={a.label}
              aria-label={`Color principal: ${a.label}`}
              aria-pressed={ap.accent === a.id}
              onClick={() => ap.accent !== a.id && save({ accent: a.id })}
            >
              {ap.accent === a.id && <Check size={16} color={checkColor(a.id)} strokeWidth={3} />}
            </button>
          ))}
        </div>

        <div className="ap-subtitle mt-16">Estilo del menú</div>
        <div className="menu-style-row">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" className={`menu-style ${ap.layout === l.id ? "is-active" : ""}`} aria-pressed={ap.layout === l.id} onClick={() => ap.layout !== l.id && save({ layout: l.id })}>
              <span className="menu-style-name">
                {l.label}
                {ap.layout === l.id && <Check size={15} color="var(--accent)" />}
              </span>
              <span className="menu-style-desc">{l.description}</span>
            </button>
          ))}
        </div>

        <div className="mt-16">
          <Switch checked={ap.tintedBorders} onChange={(v) => save({ tintedBorders: v })} label="Bordes del color principal" description="Tarjetas, campos y menú con bordes teñidos." />
        </div>
        <p className="subtle mt-16" style={{ fontSize: 12.5 }}>
          Atajos: Ctrl K para buscar · Ctrl B para contraer el menú.
        </p>
      </div>
    </div>
  );
}

