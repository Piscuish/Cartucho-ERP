/**
 * Acceso por licencia: qué módulos están activos y si la instalación está restringida.
 *
 * La regla real se aplica en Rust (cada comando pasa por una compuerta); aquí solo se
 * usa para no mostrar menús, botones o pantallas que el backend rechazaría.
 */
import { createContext, ReactNode, useContext, useMemo } from "react";
import { ALL_MODULES, AuthenticatedUserSummary, LicenseStatus, ModuleKey } from "@cartucho/shared";
import type { Route } from "../config/moduleRegistry";

export interface Access {
  license: LicenseStatus | null;
  /** Licencia desactivada o vencida: solo consultar facturas. */
  restricted: boolean;
  /** Puede ver el módulo. */
  can: (m: ModuleKey) => boolean;
  /** Puede crear o modificar en el módulo. */
  canWrite: (m: ModuleKey) => boolean;
  /** Puede abrir la ruta. */
  canOpen: (r: Route) => boolean;
  /** Administrador: usuarios, roles, empresa, apariencia, licencia y respaldos. */
  isAdmin: boolean;
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

export function buildAccess(license: LicenseStatus | null | undefined, user?: AuthenticatedUserSummary | null): Access {
  // Backend sin información de licencia (versiones antiguas): todo habilitado.
  const lic = license ?? null;
  const modules = new Set<ModuleKey>(lic ? lic.modules : ALL_MODULES);
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
        return can("invoices");
      case "invoice-new":
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
  return { license: lic, restricted, can, canWrite, canOpen, isAdmin };
}

const AccessContext = createContext<Access>(buildAccess(null));

export function AccessProvider({
  license,
  user,
  children,
}: {
  license: LicenseStatus | null | undefined;
  user?: AuthenticatedUserSummary | null;
  children: ReactNode;
}) {
  const value = useMemo(() => buildAccess(license, user), [license, user]);
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
