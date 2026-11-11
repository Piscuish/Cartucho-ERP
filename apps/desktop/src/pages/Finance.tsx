import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Download, HandCoins, PiggyBank, Receipt, ShoppingCart, TrendingUp, Wallet } from "lucide-react";
import type { CsvReportKind } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api, isDesktop, pickSavePath } from "../services/systemClient";
import { useAsync } from "../lib/hooks";
import { addDays, errorMessage, fmtDate, money, monthEnd, monthStart, qty, todayISO } from "../lib/format";
import { Alert, Button, PageHeader, Segmented, SkeletonRows, StatCard, useToast } from "../components/ui";
import { HBars, MonthlyBars } from "../components/charts";

export type Period = "month" | "last-month" | "year" | "custom";

export function periodRange(p: Period, custom: { from: string; to: string }): { from: string; to: string } {
  const today = todayISO();
  if (p === "month") return { from: monthStart(today), to: monthEnd(today) };
  if (p === "last-month") {
    const prev = addDays(monthStart(today), -1);
    return { from: monthStart(prev), to: monthEnd(prev) };
  }
  if (p === "year") return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  return custom;
}

export function PeriodPicker({ period, setPeriod, custom, setCustom }: { period: Period; setPeriod: (p: Period) => void; custom: { from: string; to: string }; setCustom: (c: { from: string; to: string }) => void }) {
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <Segmented<Period>
        value={period}
        onChange={setPeriod}
        options={[
          { value: "month", label: "Este mes" },
          { value: "last-month", label: "Mes anterior" },
          { value: "year", label: "Este año" },
          { value: "custom", label: "Personalizado" },
        ]}
      />
      {period === "custom" && (
        <>
          <input type="date" className="input" style={{ width: 150 }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <span className="subtle">a</span>
          <input type="date" className="input" style={{ width: 150 }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

export function FinancePage({ navigate }: PageProps) {
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState({ from: monthStart(), to: todayISO() });
  const range = periodRange(period, custom);
  const { data: s, loading, error } = useAsync(() => api.financeSummary(range.from, range.to), [range.from, range.to]);

  const exportCsv = async (kind: CsvReportKind, label: string) => {
    try {
      const dest = await pickSavePath(`Exportar ${label}`, `${kind}_${range.from}_${range.to}.csv`, "csv", "Archivo CSV (Excel)");
      if (!dest) return;
      toast(`Exportado: ${await api.exportCsv(kind, range.from, range.to, dest)}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const totalExpenses = s ? s.operatingExpenses + s.inventoryPurchases : 0;

  return (
    <div className="page">
      <PageHeader
        title="Finanzas"
        subtitle={`Lo que ganaste y lo que gastaste · ${fmtDate(range.from)} – ${fmtDate(range.to)}`}
        actions={
          <>
            {isDesktop() && (
              <>
                <Button size="sm" icon={<Download size={14} />} onClick={() => exportCsv("payments", "ingresos")}>
                  Ingresos CSV
                </Button>
                <Button size="sm" icon={<Download size={14} />} onClick={() => exportCsv("expenses", "gastos")}>
                  Gastos CSV
                </Button>
              </>
            )}
            <Button variant="primary" icon={<Receipt size={16} />} onClick={() => navigate({ page: "expenses" })}>
              Registrar gasto
            </Button>
          </>
        }
      />
      <div className="mb-16">
        <PeriodPicker period={period} setPeriod={setPeriod} custom={custom} setCustom={setCustom} />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {loading && !s ? (
        <div className="card">
          <SkeletonRows rows={6} />
        </div>
      ) : s ? (
        <>
          <div className="grid grid-4 mb-16">
            <StatCard label="Ventas facturadas" value={money(s.invoicedTotal)} icon={<TrendingUp size={18} />} foot={`${s.invoiceCount} facturas`} />
            <StatCard label="Dinero recibido" value={money(s.collectedTotal)} icon={<Wallet size={18} />} tone="success" foot="Pagos y abonos cobrados" />
            <StatCard label="Gastos operativos" value={money(s.operatingExpenses)} icon={<Receipt size={18} />} tone="warning" foot="Arriendo, servicios, nómina…" />
            <StatCard label="Compras de inventario" value={money(s.inventoryPurchases)} icon={<ShoppingCart size={18} />} tone="info" foot="Mercancía comprada" />
          </div>

          <div className="grid grid-2 mb-16">
            <div className="card card-pad">
              <div className="row-between">
                <div>
                  <div className="stat-label">Balance de caja del periodo</div>
                  <div className={`stat-value mt-8 ${s.netCashFlow >= 0 ? "profit-positive" : "profit-negative"}`} style={{ fontSize: 32 }}>
                    {money(s.netCashFlow)}
                  </div>
                </div>
                <span className={`stat-icon ${s.netCashFlow >= 0 ? "is-success" : "is-danger"}`} style={{ width: 44, height: 44 }}>
                  {s.netCashFlow >= 0 ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}
                </span>
              </div>
              <p className="muted mt-8" style={{ fontSize: 13 }}>
                Dinero recibido ({money(s.collectedTotal)}) menos todos los gastos ({money(totalExpenses)}).
              </p>
            </div>
            <div className="card card-pad">
              <div className="row-between">
                <div>
                  <div className="stat-label">Ganancia bruta estimada</div>
                  <div className={`stat-value mt-8 ${s.grossProfit >= 0 ? "profit-positive" : "profit-negative"}`} style={{ fontSize: 32 }}>
                    {money(s.grossProfit)}
                  </div>
                </div>
                <span className="stat-icon" style={{ width: 44, height: 44 }}>
                  <PiggyBank size={22} />
                </span>
              </div>
              <p className="muted mt-8" style={{ fontSize: 13 }}>
                Ventas menos el costo de lo vendido ({money(s.costOfGoodsSold)}), según el costo registrado de cada producto.
              </p>
            </div>
          </div>

          <div className="card mb-16">
            <div className="card-header">
              <div>
                <div className="card-title">Ingresos y gastos por mes</div>
                <div className="card-subtitle">Últimos 12 meses hasta {fmtDate(range.to)}</div>
              </div>
              <span className="badge badge-warning no-dot">
                <HandCoins size={13} /> Por cobrar: {money(s.receivableTotal)}
              </span>
            </div>
            <div className="card-body">
              <MonthlyBars data={s.monthly} />
            </div>
          </div>

          <div className="grid grid-3">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Gastos por categoría</div>
              </div>
              <div className="card-body">
                <HBars items={s.expensesByCategory} empty="No registraste gastos en este periodo." />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Cobros por método</div>
              </div>
              <div className="card-body">
                <HBars items={s.paymentsByMethod} empty="No hay cobros en este periodo." />
              </div>
            </div>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Lo más vendido</div>
              </div>
              {s.topProducts.length === 0 ? (
                <div className="card-body subtle">Sin ventas en este periodo.</div>
              ) : (
                <div className="list">
                  {s.topProducts.map((p) => (
                    <div className="list-item" key={p.name}>
                      <div className="list-item-main">
                        <div className="cell-main">{p.name}</div>
                        <div className="cell-sub">{qty(p.quantity)} unidades</div>
                      </div>
                      <span className="money">{money(p.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
