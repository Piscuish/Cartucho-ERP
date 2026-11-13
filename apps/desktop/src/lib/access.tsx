/**
 * Acceso: licencia, módulos activos en la instalación, visibilidad en el menú y rol.
 * Son cuatro controles distintos:
 *  - licencia: qué puede usar el cliente;
 *  - módulo activo: lo que el administrador habilitó (Configuración › Módulos y apartados);
 *  - mostrar en menú: solo visual, no concede ni quita permisos;
 *  - rol: qué puede hacer cada usuario.
 *
 * La regla real se aplica en Rust (cada comando pasa por una compuerta); aquí solo se
 * usa para no mostrar menús, botones o pantallas que el backend rechazaría.
 */
import { createContext, ReactNode, useContext, useMemo } from "react";
import { ALL_MODULES, AuthenticatedUserSummary, LicenseStatus, MODULE_REQUIRES, ModuleKey, ModuleSettings } from "@cartucho/shared";
import { NAV_MODULE } from "../config/moduleRegistry";
import type { Route } from "../config/moduleRegistry";

export interface Access {
  license: LicenseStatus | null;
  /** Licencia desactivada o vencida: solo consultar facturas. */
  restricted: boolean;
  /** La licencia incluye el módulo. */
  licensed: (m: ModuleKey) => boolean;
  /** El módulo está activo en la instalación (licencia + activación + dependencias). */
  active: (m: ModuleKey) => boolean;
  /** El administrador ocultó el módulo del menú (solo visual). */
  hiddenInMenu: (m: ModuleKey) => boolean;
  /** Puede ver el módulo (activo y permitido por su rol). */
  can: (m: ModuleKey) => boolean;
  /** Puede crear o modificar en el módulo. */
  canWrite: (m: ModuleKey) => boolean;
  /** Puede abrir la ruta. */
  canOpen: (r: Route) => boolean;
  /** Administrador: usuarios, roles, empresa, apariencia, licencia y respaldos. */
  isAdmin: boolean;
  /** Menú personalizado de la licencia: ¿se muestra esta opción? (solo visual; los permisos los dan los módulos). */
  showNav: (id: string) => boolean;
  /** Nombre propio de la opción del menú para este cliente, o el nombre normal. */
  navLabel: (id: string, fallback: string) => string;
  /** Función exclusiva habilitada por la licencia (menús hechos a la medida). */
  hasFeature: (feature: string) => boolean;
}

/** Permisos del rol: null = sin restricción (administrador o sin sesión). */
function rolePermissions(user: AuthenticatedUserSummary | null | undefined): Map<string, "read" | "write"> | null {
  if (!user) return null;
  if (user.isAdmin || user.permissions.includes("*")) return null;
  const map = new Map<string, "read" | "write">();
  for (const p of user.permissions) {
    const [m, l] = p.split(":");
    if (l === "read" || l === "write") map.set(m, l);
  }
  return map;
}

/** Módulos utilizables: los de la licencia que no están desactivados y cuya dependencia sigue activa. */
export function activeModuleSet(licensed: Iterable<ModuleKey>, disabled: Iterable<ModuleKey>): Set<ModuleKey> {
  const off = new Set(disabled);
  const set = new Set([...licensed].filter((m) => !off.has(m)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of [...set]) {
      const dep = MODULE_REQUIRES[m];
      if (dep && !set.has(dep)) {
        set.delete(m);
        changed = true;
      }
    }
  }
  return set;
}

export function buildAccess(license: LicenseStatus | null | undefined, user?: AuthenticatedUserSummary | null, settings?: ModuleSettings | null): Access {
  // Backend sin información de licencia (versiones antiguas): todo habilitado.
  const lic = license ?? null;
  const licensedSet = new Set<ModuleKey>(lic ? lic.modules : ALL_MODULES);
  const modules = activeModuleSet(licensedSet, settings?.disabled ?? []);
  const menuHidden = new Set<ModuleKey>(settings?.hidden ?? []);
  const restricted = lic?.mode === "restricted";
  const role = rolePermissions(user);
  const isAdmin = role === null;
  const can = (m: ModuleKey) => modules.has(m) && (role === null || role.has(m));
  const canWrite = (m: ModuleKey) => !restricted && modules.has(m) && (role === null || role.get(m) === "write");
  const canOpen = (r: Route): boolean => {
    switch (r.page) {
      case "dashboard":
      case "settings":
        return true;
      case "invoices":
      case "invoice":
      case "cash-close":
        return can("invoices");
      case "invoice-new":
      case "pos":
        return canWrite("invoices");
      case "quotes":
      case "quote":
        return can("quotes");
      case "quote-new":
        return canWrite("quotes");
      case "customers":
        return can("customers");
      case "catalog":
        return can("catalog");
      case "inventory":
        return can("inventory");
      case "finance":
        return can("finance");
      case "expenses":
        return can("expenses");
    }
  };
  const ui = lic?.ui ?? null;
  const hidden = new Set(ui?.hide ?? []);
  const features = new Set(ui?.features ?? []);
  const showNav = (id: string) => {
    const module = NAV_MODULE[id as keyof typeof NAV_MODULE];
    return !hidden.has(id) && !(module && menuHidden.has(module));
  };
  const navLabel = (id: string, fallback: string) => ui?.labels?.[id] || fallback;
  const hasFeature = (f: string) => features.has(f);
  return {
    license: lic,
    restricted,
    licensed: (m) => licensedSet.has(m),
    active: (m) => modules.has(m),
    hiddenInMenu: (m) => menuHidden.has(m),
    can,
    canWrite,
    canOpen,
    isAdmin,
    showNav,
    navLabel,
    hasFeature,
  };
}

const AccessContext = createContext<Access>(buildAccess(null));

export function AccessProvider({
  license,
  user,
  settings,
  children,
}: {
  license: LicenseStatus | null | undefined;
  user?: AuthenticatedUserSummary | null;
  settings?: ModuleSettings | null;
  children: ReactNode;
}) {
  const value = useMemo(() => buildAccess(license, user, settings), [license, user, settings]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): Access {
  return useContext(AccessContext);
}

export const PLAN_LABELS: Record<string, string> = {
  basico: "Básico",
  tienda: "Tienda",
  completo: "Completo",
  personalizado: "Personalizado",
};
