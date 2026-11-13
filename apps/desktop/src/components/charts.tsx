import { CSSProperties, useEffect, useRef, useState } from "react";
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

// =============================================================================
// Gráficas del panel de inicio. Reglas comunes:
//  - Reciben datos y opciones; nunca deciden su estructura según el tema de color.
//  - Un solo eje, leyenda con texto cuando hay 2 o más series, detalle al pasar el cursor
//    o al moverse con las flechas del teclado, y una tabla equivalente para lectores de pantalla.
//  - Los colores de serie salen de --series-1…5 (definidos por tema); el texto usa los
//    tokens de texto, no el color de la serie.
// =============================================================================

export interface ChartSeries {
  key: string;
  label: string;
  /** Ranura de color fija de la serie (1 a 5). */
  slot: 1 | 2 | 3 | 4 | 5;
}

export interface ChartPoint {
  /** Etiqueta corta del eje (por ejemplo «12» o «nov»). */
  label: string;
  /** Etiqueta completa para el detalle («12 de noviembre de 2026»). */
  title: string;
  values: Record<string, number>;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Pasos «redondos» para el eje (1, 2, 2,5 o 5 × 10ⁿ). */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const n = max / pow;
  // Valores cuyo cuarto también es redondo (el eje tiene 4 divisiones).
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 6 ? 6 : n <= 8 ? 8 : 10;
  return step * pow;
}

function axisLabel(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 2 })} M`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString("es-CO", { maximumFractionDigits: 0 })} mil`;
  return v.toLocaleString("es-CO");
}

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <div className="chart-legend">
      {series.map((s) => (
        <span key={s.key}>
          <span className="legend-dot" style={{ background: `var(--series-${s.slot})` }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ChartTable({ caption, series, points }: { caption: string; series: ChartSeries[]; points: ChartPoint[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Periodo</th>
          {series.map((s) => (
            <th key={s.key} scope="col">
              {s.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {points.map((p, i) => (
          <tr key={i}>
            <th scope="row">{p.title}</th>
            {series.map((s) => (
              <td key={s.key}>{money(p.values[s.key] ?? 0)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartTip({ point, series, left, width }: { point: ChartPoint; series: ChartSeries[]; left: number; width: number }) {
  // Se mantiene dentro del área de la gráfica.
  const style: CSSProperties = left > width / 2 ? { right: Math.max(0, width - left + 10) } : { left: left + 10 };
  return (
    <div className="chart-tip" style={style} role="status">
      <div className="chart-tip-title">{point.title}</div>
      {series.map((s) => (
        <div className="chart-tip-row" key={s.key}>
          <span className="legend-dot" style={{ background: `var(--series-${s.slot})` }} />
          <span>{s.label}</span>
          <strong className="money">{money(point.values[s.key] ?? 0)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Índice activo con ratón y teclado (flechas, Inicio, Fin, Escape). */
function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (count === 0) return;
    const cur = active ?? -1;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(count - 1, cur + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, cur < 0 ? count - 1 : cur - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else if (e.key === "Escape") {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };
  return { active, setActive, onKeyDown };
}

interface PlotProps {
  points: ChartPoint[];
  series: ChartSeries[];
  /** Descripción para lectores de pantalla (incluye periodo y unidad). */
  label: string;
  height?: number;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 52 };

function useScale(points: ChartPoint[], series: ChartSeries[], width: number, height: number) {
  const max = niceMax(Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0))));
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  // Etiquetas del eje X sin amontonarse: como máximo una cada ~56 px.
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 56))));
  return { max, innerW, innerH, y, ticks, every };
}

function Axes({ width, scale, points, xAt }: { width: number; scale: ReturnType<typeof useScale>; points: ChartPoint[]; xAt: (i: number) => number }) {
  return (
    <g aria-hidden="true">
      {scale.ticks.map((t) => (
        <g key={t}>
          <line className="chart-grid" x1={PAD.left} x2={width - PAD.right} y1={scale.y(t)} y2={scale.y(t)} />
          <text className="chart-axis" x={PAD.left - 8} y={scale.y(t)} textAnchor="end" dominantBaseline="middle">
            {axisLabel(t)}
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % scale.every === 0 || (i === points.length - 1 && scale.every <= 2) ? (
          <text key={i} className="chart-axis" x={xAt(i)} y={PAD.top + scale.innerH + 17} textAnchor="middle">
            {p.label}
          </text>
        ) : null,
      )}
    </g>
  );
}

/**
 * Líneas (o área) para ver cómo cambia un valor en el tiempo. No se usa para comparar categorías.
 */
export function TrendChart({ points, series, label, height = 260, area = false }: PlotProps & { area?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const scale = useScale(points, series, width, height);
  const { active, setActive, onKeyDown } = useActiveIndex(points.length);
  const xAt = (i: number) => PAD.left + (points.length <= 1 ? scale.innerW / 2 : (i / (points.length - 1)) * scale.innerW);
  const path = (key: string) => points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${scale.y(p.values[key] ?? 0).toFixed(1)}`).join(" ");
  const baseline = PAD.top + scale.innerH;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - r.left - PAD.left) / scale.innerW;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
  };
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}. Usa las flechas izquierda y derecha para recorrer los valores.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseMove={onMove}
          onMouseLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          <Axes width={width} scale={scale} points={points} xAt={xAt} />
          {area && points.length > 1 && (
            <path className="chart-area" d={`${path(series[0].key)} L${xAt(points.length - 1).toFixed(1)},${baseline} L${xAt(0).toFixed(1)},${baseline} Z`} style={{ fill: `var(--series-${series[0].slot})` }} />
          )}
          {series.map((s) =>
            points.length > 1 ? (
              <path key={s.key} className="chart-line" d={path(s.key)} style={{ stroke: `var(--series-${s.slot})` }} />
            ) : (
              <circle key={s.key} cx={xAt(0)} cy={scale.y(points[0]?.values[s.key] ?? 0)} r={4} style={{ fill: `var(--series-${s.slot})` }} />
            ),
          )}
          {active !== null && points[active] && (
            <g aria-hidden="true">
              <line className="chart-cross" x1={xAt(active)} x2={xAt(active)} y1={PAD.top} y2={baseline} />
              {series.map((s) => (
                <circle key={s.key} className="chart-dot" cx={xAt(active)} cy={scale.y(points[active].values[s.key] ?? 0)} r={4.5} style={{ fill: `var(--series-${s.slot})` }} />
              ))}
            </g>
          )}
        </svg>
      )}
      {active !== null && points[active] && <ChartTip point={points[active]} series={series} left={xAt(active)} width={width} />}
      <ChartLegend series={series} />
      <ChartTable caption={label} series={series} points={points} />
    </div>
  );
}

/** Barras verticales para comparar periodos o grupos (una o varias series, un solo eje). */
export function ColumnChart({ points, series, label, height = 240 }: PlotProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const scale = useScale(points, series, width, height);
  const { active, setActive, onKeyDown } = useActiveIndex(points.length);
  const band = scale.innerW / Math.max(1, points.length);
  const xAt = (i: number) => PAD.left + band * i + band / 2;
  const gap = 2;
  const groupW = Math.min(band * 0.72, series.length * 26 + (series.length - 1) * gap);
  const barW = Math.max(2, (groupW - (series.length - 1) * gap) / series.length);
  const baseline = PAD.top + scale.innerH;
  return (
    <div className="chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label}. Usa las flechas izquierda y derecha para recorrer los valores.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          <Axes width={width} scale={scale} points={points} xAt={xAt} />
          {points.map((p, i) => (
            <g key={i} onMouseEnter={() => setActive(i)}>
              {/* Zona sensible más grande que la barra. */}
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={scale.innerH} fill="transparent" />
              {active === i && <rect className="chart-band" x={PAD.left + band * i + 1} y={PAD.top} width={band - 2} height={scale.innerH} rx={4} />}
              {series.map((s, si) => {
                const v = p.values[s.key] ?? 0;
                const h = Math.max(v > 0 ? 2 : 0, baseline - scale.y(v));
                const x = xAt(i) - groupW / 2 + si * (barW + gap);
                const r = Math.min(4, barW / 2, h);
                // Extremo superior redondeado; base recta apoyada en el eje.
                const d = `M${x},${baseline} V${baseline - h + r} Q${x},${baseline - h} ${x + r},${baseline - h} H${x + barW - r} Q${x + barW},${baseline - h} ${x + barW},${baseline - h + r} V${baseline} Z`;
                return h > 0 ? <path key={s.key} d={d} style={{ fill: `var(--series-${s.slot})` }} /> : null;
              })}
            </g>
          ))}
        </svg>
      )}
      {active !== null && points[active] && <ChartTip point={points[active]} series={series} left={xAt(active)} width={width} />}
      <ChartLegend series={series} />
      <ChartTable caption={label} series={series} points={points} />
    </div>
  );
}

/**
 * Anillo: partes que componen un total (nunca una serie de tiempo). Hasta 5 partes; el resto
 * se agrupa en «Otros». La leyenda con valor y porcentaje siempre está visible.
 */
export function Donut({ items, label, totalLabel = "Total", size = 148 }: { items: AmountByLabel[]; label: string; totalLabel?: string; size?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const positive = items.filter((i) => i.amount > 0).sort((a, b) => b.amount - a.amount);
  const parts = positive.length > 5 ? [...positive.slice(0, 4), { label: "Otros", amount: positive.slice(4).reduce((s, i) => s + i.amount, 0) }] : positive;
  const total = parts.reduce((s, i) => s + i.amount, 0);
  if (total <= 0) return null;
  const r = size / 2 - 12;
  const c = 2 * Math.PI * r;
  const gapLen = parts.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label}. Total ${money(total)}.`}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {parts.map((p, i) => {
            const len = (p.amount / total) * c;
            const seg = (
              <circle
                key={p.label}
                className={`donut-seg ${active !== null && active !== i ? "is-dim" : ""}`}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={active === i ? 20 : 16}
                strokeDasharray={`${Math.max(0.5, len - gapLen)} ${c}`}
                strokeDashoffset={-offset}
                style={{ stroke: `var(--series-${(i % 5) + 1})` }}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            );
            offset += len;
            return seg;
          })}
        </g>
        <text className="donut-total-label" x="50%" y="46%" textAnchor="middle">
          {active !== null ? parts[active].label : totalLabel}
        </text>
        <text className="donut-total" x="50%" y="60%" textAnchor="middle">
          {active !== null ? `${Math.round((parts[active].amount / total) * 100)} %` : moneyShort(total)}
        </text>
      </svg>
      <ul className="donut-legend">
        {parts.map((p, i) => (
          <li key={p.label} className={active === i ? "is-active" : ""} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
            <span className="legend-dot" style={{ background: `var(--series-${(i % 5) + 1})` }} />
            <span className="donut-legend-label">{p.label}</span>
            <span className="money">{money(p.amount)}</span>
            <span className="subtle">{Math.round((p.amount / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
