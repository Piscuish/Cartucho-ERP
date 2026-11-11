import type { NavigationSectionId } from "@cartucho/shared";
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

export type SettingsTab = "company" | "billing" | "appearance" | "security" | "data" | "about";

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
  { id: "about", label: "Acerca de" },
];
