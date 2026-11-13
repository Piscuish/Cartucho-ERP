/**
 * Catálogo de widgets del panel de inicio.
 *
 * Un widget declara qué información presenta y qué necesita para mostrarse (módulo activo y
 * permiso). El DISEÑO del panel decide dónde se coloca; el TEMA decide sus colores. Los
 * identificadores deben coincidir con `VALID_WIDGETS` en Rust (`modules.rs`).
 *
 * Ocultar aquí un widget es solo presentación: los datos los filtra el backend según
 * módulos activos y rol (`DashboardData.scope`).
 */
import type { DashboardLayoutId, ModuleKey, UiPreferences, WidgetId, WidgetSize } from "@cartucho/shared";
import type { Access } from "../lib/access";

export type WidgetKind = "Indicador" | "Líneas" | "Barras" | "Anillo" | "Ranking" | "Tabla" | "Alertas" | "Calendario" | "Accesos";

export interface WidgetInfo {
  id: WidgetId;
  title: string;
  description: string;
  kind: WidgetKind;
  /** Módulo que debe estar activo y permitido para el usuario. */
  module?: ModuleKey;
  /** Además, exige ver el balance (administrador o rol con Finanzas). */
  needsFinance?: boolean;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  /** Diseños que lo incluyen en su distribución fija (el modular los admite todos). */
  layouts: DashboardLayoutId[];
}

/** El orden de esta lista es el orden predeterminado del panel modular. */
export const WIDGETS: WidgetInfo[] = [
  { id: "salesKpi", title: "Ventas", description: "Total facturado en el periodo y su variación.", kind: "Indicador", module: "invoices", sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns", "analytics"] },
  { id: "collectedKpi", title: "Dinero recibido", description: "Pagos y abonos recibidos en el periodo.", kind: "Indicador", module: "invoices", sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns", "analytics"] },
  { id: "receivableKpi", title: "Cartera por cobrar", description: "Saldo pendiente de todas las facturas abiertas, hoy.", kind: "Indicador", module: "invoices", sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns", "analytics"] },
  { id: "expensesKpi", title: "Gastos", description: "Gastos operativos y compras de inventario del periodo.", kind: "Indicador", module: "expenses", sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns", "analytics"] },
  { id: "balanceKpi", title: "Balance de caja", description: "Dinero recibido menos gastos del periodo. No es la utilidad contable.", kind: "Indicador", module: "invoices", needsFinance: true, sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns", "analytics"] },
  { id: "overdueAlerts", title: "Alertas de cartera", description: "Facturas vencidas y por cobrar que requieren acción.", kind: "Alertas", module: "invoices", sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns", "analytics"] },
  { id: "salesTrend", title: "Evolución de ventas", description: "Cómo suben y bajan las ventas y los cobros a lo largo del periodo.", kind: "Líneas", module: "invoices", sizes: ["medium", "wide"], defaultSize: "wide", layouts: ["analytics"] },
  { id: "incomeVsExpenses", title: "Ingresos vs. gastos", description: "Dinero cobrado frente a gastos, mes a mes.", kind: "Barras", module: "invoices", needsFinance: true, sizes: ["medium", "wide"], defaultSize: "medium", layouts: ["columns", "analytics"] },
  { id: "paymentMethods", title: "Recaudo por forma de pago", description: "Cómo se compone el dinero recibido: efectivo, transferencia, tarjeta.", kind: "Anillo", module: "invoices", sizes: ["small", "medium"], defaultSize: "medium", layouts: ["analytics"] },
  { id: "expensesByCategory", title: "Gastos por categoría", description: "En qué se fue el dinero del periodo.", kind: "Anillo", module: "expenses", sizes: ["small", "medium"], defaultSize: "small", layouts: ["analytics"] },
  { id: "topProducts", title: "Más vendidos", description: "Productos y servicios con más ventas en el periodo.", kind: "Ranking", module: "invoices", sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns", "analytics"] },
  { id: "quickActions", title: "Accesos rápidos", description: "Atajos a las tareas más frecuentes.", kind: "Accesos", sizes: ["small", "medium", "wide"], defaultSize: "small", layouts: ["columns"] },
  { id: "lowStock", title: "Stock bajo", description: "Productos por debajo de su mínimo.", kind: "Alertas", module: "inventory", sizes: ["small", "medium"], defaultSize: "small", layouts: ["columns"] },
  { id: "dueCalendar", title: "Calendario de cobros", description: "Vencimientos de facturas por cobrar este mes.", kind: "Calendario", module: "invoices", sizes: ["small", "medium"], defaultSize: "small", layouts: [] },
  { id: "recentInvoices", title: "Últimas facturas", description: "Las facturas más recientes con su estado.", kind: "Tabla", module: "invoices", sizes: ["medium", "wide"], defaultSize: "wide", layouts: ["columns"] },
];

export const WIDGET_BY_ID = Object.fromEntries(WIDGETS.map((w) => [w.id, w])) as Record<WidgetId, WidgetInfo>;

/** Widgets que este usuario puede ver (módulo activo + rol). */
export function availableWidgets(access: Access): WidgetInfo[] {
  return WIDGETS.filter((w) => (!w.module || access.can(w.module)) && (!w.needsFinance || access.isAdmin || access.can("finance")));
}

/** Widgets visibles y en orden según las preferencias; los que el usuario no puede ver se omiten. */
export function visibleWidgets(prefs: UiPreferences, access: Access): WidgetInfo[] {
  const available = availableWidgets(access);
  if (!prefs.dashboardWidgets) return available;
  const byId = new Map(available.map((w) => [w.id, w]));
  return prefs.dashboardWidgets.map((id) => byId.get(id)).filter((w): w is WidgetInfo => !!w);
}

export function widgetSize(prefs: UiPreferences, w: WidgetInfo): WidgetSize {
  const s = prefs.widgetSizes?.[w.id];
  return s && w.sizes.includes(s) ? s : w.defaultSize;
}
