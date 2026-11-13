import type { ModuleKey, NavigationSectionId } from "@cartucho/shared";
import {
  BarChart3,
  Boxes,
  Calculator,
  FilePlus2,
  FileSignature,
  FileText,
  LayoutDashboard,
  LucideIcon,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
} from "lucide-react";

export type SettingsTab = "company" | "modules" | "billing" | "appearance" | "users" | "mobile" | "security" | "data" | "license" | "updates" | "app" | "about";

/** Ruta interna de la aplicación (navegación sin recargar). */
export type Route =
  | { page: "dashboard" }
  | { page: "cash-close" }
  | { page: "pos" }
  | { page: "invoices"; status?: string }
  | { page: "invoice"; id: number; print?: boolean }
  | { page: "invoice-new"; customerId?: number; fromInvoiceId?: number }
  | { page: "quotes" }
  | { page: "quote"; id: number; print?: boolean }
  | { page: "quote-new"; customerId?: number; fromQuoteId?: number }
  | { page: "customers"; openId?: number }
  | { page: "catalog"; openId?: number }
  | { page: "inventory" }
  | { page: "finance" }
  | { page: "expenses" }
  | { page: "settings"; tab?: SettingsTab };

export interface NavItem {
  id: NavigationSectionId;
  label: string;
  icon: LucideIcon;
  route: Route;
  /** Páginas que deben marcar este elemento como activo. */
  matches: Route["page"][];
}

/** Módulo de licencia que habilita cada elemento del menú (sin módulo = siempre visible). */
export const NAV_MODULE: Partial<Record<NavigationSectionId, ModuleKey>> = {
  invoices: "invoices",
  "invoice-new": "invoices",
  pos: "invoices",
  "cash-close": "invoices",
  quotes: "quotes",
  customers: "customers",
  catalog: "catalog",
  inventory: "inventory",
  finance: "finance",
  expenses: "expenses",
};

/** Color de cada sección (lo usan los diseños con íconos de colores). */
export const NAV_TONE: Partial<Record<NavigationSectionId, string>> = {
  dashboard: "#3b82f6",
  "invoice-new": "#8b5cf6",
  pos: "#10b981",
  invoices: "#6366f1",
  "cash-close": "#0ea5e9",
  quotes: "#06b6d4",
  customers: "#14b8a6",
  catalog: "#22c55e",
  inventory: "#f59e0b",
  finance: "#ec4899",
  expenses: "#ef4444",
  settings: "#94a3b8",
};

/** Descripción corta de cada sección (inicio del diseño Estudio). */
export const NAV_DESCRIPTION: Partial<Record<NavigationSectionId, string>> = {
  "invoice-new": "Vende e imprime una factura.",
  pos: "Cobra rápido en el mostrador.",
  invoices: "Historial, abonos y anulaciones.",
  "cash-close": "Lo cobrado hoy por forma de pago.",
  quotes: "Presupuestos que se vuelven factura.",
  customers: "Directorio, compras y saldos.",
  catalog: "Productos y servicios con precio.",
  inventory: "Existencias, compras y movimientos.",
  finance: "Ventas, cobros, gastos y balance.",
  expenses: "Arriendo, servicios, nómina…",
  settings: "Empresa, apariencia y respaldos.",
};

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Estructura del menú lateral, por áreas de trabajo estables: operación diaria, dinero y
 * administración. Inicio y Configuración son áreas del sistema y nunca desaparecen.
 */
export const NAVIGATION: NavGroup[] = [
  // Grupos de un solo elemento sin título: ahorran espacio vertical.
  {
    label: "",
    items: [{ id: "dashboard", label: "Inicio", icon: LayoutDashboard, route: { page: "dashboard" }, matches: ["dashboard"] }],
  },
  {
    label: "Operación diaria",
    items: [
      { id: "pos", label: "Punto de venta", icon: ShoppingCart, route: { page: "pos" }, matches: ["pos"] },
      { id: "invoice-new", label: "Nueva factura", icon: FilePlus2, route: { page: "invoice-new" }, matches: ["invoice-new"] },
      { id: "invoices", label: "Facturas", icon: FileText, route: { page: "invoices" }, matches: ["invoices", "invoice"] },
      { id: "quotes", label: "Cotizaciones", icon: FileSignature, route: { page: "quotes" }, matches: ["quotes", "quote", "quote-new"] },
      { id: "customers", label: "Clientes", icon: Users, route: { page: "customers" }, matches: ["customers"] },
      { id: "catalog", label: "Catálogo", icon: Package, route: { page: "catalog" }, matches: ["catalog"] },
      { id: "inventory", label: "Inventario", icon: Boxes, route: { page: "inventory" }, matches: ["inventory"] },
    ],
  },
  {
    label: "Dinero",
    items: [
      { id: "finance", label: "Finanzas", icon: BarChart3, route: { page: "finance" }, matches: ["finance"] },
      { id: "expenses", label: "Gastos", icon: Receipt, route: { page: "expenses" }, matches: ["expenses"] },
      { id: "cash-close", label: "Cierre de caja", icon: Calculator, route: { page: "cash-close" }, matches: ["cash-close"] },
    ],
  },
  {
    label: "Administración",
    items: [{ id: "settings", label: "Configuración", icon: Settings, route: { page: "settings" }, matches: ["settings"] }],
  },
];

// ------------------------------------------------------------------ Registro de módulos
// Fuente única para la pantalla Configuración › Módulos y apartados. Las dependencias
// obligatorias salen de MODULE_REQUIRES (@cartucho/shared), que refleja la regla de Rust.

export type ModuleGroup = "Operación diaria" | "Dinero" | "Administración";

export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  description: string;
  group: ModuleGroup;
  icon: LucideIcon;
  /** Por qué necesita su módulo base (si tiene). */
  dependencyReason?: string;
  /** Módulos con los que se integra sin exigirlos. */
  optional?: ModuleKey[];
  /** Apartados del menú que habilita. */
  sections: string[];
  /** Pantalla principal del módulo. */
  route: Route;
}

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    key: "invoices",
    name: "Ventas y facturación",
    description: "Facturas, punto de venta, abonos, anulaciones y cierre de caja.",
    group: "Operación diaria",
    icon: FileText,
    optional: ["customers", "catalog", "inventory"],
    sections: ["Punto de venta", "Nueva factura", "Facturas", "Cierre de caja"],
    route: { page: "invoices" },
  },
  {
    key: "quotes",
    name: "Cotizaciones",
    description: "Presupuestos que se convierten en factura.",
    group: "Operación diaria",
    icon: FileSignature,
    dependencyReason: "Las cotizaciones se convierten en facturas y comparten clientes, líneas y numeración.",
    sections: ["Cotizaciones"],
    route: { page: "quotes" },
  },
  {
    key: "customers",
    name: "Clientes",
    description: "Directorio, historial de compras, saldos y estados de cuenta.",
    group: "Operación diaria",
    icon: Users,
    sections: ["Clientes"],
    route: { page: "customers" },
  },
  {
    key: "catalog",
    name: "Catálogo",
    description: "Productos y servicios con precio, categorías y códigos de barras.",
    group: "Operación diaria",
    icon: Package,
    sections: ["Catálogo"],
    route: { page: "catalog" },
  },
  {
    key: "inventory",
    name: "Inventario",
    description: "Controla existencias, movimientos y alertas de stock bajo.",
    group: "Operación diaria",
    icon: Boxes,
    dependencyReason: "Catálogo permite crear y administrar los productos a los que se asocian las existencias.",
    sections: ["Inventario"],
    route: { page: "inventory" },
  },
  {
    key: "expenses",
    name: "Gastos",
    description: "Arriendo, servicios, compras y demás egresos del negocio.",
    group: "Dinero",
    icon: Receipt,
    sections: ["Gastos"],
    route: { page: "expenses" },
  },
  {
    key: "finance",
    name: "Finanzas",
    description: "Resumen de ventas, cobros, gastos y balance por periodo.",
    group: "Dinero",
    icon: BarChart3,
    dependencyReason: "El resumen financiero se calcula a partir de las ventas y sus cobros.",
    optional: ["expenses"],
    sections: ["Finanzas"],
    route: { page: "finance" },
  },
];

/**
 * Módulos previstos en el plan de evolución que aún NO existen en esta versión. Se muestran
 * solo como hoja de ruta: no se pueden activar, no aparecen en el menú y no tienen datos.
 */
export interface PlannedModule {
  name: string;
  description: string;
  group: ModuleGroup;
  needs: string;
}

export const PLANNED_MODULES: PlannedModule[] = [
  { name: "Proveedores", description: "Directorio, documentos y estados de cuenta de proveedores.", group: "Operación diaria", needs: "Sin requisitos" },
  { name: "Compras", description: "Órdenes, recepciones, facturas de compra y devoluciones.", group: "Operación diaria", needs: "Necesitará Proveedores y Catálogo" },
  { name: "Cuentas por pagar", description: "Obligaciones con proveedores, abonos y vencimientos.", group: "Dinero", needs: "Necesitará Proveedores y Compras" },
  { name: "Bancos y conciliación", description: "Cuentas bancarias, transferencias y conciliación de extractos.", group: "Dinero", needs: "Necesitará Finanzas" },
  { name: "Contabilidad", description: "Plan de cuentas, comprobantes, libros y estados financieros.", group: "Dinero", needs: "Requiere validación con un contador público" },
  { name: "Activos fijos", description: "Registro de activos, depreciación y bajas.", group: "Administración", needs: "Necesitará Contabilidad para contabilizar" },
  { name: "Personal y nómina", description: "Empleados, novedades y liquidaciones.", group: "Administración", needs: "Requiere validación laboral y contable" },
  { name: "Facturación electrónica DIAN", description: "Emisión y transmisión con un proveedor tecnológico habilitado.", group: "Administración", needs: "Necesitará Ventas y un proveedor autorizado" },
];

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "company", label: "Mi empresa" },
  { id: "modules", label: "Módulos y apartados" },
  { id: "billing", label: "Facturación e impresión" },
  { id: "appearance", label: "Apariencia" },
  { id: "users", label: "Usuarios y roles" },
  { id: "mobile", label: "Celulares" },
  { id: "security", label: "Usuario y seguridad" },
  { id: "data", label: "Base de datos y respaldos" },
  { id: "license", label: "Licencia" },
  { id: "updates", label: "Actualizaciones" },
  { id: "app", label: "Base principal" },
  { id: "about", label: "Acerca de" },
];
