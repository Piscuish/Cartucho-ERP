/**
 * App de Android: ¿dónde está la base principal? (ADR 0010)
 *
 * - "local": la base está en el teléfono; la app funciona igual que el programa del PC.
 * - "pc": la base está en el PC. Cada operación viaja por la red local al PC (desde Rust,
 *   comando `remote_rpc`) con la sesión del usuario del teléfono.
 *
 * La apariencia es de cada teléfono: en modo PC se guarda aquí y no cambia la del PC.
 */
import { isTauri } from "@tauri-apps/api/core";
import type { Appearance, SystemOverview, ThemePreference } from "@cartucho/shared";

export type AppMode = "local" | "pc";

export interface PcLink {
  base: string;
  tradeName: string | null;
  logoDataUrl: string | null;
  token: string | null;
}

const K_MODE = "cartucho.app.mode";
const K_PC = "cartucho.app.pc";
const K_PREFS = "cartucho.app.prefs";
const K_OVERVIEW = "cartucho.app.pcOverview";
/** En el navegador (vista previa) se puede simular la app: localStorage["cartucho.app.simulate"] = "1". */
const K_SIMULATE = "cartucho.app.simulate";

const read = <T>(k: string): T | null => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sin almacenamiento */
  }
};

/** ¿Es la app de Android (o su simulación en la vista previa)? */
export function isPhoneApp(): boolean {
  try {
    if (localStorage.getItem(K_SIMULATE) === "1") return true;
  } catch {
    /* ignorar */
  }
  try {
    return isTauri() && /android/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

export const getMode = (): AppMode | null => (isPhoneApp() ? read<AppMode>(K_MODE) : null);
export const setMode = (m: AppMode | null) => write(K_MODE, m);
export const isPcMode = () => getMode() === "pc";

export const getPc = (): PcLink | null => read<PcLink>(K_PC);
export const setPc = (p: PcLink | null) => write(K_PC, p);
export const setPcToken = (token: string | null) => {
  const p = getPc();
  if (p) setPc({ ...p, token });
};

/** Cambiar de base principal: se olvidan la conexión y la sesión (los datos no se tocan). */
export function resetAppMode() {
  setMode(null);
  setPc(null);
  write(K_OVERVIEW, null);
}

// ------------------------------------------------------------ Apariencia local (modo PC)

interface LocalPrefs {
  theme?: ThemePreference;
  appearance?: Appearance;
}
export const getLocalPrefs = (): LocalPrefs => read<LocalPrefs>(K_PREFS) ?? {};
export const setLocalPrefs = (p: LocalPrefs) => write(K_PREFS, { ...getLocalPrefs(), ...p });

/** Aplica la apariencia del teléfono sobre el resumen que llega del PC. */
export function withLocalPrefs(o: SystemOverview): SystemOverview {
  const p = getLocalPrefs();
  return {
    ...o,
    preferences: {
      ...o.preferences,
      ...(p.theme ? { theme: p.theme } : {}),
      ...(p.appearance ? { appearance: p.appearance } : {}),
    },
  };
}

// ------------------------------------------------------------ Resumen sin sesión (modo PC)

export function cachePcOverview(o: SystemOverview) {
  // Se guarda sin usuario: sirve para mostrar la pantalla de entrada con el logo del negocio.
  write(K_OVERVIEW, { ...o, isAuthenticated: false, currentUser: null });
}

/** Resumen para la pantalla de entrada cuando aún no hay sesión con el PC. */
export function signedOutOverview(): SystemOverview {
  const cached = read<SystemOverview>(K_OVERVIEW);
  const pc = getPc();
  const now = new Date().toISOString();
  const base: SystemOverview =
    cached ??
    ({
      appName: "Cartucho ERP",
      appVersion: "",
      phase: "",
      architectureMode: "local-first",
      osPlatform: "android",
      osArch: "",
      runtimeMode: "desktop",
      preferences: { theme: "light", autoLockMinutes: 0 },
      database: { appDataDir: pc?.base ?? "" },
      hasAdminUser: true,
      isAuthenticated: false,
      currentUser: null,
      license: null,
      company: {
        tradeName: pc?.tradeName ?? "Cartucho ERP",
        legalName: null,
        taxId: null,
        phone: null,
        email: null,
        address: null,
        logoDataUrl: pc?.logoDataUrl ?? null,
        logoMimeType: null,
        businessProfileKey: "",
        commercialPlanKey: "",
        enabledModuleKeys: [],
        enabledAddonKeys: [],
        createdAt: now,
        updatedAt: now,
      },
    } as unknown as SystemOverview);
  return withLocalPrefs({ ...base, isAuthenticated: false, currentUser: null, hasAdminUser: true });
}

/** Comandos que en modo PC solo existen en el programa del PC (configuración, respaldos…). */
export const PC_ONLY_MESSAGE = "Esta opción solo está disponible en el programa del PC.";

export const REMOTE_COMMANDS = new Set([
  "get_system_overview",
  "get_license_status",
  "get_business_settings",
  "get_dashboard",
  "global_search",
  "get_cash_close",
  "get_customer_statement",
  "list_customers",
  "list_categories",
  "list_products",
  "list_inventory_movements",
  "list_invoices",
  "get_invoice",
  "list_payments",
  "list_quotes",
  "get_quote",
  "list_expenses",
  "finance_summary",
  "list_users",
  "save_customer",
  "set_customer_active",
  "save_category",
  "delete_category",
  "save_product",
  "set_product_active",
  "adjust_stock",
  "create_invoice",
  "add_payment",
  "void_invoice",
  "create_quote",
  "cancel_quote",
  "convert_quote_to_invoice",
  "save_expense",
  "delete_expense",
]);

/** Evento para volver a la pantalla de entrada cuando el PC cerró la sesión. */
export const PC_SESSION_EVENT = "cartucho-pc-session";
