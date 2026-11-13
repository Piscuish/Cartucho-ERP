import { Fragment, ReactNode, useEffect, useState } from "react";
import { ArrowRight, Check, ChevronRight, LayoutGrid, LifeBuoy, SlidersHorizontal, X } from "lucide-react";
import { DEFAULT_UI_PREFERENCES } from "@cartucho/shared";
import type { InvoiceSummary, UiPreferences, WidgetId } from "@cartucho/shared";
import { useAccess } from "../lib/access";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAsync } from "../lib/hooks";
import { addDays, errorMessage, fmtDate, greeting, isOverdue, money, monthStart, todayISO } from "../lib/format";
import { Alert, Button, Drawer, EmptyState, Field, InvoiceStatusBadge, Segmented, SkeletonRows, useToast } from "../components/ui";
import { renderWidget, WidgetContext } from "../components/dashboardWidgets";
import { WidgetListEditor } from "../components/appearance";
import { NAV_DESCRIPTION, NAVIGATION } from "../config/moduleRegistry";
import { visibleWidgets, WidgetInfo, widgetSize } from "../config/widgetCatalog";

// ------------------------------------------------------------------ Periodo

type PeriodId = "today" | "7d" | "30d" | "month" | "year" | "custom";

const PERIODS: { value: PeriodId; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "month", label: "Este mes" },
  { value: "year", label: "Este año" },
  { value: "custom", label: "Rango" },
];

interface PeriodState {
  id: PeriodId;
  from: string;
  to: string;
}

const PERIOD_KEY = "cartucho_dashboard_period";

function loadPeriod(today: string): PeriodState {
  try {
    const raw = JSON.parse(localStorage.getItem(PERIOD_KEY) ?? "null") as Partial<PeriodState> | null;
    if (raw && PERIODS.some((p) => p.value === raw.id)) {
      // Un rango personalizado guardado se conserva; los relativos se recalculan cada día.
      if (raw.id === "custom" && raw.from && raw.to && raw.from <= raw.to) return { id: "custom", from: raw.from, to: raw.to };
      if (raw.id !== "custom") return { id: raw.id!, from: monthStart(today), to: today };
    }
  } catch {
    /* preferencia opcional */
  }
  return { id: "month", from: monthStart(today), to: today };
}

function periodRange(p: PeriodState, today: string): { from: string; to: string; label: string } {
  switch (p.id) {
    case "today":
      return { from: today, to: today, label: "Hoy" };
    case "7d":
      return { from: addDays(today, -6), to: today, label: "Últimos 7 días" };
    case "30d":
      return { from: addDays(today, -29), to: today, label: "Últimos 30 días" };
    case "year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "Este año" };
    case "custom":
      return { from: p.from, to: p.to, label: `${fmtDate(p.from)} – ${fmtDate(p.to)}` };
    default:
      return { from: monthStart(today), to: today, label: "Este mes" };
  }
}

// ------------------------------------------------------------------ Página

export function DashboardPage({ navigate, overview, setOverview }: PageProps) {
  const today = todayISO();
  const access = useAccess();
  const toast = useToast();
  // Las cifras del inicio salen de las facturas: un rol sin acceso a Facturas ve sus módulos.
  const withFigures = access.can("invoices");
  const [period, setPeriod] = useState<PeriodState>(() => loadPeriod(today));
  const range = periodRange(period, today);
  const { data, loading, error } = useAsync(
    () => (withFigures ? api.dashboard(today, range.from, range.to) : Promise.resolve(null)),
    [today, withFigures, range.from, range.to],
  );
  const firstName = overview.currentUser?.fullName.split(" ")[0] ?? "";
  const savedUi = overview.preferences.ui ?? DEFAULT_UI_PREFERENCES;
  // Mientras se personaliza, el panel muestra el borrador; solo se guarda al confirmar.
  const [draft, setDraft] = useState<UiPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const ui = draft ?? savedUi;

  useEffect(() => {
    try {
      localStorage.setItem(PERIOD_KEY, JSON.stringify(period));
    } catch {
      /* preferencia opcional */
    }
  }, [period]);

  if (!withFigures && !access.restricted) {
    return (
      <div className="page">
        <div className="hero">
          <div>
            <div className="hero-greeting">
              {greeting()}, {firstName}
            </div>
            <p className="muted">Estos son los módulos a los que tienes acceso.</p>
          </div>
        </div>
        <ModuleTiles navigate={navigate} />
      </div>
    );
  }

  if (access.restricted) {
    return <RestrictedDashboard navigate={navigate} overview={overview} recent={data?.recentInvoices ?? []} loading={loading} />;
  }

  const saveWidgets = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      setOverview(await api.setUiPreferences(draft, false));
      setDraft(null);
      toast("Tu panel quedó guardado");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const ctx: WidgetContext | null = data
    ? { data, scope: data.scope ?? { expenses: access.can("expenses"), finance: access.isAdmin || access.can("finance"), inventory: access.can("inventory") }, access, navigate, periodLabel: range.label }
    : null;
  const visible = visibleWidgets(ui, access);

  return (
    <div className="page is-wide dash-page">
      <div className="hero dash-hero">
        <div>
          <div className="hero-greeting">
            {greeting()}, {firstName}
          </div>
          <p className="muted">
            Resumen de {overview.company?.tradeName} · {range.label.toLowerCase()}
          </p>
        </div>
        <div className="dash-controls">
          <Segmented options={PERIODS} value={period.id} onChange={(id) => setPeriod((p) => ({ ...p, id }))} />
          <Button
            variant={ui.dashboardLayout === "widgets" ? "primary" : "secondary"}
            icon={<SlidersHorizontal size={16} />}
            onClick={() => setDraft({ ...savedUi, dashboardWidgets: visibleWidgets(savedUi, access).map((w) => w.id) })}
          >
            Personalizar
          </Button>
        </div>
      </div>

      {period.id === "custom" && (
        <div className="dash-range card">
          <Field label="Desde">
            <input className="input" type="date" value={period.from} max={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} />
          </Field>
          <Field label="Hasta">
            <input className="input" type="date" value={period.to} min={period.from} max={today} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} />
          </Field>
          <p className="subtle">La variación compara con el periodo anterior de igual duración.</p>
        </div>
      )}

      {error && (
        <Alert tone="danger" title="No se pudo cargar el panel">
          {error}
        </Alert>
      )}

      {data && <GettingStarted navigate={navigate} hasLogo={!!overview.company?.logoDataUrl} products={data.productCount} customers={data.customerCount} invoices={data.recentInvoices.length} />}

      {loading && !data ? (
        <div className="card" aria-busy="true">
          <SkeletonRows rows={6} />
        </div>
      ) : ctx ? (
        <div className={loading ? "dash-body is-loading" : "dash-body"} aria-busy={loading}>
          {visible.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<LayoutGrid size={24} />}
                title="Tu panel está vacío"
                text="Elige qué indicadores, gráficas y listas quieres ver al abrir Cartucho."
                action={
                  <Button variant="primary" onClick={() => setDraft({ ...savedUi, dashboardWidgets: [] })}>
                    Agregar widgets
                  </Button>
                }
              />
            </div>
          ) : ui.dashboardLayout === "analytics" ? (
            <AnalyticsLayout ctx={ctx} visible={visible} />
          ) : ui.dashboardLayout === "widgets" ? (
            <WidgetsLayout ctx={ctx} visible={visible} ui={ui} />
          ) : (
            <ColumnsLayout ctx={ctx} visible={visible} />
          )}
        </div>
      ) : null}

      {draft && (
        <Drawer
          title="Personalizar el panel"
          subtitle="Activa, ordena y cambia el tamaño de los bloques. Los cambios se aplican al guardar."
          onClose={() => setDraft(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button variant="primary" loading={saving} onClick={saveWidgets}>
                Guardar mi panel
              </Button>
            </>
          }
        >
          <WidgetListEditor prefs={draft} onChange={setDraft} />
          <p className="subtle mt-16" style={{ fontSize: 12.5 }}>
            Para cambiar el diseño del panel o el tema de color ve a{" "}
            <button type="button" className="link-btn" onClick={() => navigate({ page: "settings", tab: "appearance" })}>
              Configuración › Apariencia
            </button>
            .
          </p>
        </Drawer>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Diseños del panel
// Cada diseño es una distribución distinta de los mismos widgets. Ninguno define colores.

interface LayoutProps {
  ctx: WidgetContext;
  visible: WidgetInfo[];
}

const KPI_IDS: WidgetId[] = ["salesKpi", "collectedKpi", "expensesKpi", "balanceKpi", "receivableKpi"];

/** Dibuja los widgets pedidos que estén visibles y tengan datos para el usuario. */
function useSlots({ ctx, visible }: LayoutProps) {
  const shown = new Set(visible.map((w) => w.id));
  const one = (id: WidgetId): ReactNode => (shown.has(id) ? renderWidget(id, ctx) : null);
  const many = (ids: WidgetId[]) =>
    ids
      .map((id) => ({ id, node: one(id) }))
      .filter((x) => x.node !== null)
      .map((x) => <Fragment key={x.id}>{x.node}</Fragment>);
  return { one, many };
}

/** A · Clásico por columnas: indicadores arriba, barras con accesos rápidos y tabla al final. */
function ColumnsLayout(props: LayoutProps) {
  const { one, many } = useSlots(props);
  const kpis = many(KPI_IDS).slice(0, 5);
  // Sin acceso al balance, la gráfica comparativa se reemplaza por la evolución de ventas.
  const chart = one("incomeVsExpenses") ?? (props.visible.some((w) => w.id === "incomeVsExpenses" || w.id === "salesTrend") ? renderWidget("salesTrend", props.ctx) : null);
  const actions = one("quickActions");
  const side = many(["overdueAlerts", "lowStock", "topProducts"]);
  const table = one("recentInvoices");
  return (
    <div className="dash dash-columns">
      {kpis.length > 0 && <div className="dash-kpis" data-count={kpis.length}>{kpis}</div>}
      {(chart || actions) && (
        <div className={`dash-split ${chart && actions ? "" : "is-single"}`}>
          {chart}
          {actions}
        </div>
      )}
      {(table || side.length > 0) && (
        <div className={`dash-split ${table && side.length > 0 ? "" : "is-single"}`}>
          {table}
          {side.length > 0 && <div className="dash-stack">{side}</div>}
        </div>
      )}
    </div>
  );
}

/** B · Analítico: gráfica amplia de tendencia, indicadores al lado y composición debajo. */
function AnalyticsLayout(props: LayoutProps) {
  const { one, many } = useSlots(props);
  const { data, scope, navigate } = props.ctx;
  const kpis = many(["salesKpi", "collectedKpi", "expensesKpi", "balanceKpi"]);
  const trend = one("salesTrend");
  const composition = many(["paymentMethods", "expensesByCategory", "topProducts"]);
  const compare = one("incomeVsExpenses");
  const alerts = one("overdueAlerts");
  const prev = data.previous;
  const growth = prev && prev.invoicedTotal > 0 ? ((data.month.invoicedTotal - prev.invoicedTotal) / prev.invoicedTotal) * 100 : null;
  const margin = scope.finance && data.month.invoicedTotal > 0 ? (data.month.grossProfit / data.month.invoicedTotal) * 100 : null;
  const average = data.month.invoiceCount > 0 ? Math.round(data.month.invoicedTotal / data.month.invoiceCount) : null;
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`;
  return (
    <div className="dash dash-analytics">
      {kpis.length > 0 && <div className="dash-kpis is-compact" data-count={kpis.length}>{kpis}</div>}
      <div className="dash-focus">
        {trend}
        <section className="card widget dash-indicators" aria-label="Indicadores del periodo">
          <header className="widget-head">
            <div>
              <h2 className="widget-title">Indicadores</h2>
              <div className="widget-sub">{props.ctx.periodLabel}</div>
            </div>
          </header>
          <dl className="indicator-list">
            <div>
              <dt title="Variación de las ventas facturadas frente al periodo anterior de igual duración.">Crecimiento de ventas</dt>
              <dd>{growth === null ? <span className="subtle">Sin periodo anterior para comparar</span> : pct(growth)}</dd>
            </div>
            {scope.finance && (
              <div>
                <dt title="(Ventas − costo de lo vendido) ÷ ventas. Usa el costo registrado en cada producto.">Margen bruto</dt>
                <dd>{margin === null ? <span className="subtle">Sin ventas en el periodo</span> : `${margin.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %`}</dd>
              </div>
            )}
            <div>
              <dt title="Ventas facturadas ÷ número de facturas del periodo.">Factura promedio</dt>
              <dd>{average === null ? <span className="subtle">Sin facturas en el periodo</span> : money(average)}</dd>
            </div>
            <div>
              <dt title="Saldo de las facturas cuya fecha de vencimiento ya pasó.">Cartera vencida</dt>
              <dd className={data.overdueTotal > 0 ? "profit-negative" : ""}>{money(data.overdueTotal)}</dd>
            </div>
            <div>
              <dt title="Saldo pendiente de todas las facturas abiertas, al día de hoy.">Por cobrar</dt>
              <dd>{money(data.month.receivableTotal)}</dd>
            </div>
            {scope.inventory && (
              <div>
                <dt title="Productos activos por debajo de su existencia mínima.">Productos con stock bajo</dt>
                <dd>
                  <button type="button" className="link-btn" onClick={() => navigate({ page: "inventory" })}>
                    {data.lowStock.length}
                    {data.lowStock.length === 8 ? " o más" : ""}
                  </button>
                </dd>
              </div>
            )}
          </dl>
        </section>
      </div>
      {composition.length > 0 && <div className="dash-trio" data-count={composition.length}>{composition}</div>}
      {(compare || alerts) && (
        <div className={`dash-split ${compare && alerts ? "" : "is-single"}`}>
          {compare}
          {alerts}
        </div>
      )}
    </div>
  );
}

/** C · Modular: cuadrícula con los widgets que el usuario eligió, en su orden y tamaño. */
function WidgetsLayout({ ctx, visible, ui }: LayoutProps & { ui: UiPreferences }) {
  const cells = visible
    .map((w) => ({ w, node: renderWidget(w.id, ctx) }))
    .filter((c) => c.node !== null);
  return (
    <div className="dash dash-widgets">
      {cells.map(({ w, node }) => (
        <div key={w.id} className={`dash-cell is-${widgetSize(ui, w)}`}>
          {node}
        </div>
      ))}
    </div>
  );
}

function GettingStarted({
  navigate,
  hasLogo,
  products,
  customers,
  invoices,
}: {
  navigate: PageProps["navigate"];
  hasLogo: boolean;
  products: number;
  customers: number;
  invoices: number;
}) {
  const access = useAccess();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("cartucho_getting_started_hidden") === "1";
    } catch {
      return false;
    }
  });
  const steps = [
    { done: hasLogo, title: "Sube el logo de tu empresa", sub: "Aparece en el inicio de sesión y en tus facturas.", go: () => navigate({ page: "settings", tab: "company" }) },
    ...(access.can("catalog")
      ? [{ done: products > 0, title: "Agrega tus productos o servicios", sub: "Con foto, precio y existencias.", go: () => navigate({ page: "catalog" }) }]
      : []),
    ...(access.can("customers")
      ? [{ done: customers > 0, title: "Registra a tus clientes frecuentes", sub: "Para facturarles más rápido.", go: () => navigate({ page: "customers" }) }]
      : []),
    { done: false, title: "Revisa la impresión", sub: "Tamaño de hoja, textos y numeración.", go: () => navigate({ page: "settings", tab: "billing" }) },
    { done: invoices > 0, title: "Crea tu primera factura", sub: "Imprímela en el tamaño que necesites.", go: () => navigate({ page: "invoice-new" }) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (hidden || invoices > 0) return null;
  return (
    <div className="card mb-16">
      <div className="card-header">
        <div>
          <div className="card-title">Primeros pasos</div>
          <div className="card-subtitle">
            {doneCount} de {steps.length} listos
          </div>
        </div>
        <button
          className="icon-btn"
          aria-label="Ocultar primeros pasos"
          title="Ocultar"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem("cartucho_getting_started_hidden", "1");
            } catch {
              /* ignorar */
            }
          }}
        >
          <X size={16} />
        </button>
      </div>
      <div className="hbar-track" style={{ borderRadius: 0, height: 4 }}>
        <div className="hbar-fill" style={{ width: `${(doneCount / steps.length) * 100}%`, borderRadius: 0 }} />
      </div>
      <div className="list">
        {steps.map((st) => (
          <div key={st.title} className="list-item is-clickable" onClick={st.go}>
            <span
              className="stat-icon"
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: st.done ? "var(--success)" : "var(--surface-3)",
                color: st.done ? "#fff" : "var(--text-3)",
              }}
            >
              {st.done ? <Check size={15} /> : null}
            </span>
            <div className="list-item-main">
              <div className="cell-main" style={st.done ? { textDecoration: "line-through", color: "var(--text-3)" } : undefined}>
                {st.title}
              </div>
              <div className="cell-sub">{st.sub}</div>
            </div>
            <ArrowRight size={16} color="var(--text-3)" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Inicio cuando la licencia está desactivada: aviso de soporte y últimas facturas (solo lectura). */
function RestrictedDashboard({
  navigate,
  overview,
  recent,
  loading,
}: {
  navigate: PageProps["navigate"];
  overview: PageProps["overview"];
  recent: InvoiceSummary[];
  loading: boolean;
}) {
  const lic = overview.license;
  return (
    <div className="page">
      <div className="support-card">
        <div className="support-card-icon">
          <LifeBuoy size={28} />
        </div>
        <div className="support-card-body">
          <div className="support-card-title">Contacta a soporte</div>
          <p>{lic?.message ?? "Tu licencia no está activa. Solo puedes consultar tus facturas."}</p>
          {lic?.support && (
            <p className="support-card-contact">
              <strong>Soporte:</strong> {lic.support}
            </p>
          )}
          <p className="subtle" style={{ fontSize: 13 }}>
            Tus datos están intactos. Puedes ver e imprimir tus facturas y exportar una copia de tu base de datos desde Configuración.
          </p>
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Button variant="primary" onClick={() => navigate({ page: "settings", tab: "license" })}>
              Ver licencia
            </Button>
            <Button variant="secondary" onClick={() => navigate({ page: "invoices" })}>
              Ver facturas
            </Button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">Últimas facturas</div>
          <Button size="sm" variant="ghost" onClick={() => navigate({ page: "invoices" })}>
            Ver todas <ArrowRight size={14} />
          </Button>
        </div>
        {loading && recent.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : recent.length === 0 ? (
          <div className="card-body subtle">No hay facturas registradas.</div>
        ) : (
          <div className="list">
            {recent.map((i) => (
              <div key={i.id} className="list-item is-clickable" onClick={() => navigate({ page: "invoice", id: i.id })}>
                <div className="list-item-main">
                  <div className="cell-main">{i.customerName}</div>
                  <div className="cell-sub">
                    {i.number} · {fmtDate(i.issueDate)}
                  </div>
                </div>
                <InvoiceStatusBadge status={i.status} overdue={isOverdue(i.dueDate, i.balance, i.status)} />
                <div className="money t-strong" style={{ minWidth: 110, textAlign: "right", fontWeight: 600 }}>
                  {money(i.total)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Accesos grandes a cada módulo habilitado (para roles sin acceso a las cifras de ventas). */
function ModuleTiles({ navigate }: { navigate: PageProps["navigate"] }) {
  const access = useAccess();
  const items = NAVIGATION.flatMap((g) => g.items)
    .filter((i) => i.id !== "dashboard" && access.canOpen(i.route) && access.showNav(i.id))
    .map((i) => ({ ...i, label: access.navLabel(i.id, i.label) }));
  return (
    <>
      <h2 style={{ fontSize: 19, margin: "4px 0 2px" }}>Módulos</h2>
      <p className="subtle" style={{ margin: "0 0 14px" }}>Gestiona las áreas de tu negocio desde aquí.</p>
      <div className="module-tiles">
        {items.map((i) => {
          const Icon = i.icon;
          return (
            <button key={i.id} className="module-tile" onClick={() => navigate(i.route)}>
              <Icon className="module-tile-icon" size={30} strokeWidth={1.6} />
              <span className="module-tile-title">{i.label}</span>
              <ChevronRight className="module-tile-arrow" size={18} />
              <span className="module-tile-desc">{NAV_DESCRIPTION[i.id]}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
