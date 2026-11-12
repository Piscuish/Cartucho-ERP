import { useState } from "react";
import { AlertTriangle, ArrowRight, Boxes, Check, FilePlus2, FileSignature, LifeBuoy, PackagePlus, Receipt, TrendingDown, TrendingUp, Wallet, X } from "lucide-react";
import { useAccess } from "../lib/access";
import type { InvoiceSummary } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAsync } from "../lib/hooks";
import { fmtDate, fmtMonthLong, greeting, isOverdue, money, qty, todayISO } from "../lib/format";
import { Alert, Button, EmptyState, InvoiceStatusBadge, SkeletonRows, StatCard } from "../components/ui";
import { MonthlyBars } from "../components/charts";
import { ChevronRight } from "lucide-react";
import { NAV_DESCRIPTION, NAVIGATION } from "../config/moduleRegistry";

export function DashboardPage({ navigate, overview }: PageProps) {
  const today = todayISO();
  const access = useAccess();
  // Las cifras del inicio salen de las facturas: un rol sin acceso a Facturas ve sus módulos.
  const withFigures = access.can("invoices");
  const { data, loading, error } = useAsync(() => (withFigures ? api.dashboard(today) : Promise.resolve(null)), [today, withFigures]);
  const firstName = overview.currentUser?.fullName.split(" ")[0] ?? "";
  // Balance y gráfico de ingresos vs. gastos: administrador o rol con Resumen financiero.
  const showMoney = access.isAdmin || access.can("finance");

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

  return (
    <div className="page">
      <div className="hero">
        <div>
          <div className="hero-greeting">
            {greeting()}, {firstName}
          </div>
          <p className="muted">
            Así va {overview.company?.tradeName} en {fmtMonthLong(today).toLowerCase()}.
          </p>
        </div>
      </div>

      {overview.preferences.appearance?.layout === "estudio" ? (
        <ModuleTiles navigate={navigate} />
      ) : (
      <div className="quick-actions">
        {access.canWrite("invoices") && access.showNav("invoice-new") && (
        <button className="quick-action" onClick={() => navigate({ page: "invoice-new" })}>
          <span className="stat-icon">
            <FilePlus2 size={18} />
          </span>
          <span>
            <div className="qa-title">{access.navLabel("invoice-new", "Nueva factura")}</div>
            <div className="qa-sub">Vende e imprime</div>
          </span>
        </button>
        )}
        {access.canWrite("quotes") && access.showNav("quotes") && (
        <button className="quick-action" onClick={() => navigate({ page: "quote-new" })}>
          <span className="stat-icon is-info">
            <FileSignature size={18} />
          </span>
          <span>
            <div className="qa-title">{access.navLabel("quotes", "Cotización")}</div>
            <div className="qa-sub">{data ? `${data.openQuoteCount} abiertas` : "Envía un presupuesto"}</div>
          </span>
        </button>
        )}
        {access.canWrite("expenses") && access.showNav("expenses") && (
        <button className="quick-action" onClick={() => navigate({ page: "expenses" })}>
          <span className="stat-icon is-warning">
            <Receipt size={18} />
          </span>
          <span>
            <div className="qa-title">Registrar gasto</div>
            <div className="qa-sub">Arriendo, luz, compras…</div>
          </span>
        </button>
        )}
        {access.can("catalog") && access.showNav("catalog") && (
        <button className="quick-action" onClick={() => navigate({ page: "catalog" })}>
          <span className="stat-icon is-success">
            <PackagePlus size={18} />
          </span>
          <span>
            <div className="qa-title">{access.navLabel("catalog", "Productos")}</div>
            <div className="qa-sub">{data ? `${data.productCount} en catálogo` : "Tu catálogo"}</div>
          </span>
        </button>
        )}
      </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      {data && <GettingStarted navigate={navigate} hasLogo={!!overview.company?.logoDataUrl} products={data.productCount} customers={data.customerCount} invoices={data.recentInvoices.length} />}

      {loading && !data ? (
        <div className="card">
          <SkeletonRows rows={6} />
        </div>
      ) : data ? (
        <>
          {data.overdueCount > 0 && (
            <div className="mb-16">
              <Alert tone="warning" title={`Tienes ${data.overdueCount} ${data.overdueCount === 1 ? "factura vencida" : "facturas vencidas"} por ${money(data.overdueTotal)}`}>
                <button className="back-link" style={{ marginTop: 4, color: "inherit", textDecoration: "underline" }} onClick={() => navigate({ page: "invoices", status: "open" })}>
                  Ver facturas por cobrar
                </button>
              </Alert>
            </div>
          )}

          <div className={`grid ${["grid-2", "grid-3", "grid-4"][Number(access.can("expenses")) + Number(showMoney)]} mb-16`}>
            <StatCard label="Ventas del mes" value={money(data.month.invoicedTotal)} icon={<TrendingUp size={18} />} foot={`${data.month.invoiceCount} facturas emitidas`} />
            <StatCard label="Dinero recibido" value={money(data.month.collectedTotal)} icon={<Wallet size={18} />} tone="success" foot={`Hoy: ${money(data.todayCollected)}`} />
            {access.can("expenses") && (
            <StatCard
              label="Gastos del mes"
              value={money(data.month.operatingExpenses + data.month.inventoryPurchases)}
              icon={<TrendingDown size={18} />}
              tone="warning"
              foot={`Inventario: ${money(data.month.inventoryPurchases)}`}
            />
            )}
            {showMoney && (
            <StatCard
              label="Balance del mes"
              value={<span className={data.month.netCashFlow >= 0 ? "profit-positive" : "profit-negative"}>{money(data.month.netCashFlow)}</span>}
              icon={<Boxes size={18} />}
              tone="info"
              foot={`Por cobrar: ${money(data.month.receivableTotal)}`}
            />
            )}
          </div>

          <div className="grid grid-main-side">
            <div className="stack-lg">
              {showMoney && (
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">Ingresos vs. gastos</div>
                    <div className="card-subtitle">Últimos 6 meses</div>
                  </div>
                  {access.can("finance") && (
                    <Button size="sm" variant="ghost" onClick={() => navigate({ page: "finance" })}>
                      Ver finanzas <ArrowRight size={14} />
                    </Button>
                  )}
                </div>
                <div className="card-body">
                  <MonthlyBars data={data.month.monthly} months={6} />
                </div>
              </div>
              )}

              <div className="card">
                <div className="card-header">
                  <div className="card-title">Últimas facturas</div>
                  <Button size="sm" variant="ghost" onClick={() => navigate({ page: "invoices" })}>
                    Ver todas <ArrowRight size={14} />
                  </Button>
                </div>
                {data.recentInvoices.length === 0 ? (
                  <EmptyState
                    icon={<FilePlus2 size={24} />}
                    title="Crea tu primera factura"
                    text="Agrega productos o servicios, imprímela en el tamaño que necesites y registra el pago."
                    action={
                      access.canWrite("invoices") ? (
                        <Button variant="primary" onClick={() => navigate({ page: "invoice-new" })}>
                          Nueva factura
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <div className="list">
                    {data.recentInvoices.map((i) => (
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

            <div className="stack-lg">
              {access.can("inventory") && (
              <div className="card">
                <div className="card-header">
                  <div className="card-title">Stock bajo</div>
                  <Button size="sm" variant="ghost" onClick={() => navigate({ page: "inventory" })}>
                    Inventario <ArrowRight size={14} />
                  </Button>
                </div>
                {data.lowStock.length === 0 ? (
                  <div className="card-body subtle">Todo en orden: ningún producto está por debajo de su mínimo.</div>
                ) : (
                  <div className="list">
                    {data.lowStock.map((p) => (
                      <div key={p.id} className="list-item is-clickable" onClick={() => navigate({ page: "inventory" })}>
                        <div className="thumb" style={{ width: 34, height: 34 }}>
                          {p.imageDataUrl ? <img src={p.imageDataUrl} alt="" /> : <AlertTriangle size={16} color="var(--warning)" />}
                        </div>
                        <div className="list-item-main">
                          <div className="cell-main">{p.name}</div>
                          <div className="cell-sub">Mínimo {qty(p.minStock)}</div>
                        </div>
                        <span className={`badge ${p.stockQty <= 0 ? "badge-danger" : "badge-warning"}`}>
                          {qty(p.stockQty)} {p.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}

              <div className="card">
                <div className="card-header">
                  <div className="card-title">Más vendidos del mes</div>
                </div>
                {data.month.topProducts.length === 0 ? (
                  <div className="card-body subtle">Aún no hay ventas este mes.</div>
                ) : (
                  <div className="list">
                    {data.month.topProducts.slice(0, 5).map((p, idx) => (
                      <div key={p.name} className="list-item">
                        <span className="badge badge-accent no-dot">{idx + 1}</span>
                        <div className="list-item-main">
                          <div className="cell-main">{p.name}</div>
                          <div className="cell-sub">{qty(p.quantity)} vendidos</div>
                        </div>
                        <span className="money">{money(p.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      ) : null}
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

/** Inicio del diseño Estudio: accesos grandes a cada módulo habilitado. */
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
