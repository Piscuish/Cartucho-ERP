import type { ModuleKey, NavigationSectionId } from "@cartucho/shared";
import {
  BarChart3,
  Boxes,
  FilePlus2,
  FileSignature,
  FileText,
  LayoutDashboard,
  LucideIcon,
  Package,
  Receipt,
  Settings,
  Users,
} from "lucide-react";

export type SettingsTab = "company" | "billing" | "appearance" | "security" | "data" | "license" | "about";

/** Ruta interna de la aplicación (navegación sin recargar). */
export type Route =
  | { page: "dashboard" }
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
  invoices: "#6366f1",
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
  invoices: "Historial, abonos y anulaciones.",
  quotes: "Presupuestos que se vuelven factura.",
  customers: "Directorio, compras y saldos.",
  catalog: "Productos y servicios con precio.",
  inventory: "Existencias, compras y movimientos.",
  finance: "Ventas, gastos y balance.",
  expenses: "Arriendo, servicios, nómina…",
  settings: "Empresa, apariencia y respaldos.",
};

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** Estructura del menú lateral. */
export const NAVIGATION: NavGroup[] = [
  {
    label: "General",
    items: [{ id: "dashboard", label: "Inicio", icon: LayoutDashboard, route: { page: "dashboard" }, matches: ["dashboard"] }],
  },
  {
    label: "Ventas",
    items: [
      { id: "invoice-new", label: "Nueva factura", icon: FilePlus2, route: { page: "invoice-new" }, matches: ["invoice-new"] },
      { id: "invoices", label: "Facturas", icon: FileText, route: { page: "invoices" }, matches: ["invoices", "invoice"] },
      { id: "quotes", label: "Cotizaciones", icon: FileSignature, route: { page: "quotes" }, matches: ["quotes", "quote", "quote-new"] },
      { id: "customers", label: "Clientes", icon: Users, route: { page: "customers" }, matches: ["customers"] },
    ],
  },
  {
    label: "Productos",
    items: [
      { id: "catalog", label: "Catálogo", icon: Package, route: { page: "catalog" }, matches: ["catalog"] },
      { id: "inventory", label: "Inventario", icon: Boxes, route: { page: "inventory" }, matches: ["inventory"] },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { id: "finance", label: "Resumen", icon: BarChart3, route: { page: "finance" }, matches: ["finance"] },
      { id: "expenses", label: "Gastos", icon: Receipt, route: { page: "expenses" }, matches: ["expenses"] },
    ],
  },
  {
    label: "Sistema",
    items: [{ id: "settings", label: "Configuración", icon: Settings, route: { page: "settings" }, matches: ["settings"] }],
  },
];

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "company", label: "Mi empresa" },
  { id: "billing", label: "Facturación e impresión" },
  { id: "appearance", label: "Apariencia" },
  { id: "security", label: "Usuario y seguridad" },
  { id: "data", label: "Base de datos y respaldos" },
  { id: "license", label: "Licencia" },
  { id: "about", label: "Acerca de" },
];
