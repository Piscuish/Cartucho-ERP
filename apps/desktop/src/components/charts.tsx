import type { AmountByLabel, MonthlyPoint } from "@cartucho/shared";
import { fmtMonthShort, money, moneyShort } from "../lib/format";

/** Barras dobles por mes: ingresos cobrados vs. gastos. */
export function MonthlyBars({ data, months = 12 }: { data: MonthlyPoint[]; months?: number }) {
  const slice = data.slice(-months);
  const max = Math.max(1, ...slice.map((d) => Math.max(d.collected, d.expenses)));
  return (
    <div>
      <div className="bar-chart" role="img" aria-label="Ingresos y gastos por mes">
        {slice.map((d) => (
          <div className="bar-col" key={d.month}>
            <div className="bar-pair">
              <div className="bar is-in" style={{ height: `${(d.collected / max) * 100}%` }} title={`Cobrado ${fmtMonthShort(d.month)}: ${money(d.collected)}`} />
              <div className="bar is-out" style={{ height: `${(d.expenses / max) * 100}%` }} title={`Gastos ${fmtMonthShort(d.month)}: ${money(d.expenses)}`} />
            </div>
            <span className="bar-label">{fmtMonthShort(d.month)}</span>
          </div>
        ))}
      </div>
      <div className="chart-legend mt-16">
        <span>
          <span className="legend-dot" style={{ background: "var(--accent)" }} />
          Ingresos cobrados
        </span>
        <span>
          <span className="legend-dot" style={{ background: "var(--border-strong)" }} />
          Gastos
        </span>
        <span className="subtle" style={{ marginLeft: "auto" }}>Máx. {moneyShort(max)}</span>
      </div>
    </div>
  );
}

/** Barras horizontales para desgloses (gastos por categoría, pagos por método). */
export function HBars({ items, empty = "Sin datos en este periodo." }: { items: AmountByLabel[]; empty?: string }) {
  if (items.length === 0) return <p className="subtle">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.amount));
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <div className="stack" style={{ gap: 14 }}>
      {items.map((i) => (
        <div className="hbar" key={i.label}>
          <div className="hbar-row">
            <span>{i.label}</span>
            <span className="money">
              {money(i.amount)} <span className="subtle">· {Math.round((i.amount / total) * 100)}%</span>
            </span>
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(i.amount / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
