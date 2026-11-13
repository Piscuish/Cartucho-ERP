/**
 * Widgets del panel de inicio: cada uno presenta un bloque de información a partir de los
 * datos que entrega el backend. No calculan fórmulas financieras propias y no dependen del
 * tema de color ni del diseño del panel.
 */
import { ReactNode, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  FilePlus2,
  FileSignature,
  Info,
  Minus,
  PackagePlus,
  Receipt,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { DashboardData, DashboardScope, InvoiceSummary, WidgetId } from "@cartucho/shared";
import type { Route } from "../config/moduleRegistry";
import type { Access } from "../lib/access";
import { api } from "../services/systemClient";
import { fmtDate, fmtMonthLong, fmtMonthShort, isOverdue, money, qty } from "../lib/format";
import { Button, InvoiceStatusBadge } from "./ui";
import { ChartPoint, ColumnChart, Donut, TrendChart } from "./charts";

export interface WidgetContext {
  data: DashboardData;
  scope: DashboardScope;
  access: Access;
  navigate: (r: Route) => void;
  /** «Este mes», «Últimos 7 días»… */
  periodLabel: string;
}

// ------------------------------------------------------------------ Piezas comunes

export function WidgetCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card widget ${className}`} aria-label={title}>
      <header className="widget-head">
        <div>
          <h2 className="widget-title">{title}</h2>
          {subtitle && <div className="widget-sub">{subtitle}</div>}
        </div>
        {action && (
          <Button size="sm" variant="ghost" onClick={action.onClick}>
            {action.label} <ArrowRight size={14} />
          </Button>
        )}
      </header>
      <div className="widget-body">{children}</div>
    </section>
  );
}

/** Estado vacío: explica por qué no hay nada, en lugar de mostrar ceros que parezcan resultados. */
export function WidgetEmpty({ children }: { children: ReactNode }) {
  return <p className="widget-empty">{children}</p>;
}

/**
 * Variación frente al periodo anterior. Lleva flecha y texto además del color.
 * `goodWhenUp = false` para valores donde subir no es bueno (gastos).
 */
export function Delta({ current, previous, goodWhenUp = true }: { current: number; previous: number | null | undefined; goodWhenUp?: boolean }) {
  if (previous == null) return null;
  if (previous === 0) {
    return <span className="delta is-flat">{current === 0 ? "Sin movimiento" : "Sin periodo anterior para comparar"}</span>;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const up = pct > 0.05;
  const down = pct < -0.05;
  const good = up ? goodWhenUp : down ? !goodWhenUp : null;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`delta ${good === null ? "is-flat" : good ? "is-good" : "is-bad"}`} title={`Periodo anterior: ${money(previous)}`}>
      <Icon size={14} aria-hidden="true" />
      {up ? "+" : ""}
      {pct.toLocaleString("es-CO", { maximumFractionDigits: 1 })} %<span className="delta-note"> vs. periodo anterior</span>
    </span>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone = "accent",
  delta,
  foot,
  hint,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: "accent" | "success" | "warning" | "danger" | "info";
  delta?: ReactNode;
  foot?: ReactNode;
  /** Qué mide y de dónde sale el dato. */
  hint: string;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <div className="stat-top">
        <span className="stat-label">
          {label}
          <span className="kpi-hint" title={hint} aria-label={hint} role="img">
            <Info size={13} />
          </span>
        </span>
        <span className={`stat-icon ${tone !== "accent" ? `is-${tone}` : ""}`}>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      {delta && <div className="kpi-delta">{delta}</div>}
      {foot && <div className="stat-foot">{foot}</div>}
    </>
  );
  return onOpen ? (
    <button type="button" className={`card stat kpi stat-${tone} is-clickable`} onClick={onOpen} aria-label={`${label}: abrir el detalle`}>
      {body}
    </button>
  ) : (
    <div className={`card stat kpi stat-${tone}`}>{body}</div>
  );
}

function trendPoints(data: DashboardData): ChartPoint[] {
  return (data.trend ?? []).map((t) => {
    const daily = t.period.length === 10;
    return {
      label: daily ? String(Number(t.period.slice(8))) : fmtMonthShort(t.period),
      title: daily ? fmtDate(t.period) : fmtMonthLong(`${t.period}-01`),
      values: { invoiced: t.invoiced, collected: t.collected, expenses: t.expenses },
    };
  });
}

// ------------------------------------------------------------------ Widgets

function QuickActions({ access, navigate, data }: WidgetContext) {
  const actions: { key: string; title: string; sub: string; icon: ReactNode; tone: string; go: () => void }[] = [];
  if (access.canWrite("invoices") && access.showNav("invoice-new"))
    actions.push({ key: "inv", title: access.navLabel("invoice-new", "Nueva factura"), sub: "Vende e imprime", icon: <FilePlus2 size={18} />, tone: "", go: () => navigate({ page: "invoice-new" }) });
  if (access.canWrite("invoices") && access.showNav("pos"))
    actions.push({ key: "pos", title: access.navLabel("pos", "Punto de venta"), sub: "Cobra en el mostrador", icon: <ShoppingCart size={18} />, tone: "is-success", go: () => navigate({ page: "pos" }) });
  if (access.canWrite("quotes") && access.showNav("quotes"))
    actions.push({ key: "quote", title: "Nueva cotización", sub: `${data.openQuoteCount} abiertas`, icon: <FileSignature size={18} />, tone: "is-info", go: () => navigate({ page: "quote-new" }) });
  if (access.canWrite("expenses") && access.showNav("expenses"))
    actions.push({ key: "exp", title: "Registrar gasto", sub: "Arriendo, luz, compras…", icon: <Receipt size={18} />, tone: "is-warning", go: () => navigate({ page: "expenses" }) });
  if (access.can("catalog") && access.showNav("catalog"))
    actions.push({ key: "cat", title: access.navLabel("catalog", "Catálogo"), sub: `${data.productCount} en catálogo`, icon: <PackagePlus size={18} />, tone: "is-success", go: () => navigate({ page: "catalog" }) });
  if (access.can("inventory") && access.showNav("inventory"))
    actions.push({ key: "stock", title: access.navLabel("inventory", "Inventario"), sub: "Existencias y movimientos", icon: <Boxes size={18} />, tone: "is-info", go: () => navigate({ page: "inventory" }) });
  return (
    <WidgetCard title="Accesos rápidos">
      {actions.length === 0 ? (
        <WidgetEmpty>Tu rol no tiene acciones rápidas disponibles.</WidgetEmpty>
      ) : (
        <div className="qa-list">
          {actions.slice(0, 4).map((a) => (
            <button key={a.key} type="button" className="qa-item" onClick={a.go}>
              <span className={`stat-icon ${a.tone}`}>{a.icon}</span>
              <span className="qa-text">
                <span className="qa-title">{a.title}</span>
                <span className="qa-sub">{a.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function RecentInvoices({ data, navigate, access }: WidgetContext) {
  return (
    <WidgetCard title="Últimas facturas" subtitle="Las más recientes, de cualquier fecha" action={{ label: "Ver todas", onClick: () => navigate({ page: "invoices" }) }} className="is-flush">
      {data.recentInvoices.length === 0 ? (
        <div className="widget-pad">
          <WidgetEmpty>Aún no hay facturas registradas.</WidgetEmpty>
          {access.canWrite("invoices") && (
            <Button variant="primary" onClick={() => navigate({ page: "invoice-new" })}>
              Nueva factura
            </Button>
          )}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="mini-table">
            <thead>
              <tr>
                <th scope="col">Número</th>
                <th scope="col">Cliente</th>
                <th scope="col">Fecha</th>
                <th scope="col">Estado</th>
                <th scope="col" className="num">
                  Total (COP)
                </th>
              </tr>
            </thead>
            <tbody>
              {data.recentInvoices.map((i) => (
                <tr key={i.id} className="is-clickable" tabIndex={0} onClick={() => navigate({ page: "invoice", id: i.id })} onKeyDown={(e) => e.key === "Enter" && navigate({ page: "invoice", id: i.id })}>
                  <td className="t-strong">{i.number}</td>
                  <td>{i.customerName}</td>
                  <td className="subtle">{fmtDate(i.issueDate)}</td>
                  <td>
                    <InvoiceStatusBadge status={i.status} overdue={isOverdue(i.dueDate, i.balance, i.status)} />
                  </td>
                  <td className="num money t-strong">{money(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetCard>
  );
}

function OverdueAlerts({ data, navigate }: WidgetContext) {
  const none = data.overdueCount === 0 && data.openInvoiceCount === 0;
  return (
    <WidgetCard title="Alertas de cartera" subtitle="Al día de hoy" action={{ label: "Por cobrar", onClick: () => navigate({ page: "invoices", status: "open" }) }}>
      {none ? (
        <WidgetEmpty>No hay facturas pendientes de cobro.</WidgetEmpty>
      ) : (
        <ul className="alert-list">
          <li className={data.overdueCount > 0 ? "is-danger" : "is-ok"}>
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              <strong>{data.overdueCount > 0 ? `${data.overdueCount} ${data.overdueCount === 1 ? "factura vencida" : "facturas vencidas"}` : "Sin facturas vencidas"}</strong>
              {data.overdueCount > 0 && <span className="subtle"> · {money(data.overdueTotal)} por cobrar</span>}
            </span>
          </li>
          <li>
            <CircleDollarSign size={16} aria-hidden="true" />
            <span>
              <strong>
                {data.openInvoiceCount} {data.openInvoiceCount === 1 ? "factura por cobrar" : "facturas por cobrar"}
              </strong>
              <span className="subtle"> · {money(data.month.receivableTotal)} en total</span>
            </span>
          </li>
        </ul>
      )}
    </WidgetCard>
  );
}

function LowStock({ data, navigate }: WidgetContext) {
  return (
    <WidgetCard title="Stock bajo" subtitle="Por debajo de su mínimo" action={{ label: "Inventario", onClick: () => navigate({ page: "inventory" }) }} className="is-flush">
      {data.lowStock.length === 0 ? (
        <div className="widget-pad">
          <WidgetEmpty>Todo en orden: ningún producto está por debajo de su mínimo.</WidgetEmpty>
        </div>
      ) : (
        <div className="list">
          {data.lowStock.slice(0, 6).map((p) => (
            <div key={p.id} className="list-item is-clickable" onClick={() => navigate({ page: "inventory" })}>
              <div className="thumb" style={{ width: 32, height: 32 }}>
                {p.imageDataUrl ? <img src={p.imageDataUrl} alt="" /> : <AlertTriangle size={15} color="var(--warning)" />}
              </div>
              <div className="list-item-main">
                <div className="cell-main">{p.name}</div>
                <div className="cell-sub">Mínimo {qty(p.minStock)}</div>
              </div>
              <span className={`badge ${p.stockQty <= 0 ? "badge-danger" : "badge-warning"}`}>
                {p.stockQty <= 0 ? "Agotado" : `${qty(p.stockQty)} ${p.unit}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function TopProducts({ data, periodLabel }: WidgetContext) {
  const top = data.month.topProducts.slice(0, 5);
  const max = Math.max(1, ...top.map((p) => p.total));
  return (
    <WidgetCard title="Más vendidos" subtitle={periodLabel}>
      {top.length === 0 ? (
        <WidgetEmpty>No hay ventas en este periodo.</WidgetEmpty>
      ) : (
        <ol className="rank-list">
          {top.map((p, i) => (
            <li key={p.name}>
              <span className="rank-pos">{i + 1}</span>
              <div className="rank-main">
                <div className="rank-row">
                  <span className="rank-name">{p.name}</span>
                  <span className="money">{money(p.total)}</span>
                </div>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${(p.total / max) * 100}%` }} />
                </div>
                <div className="cell-sub">{qty(p.quantity)} vendidos</div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </WidgetCard>
  );
}

function SalesTrend({ data, periodLabel, navigate, access }: WidgetContext) {
  const points = trendPoints(data);
  const empty = points.every((p) => p.values.invoiced === 0 && p.values.collected === 0);
  return (
    <WidgetCard
      title="Evolución de ventas"
      subtitle={`${periodLabel} · pesos (COP)`}
      action={access.can("finance") ? { label: "Ver finanzas", onClick: () => navigate({ page: "finance" }) } : undefined}
    >
      {empty ? (
        <WidgetEmpty>No hay ventas ni cobros en este periodo. Prueba con un periodo más amplio.</WidgetEmpty>
      ) : (
        <TrendChart
          area
          height={280}
          label={`Evolución de ventas, ${periodLabel.toLowerCase()}, en pesos`}
          points={points}
          series={[
            { key: "invoiced", label: "Ventas facturadas", slot: 1 },
            { key: "collected", label: "Dinero recibido", slot: 3 },
          ]}
        />
      )}
    </WidgetCard>
  );
}

function IncomeVsExpenses({ data, navigate, access, scope }: WidgetContext) {
  const months = data.month.monthly.slice(-6);
  const points: ChartPoint[] = months.map((m) => ({
    label: fmtMonthShort(m.month),
    title: fmtMonthLong(`${m.month}-01`),
    values: { collected: m.collected, expenses: m.expenses },
  }));
  const empty = months.every((m) => m.collected === 0 && m.expenses === 0);
  return (
    <WidgetCard
      title={scope.expenses || scope.finance ? "Ingresos vs. gastos" : "Dinero recibido"}
      subtitle="Últimos 6 meses · pesos (COP)"
      action={access.can("finance") ? { label: "Ver finanzas", onClick: () => navigate({ page: "finance" }) } : undefined}
    >
      {empty ? (
        <WidgetEmpty>Aún no hay cobros ni gastos registrados en los últimos 6 meses.</WidgetEmpty>
      ) : (
        <ColumnChart
          label="Dinero cobrado frente a gastos por mes, últimos 6 meses, en pesos"
          points={points}
          series={[
            { key: "collected", label: "Dinero cobrado", slot: 1 },
            ...(scope.expenses || scope.finance ? [{ key: "expenses", label: "Gastos", slot: 2 as const }] : []),
          ]}
        />
      )}
    </WidgetCard>
  );
}

function PaymentMethods({ data, periodLabel }: WidgetContext) {
  return (
    <WidgetCard title="Recaudo por forma de pago" subtitle={periodLabel}>
      {data.month.paymentsByMethod.length === 0 ? (
        <WidgetEmpty>No se recibieron pagos en este periodo.</WidgetEmpty>
      ) : (
        <Donut items={data.month.paymentsByMethod} label="Dinero recibido por forma de pago" totalLabel="Recibido" />
      )}
    </WidgetCard>
  );
}

function ExpensesByCategory({ data, periodLabel, navigate }: WidgetContext) {
  return (
    <WidgetCard title="Gastos por categoría" subtitle={periodLabel} action={{ label: "Gastos", onClick: () => navigate({ page: "expenses" }) }}>
      {data.month.expensesByCategory.length === 0 ? (
        <WidgetEmpty>No hay gastos registrados en este periodo.</WidgetEmpty>
      ) : (
        <Donut items={data.month.expensesByCategory} label="Gastos por categoría" totalLabel="Gastos" />
      )}
    </WidgetCard>
  );
}

/** Calendario del mes con los vencimientos de las facturas por cobrar. */
function DueCalendar({ data, navigate }: WidgetContext) {
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .listInvoices({ status: "open", limit: 300 })
      .then((list) => alive && setInvoices(list))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);
  const today = data.today;
  const [y, m] = today.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7; // semana que inicia en lunes
  const prefix = today.slice(0, 8);
  const byDay = new Map<number, InvoiceSummary[]>();
  (invoices ?? []).forEach((i) => {
    if (i.dueDate?.startsWith(prefix)) {
      const d = Number(i.dueDate.slice(8));
      byDay.set(d, [...(byDay.get(d) ?? []), i]);
    }
  });
  const upcoming = (invoices ?? [])
    .filter((i) => i.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .filter((i) => i.dueDate! >= today)
    .slice(0, 3);
  return (
    <WidgetCard title="Calendario de cobros" subtitle={fmtMonthLong(today)} action={{ label: "Por cobrar", onClick: () => navigate({ page: "invoices", status: "open" }) }}>
      {error ? (
        <WidgetEmpty>No se pudieron cargar los vencimientos.</WidgetEmpty>
      ) : invoices === null ? (
        <WidgetEmpty>Cargando vencimientos…</WidgetEmpty>
      ) : (
        <>
          <div className="cal" role="table" aria-label={`Vencimientos de ${fmtMonthLong(today)}`}>
            <div className="cal-row cal-head" role="row">
              {["L", "M", "X", "J", "V", "S", "D"].map((d, i) => (
                <span key={i} role="columnheader">
                  {d}
                </span>
              ))}
            </div>
            <div className="cal-grid">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`e${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const d = i + 1;
                const due = byDay.get(d) ?? [];
                const iso = `${prefix}${String(d).padStart(2, "0")}`;
                const cls = `${iso === today ? "is-today" : ""} ${due.length ? (iso < today ? "is-late" : "is-due") : ""}`;
                const total = due.reduce((s, x) => s + x.balance, 0);
                return (
                  <span key={d} className={`cal-day ${cls}`} title={due.length ? `${due.length} ${due.length === 1 ? "vencimiento" : "vencimientos"} · ${money(total)}` : undefined}>
                    {d}
                    {due.length > 0 && <span className="sr-only">: {due.length} vencimientos por {money(total)}</span>}
                  </span>
                );
              })}
            </div>
          </div>
          {upcoming.length === 0 ? (
            <WidgetEmpty>No hay cobros próximos con fecha de vencimiento.</WidgetEmpty>
          ) : (
            <ul className="cal-next">
              {upcoming.map((i) => (
                <li key={i.id}>
                  <button type="button" className="link-btn" onClick={() => navigate({ page: "invoice", id: i.id })}>
                    {fmtDate(i.dueDate)} · {i.customerName}
                  </button>
                  <span className="money">{money(i.balance)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </WidgetCard>
  );
}

/** Dibuja un widget del catálogo. Devuelve null si sus datos no están incluidos para el usuario. */
export function renderWidget(id: WidgetId, ctx: WidgetContext): ReactNode {
  const { data, scope, navigate, periodLabel } = ctx;
  const prev = data.previous ?? null;
  const expenses = data.month.operatingExpenses + data.month.inventoryPurchases;
  switch (id) {
    case "salesKpi":
      return (
        <Kpi
          label="Ventas"
          value={money(data.month.invoicedTotal)}
          icon={<TrendingUp size={18} />}
          delta={<Delta current={data.month.invoicedTotal} previous={prev?.invoicedTotal} />}
          foot={`${data.month.invoiceCount} ${data.month.invoiceCount === 1 ? "factura" : "facturas"} · ${periodLabel}`}
          hint="Suma del total de las facturas emitidas en el periodo, sin las anuladas. Es lo facturado, no lo cobrado."
          onOpen={() => navigate({ page: "invoices" })}
        />
      );
    case "collectedKpi":
      return (
        <Kpi
          label="Dinero recibido"
          value={money(data.month.collectedTotal)}
          icon={<Wallet size={18} />}
          tone="success"
          delta={<Delta current={data.month.collectedTotal} previous={prev?.collectedTotal} />}
          foot={`Hoy: ${money(data.todayCollected)}`}
          hint="Pagos y abonos recibidos en el periodo, por cualquier forma de pago. Es recaudo, no facturación."
          onOpen={() => navigate({ page: "cash-close" })}
        />
      );
    case "receivableKpi":
      return (
        <Kpi
          label="Cartera por cobrar"
          value={money(data.month.receivableTotal)}
          icon={<CircleDollarSign size={18} />}
          tone={data.overdueCount > 0 ? "danger" : "info"}
          foot={data.overdueCount > 0 ? `Vencido: ${money(data.overdueTotal)}` : `${data.openInvoiceCount} facturas abiertas`}
          hint="Saldo pendiente de todas las facturas abiertas al día de hoy. No depende del periodo elegido."
          onOpen={() => navigate({ page: "invoices", status: "open" })}
        />
      );
    case "expensesKpi":
      if (!scope.expenses) return null;
      return (
        <Kpi
          label="Gastos"
          value={money(expenses)}
          icon={<TrendingDown size={18} />}
          tone="warning"
          delta={<Delta current={expenses} previous={prev?.expensesTotal} goodWhenUp={false} />}
          foot={`Compras de inventario: ${money(data.month.inventoryPurchases)}`}
          hint="Gastos operativos más compras de inventario registrados en el periodo."
          onOpen={() => navigate({ page: "expenses" })}
        />
      );
    case "balanceKpi":
      if (!scope.finance) return null;
      return (
        <Kpi
          label="Balance de caja"
          value={<span className={data.month.netCashFlow >= 0 ? "profit-positive" : "profit-negative"}>{money(data.month.netCashFlow)}</span>}
          icon={<CalendarDays size={18} />}
          tone="info"
          delta={<Delta current={data.month.netCashFlow} previous={prev?.netCashFlow} />}
          foot={periodLabel}
          hint="Dinero recibido menos gastos del periodo (flujo de caja). No es la utilidad contable."
          onOpen={ctx.access.can("finance") ? () => navigate({ page: "finance" }) : undefined}
        />
      );
    case "salesTrend":
      return <SalesTrend {...ctx} />;
    case "incomeVsExpenses":
      return scope.finance ? <IncomeVsExpenses {...ctx} /> : null;
    case "paymentMethods":
      return <PaymentMethods {...ctx} />;
    case "expensesByCategory":
      return scope.expenses ? <ExpensesByCategory {...ctx} /> : null;
    case "topProducts":
      return <TopProducts {...ctx} />;
    case "lowStock":
      return scope.inventory ? <LowStock {...ctx} /> : null;
    case "recentInvoices":
      return <RecentInvoices {...ctx} />;
    case "overdueAlerts":
      return <OverdueAlerts {...ctx} />;
    case "dueCalendar":
      return <DueCalendar {...ctx} />;
    case "quickActions":
      return <QuickActions {...ctx} />;
  }
}
