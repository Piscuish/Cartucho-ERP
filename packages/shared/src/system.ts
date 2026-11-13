/**
 * Contratos compartidos entre el frontend (React + TypeScript)
 * y la capa nativa de escritorio (Tauri 2 + Rust + SQLite).
 */

export type RuntimeMode = "tauri-desktop" | "browser-preview";

export type ThemePreference = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

/**
 * Identificadores de las pantallas principales de la aplicación.
 */
export type NavigationSectionId =
  | "dashboard"
  | "invoices"
  | "invoice-new"
  | "pos"
  | "cash-close"
  | "quotes"
  | "customers"
  | "catalog"
  | "inventory"
  | "finance"
  | "expenses"
  | "settings";

export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: string;
}

export interface PersistenceCheckRecord {
  id: number;
  note: string;
  createdAt: string;
}

export interface DatabaseStatusReport {
  connected: boolean;
  engine: "SQLite";
  sqliteVersion: string;
  journalMode: string;
  foreignKeysEnabled: boolean;
  databasePath: string;
  appDataDir: string;
  databaseSizeBytes: number;
  schemaVersion: number;
  appliedMigrations: MigrationRecord[];
  startupCount: number;
  firstInitializedAt: string;
  lastOpenedAt: string;
  recentPersistenceChecks: PersistenceCheckRecord[];
}

export interface AppPreferences {
  theme: ThemePreference;
  /** Diseño, fondos y color. Ausente en versiones antiguas → DEFAULT_APPEARANCE. */
  appearance?: Appearance;
  /** Minutos sin uso antes de cerrar la sesión (0 = nunca). */
  autoLockMinutes?: number;
  /** Diseño del panel, tema de color y widgets de la sesión. Ausente en backends antiguos → DEFAULT_UI_PREFERENCES. */
  ui?: UiPreferences;
  /** El usuario eligió su propia apariencia (si no, usa la predeterminada de la instalación). */
  uiPersonal?: boolean;
  updatedAt: string;
}

// ------------------------------------------------------------------ Panel: diseño, tema y widgets
// Tres decisiones independientes. El DISEÑO define la distribución del panel; el TEMA define
// los colores; los WIDGETS definen qué información aparece y en qué orden.

/** Estilo de diseño del panel de inicio (estructura y distribución, nunca colores). */
export type DashboardLayoutId = "columns" | "analytics" | "widgets";
/** Tema de color global (paleta, nunca distribución). */
export type ColorThemeId = "white" | "black" | "gray";
export type WidgetSize = "small" | "medium" | "wide";

export type WidgetId =
  | "salesKpi"
  | "collectedKpi"
  | "expensesKpi"
  | "balanceKpi"
  | "receivableKpi"
  | "salesTrend"
  | "incomeVsExpenses"
  | "paymentMethods"
  | "expensesByCategory"
  | "topProducts"
  | "lowStock"
  | "recentInvoices"
  | "overdueAlerts"
  | "dueCalendar"
  | "quickActions";

export interface UiPreferences {
  dashboardLayout: DashboardLayoutId;
  /** null: se deriva del tema anterior (claro → Blanco, oscuro → Negro). */
  colorTheme: ColorThemeId | null;
  /** Widgets visibles, en orden. null: el conjunto predeterminado del diseño. */
  dashboardWidgets: WidgetId[] | null;
  widgetSizes: Partial<Record<WidgetId, WidgetSize>>;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = { dashboardLayout: "columns", colorTheme: null, dashboardWidgets: null, widgetSizes: {} };

export interface DashboardLayoutInfo {
  id: DashboardLayoutId;
  letter: string;
  label: string;
  description: string;
  advantages: string[];
}

export const DASHBOARD_LAYOUTS: DashboardLayoutInfo[] = [
  {
    id: "columns",
    letter: "A",
    label: "Clásico por columnas",
    description: "Indicadores en columnas, gráfica de barras y accesos rápidos. Se lee de arriba hacia abajo.",
    advantages: ["Rápido y fácil de usar", "Enfoque en las cifras clave", "Ideal para el día a día"],
  },
  {
    id: "analytics",
    letter: "B",
    label: "Analítico y de tendencias",
    description: "Una gráfica amplia de evolución con indicadores y composición alrededor.",
    advantages: ["Muestra tendencias y variaciones", "Compara con el periodo anterior", "Para control y crecimiento"],
  },
  {
    id: "widgets",
    letter: "C",
    label: "Modular por widgets",
    description: "Tú eliges qué bloques ver, en qué orden y de qué tamaño.",
    advantages: ["Se adapta a cada persona", "Agrega, quita y reordena", "Solo lo más relevante para ti"],
  },
];

/** Colores de cada tema (los mismos tokens que usa la hoja de estilos). */
export interface ColorThemeInfo {
  id: ColorThemeId;
  label: string;
  description: string;
  /** Base clara u oscura (para los estilos que dependen de eso). */
  base: ResolvedTheme;
  swatch: { bg: string; surface: string; border: string; text: string; text2: string; accent: string };
}

export const COLOR_THEMES: ColorThemeInfo[] = [
  { id: "white", label: "Blanco", description: "Limpio, moderno y con alta legibilidad.", base: "light", swatch: { bg: "#F5F7FA", surface: "#FFFFFF", border: "#E5E7EB", text: "#273244", text2: "#667085", accent: "#2563EB" } },
  { id: "black", label: "Negro", description: "Oscuro y cómodo para trabajar con poca luz.", base: "dark", swatch: { bg: "#0E1117", surface: "#191F29", border: "#303846", text: "#F3F4F6", text2: "#A7B0BD", accent: "#60A5FA" } },
  { id: "gray", label: "Gris", description: "Equilibrado, profesional y versátil.", base: "light", swatch: { bg: "#E5E7EB", surface: "#F3F4F6", border: "#C8CDD5", text: "#303742", text2: "#626B75", accent: "#3B82F6" } },
];

export const WIDGET_SIZE_LABELS: Record<WidgetSize, string> = { small: "Pequeño", medium: "Mediano", wide: "Ancho" };

// ------------------------------------------------------------------ Apariencia

/** Estilo del menú lateral y de las tarjetas (anterior «diseño»). No es el diseño del panel. */
export type LayoutId = "clasico" | "riel" | "flotante" | "estudio";
/** Fondos para el tema claro. */
export type LightBgId = "blanco" | "calido" | "hielo";
/** Fondos para el tema oscuro. */
export type DarkBgId = "pizarra" | "grafito" | "negro" | "noche" | "morado" | "bosque";
/** Color de botones, bordes activos y resaltados. */
export type AccentId = "violeta" | "azul" | "cian" | "verde" | "naranja" | "rosa" | "rojo" | "ambar" | "mono";

export interface Appearance {
  layout: LayoutId;
  bgLight: LightBgId;
  bgDark: DarkBgId;
  accent: AccentId;
  /** Bordes de tarjetas y campos teñidos con el color de acento. */
  tintedBorders: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = { layout: "clasico", bgLight: "blanco", bgDark: "pizarra", accent: "azul", tintedBorders: false };

export interface LayoutInfo {
  id: LayoutId;
  label: string;
  description: string;
}

export const LAYOUTS: LayoutInfo[] = [
  { id: "clasico", label: "Clásico", description: "Menú con secciones y tarjetas limpias." },
  { id: "riel", label: "Riel", description: "Menú de íconos de colores y métricas en bloques de color." },
  { id: "flotante", label: "Flotante", description: "La ventana flota sobre un degradado; menú con píldora brillante." },
  { id: "estudio", label: "Estudio", description: "Logo grande, menú amplio e inicio con módulos." },
];

/** Colores de muestra: fondo, tarjeta, menú lateral, línea y texto. */
export interface BackgroundInfo<T extends string> {
  id: T;
  label: string;
  swatch: { bg: string; surface: string; sidebar: string; line: string; text: string };
}

export const LIGHT_BACKGROUNDS: BackgroundInfo<LightBgId>[] = [
  { id: "blanco", label: "Blanco", swatch: { bg: "#f4f5f8", surface: "#ffffff", sidebar: "#ffffff", line: "#e4e7ec", text: "#161b26" } },
  { id: "calido", label: "Cálido", swatch: { bg: "#f6f4f0", surface: "#ffffff", sidebar: "#fbfaf7", line: "#e7e3da", text: "#1f1b16" } },
  { id: "hielo", label: "Hielo", swatch: { bg: "#eef3f9", surface: "#ffffff", sidebar: "#f7faff", line: "#dde5f0", text: "#0f1a2b" } },
];

export const DARK_BACKGROUNDS: BackgroundInfo<DarkBgId>[] = [
  { id: "pizarra", label: "Pizarra", swatch: { bg: "#0e1117", surface: "#161b24", sidebar: "#0a0d13", line: "#262d3a", text: "#e8ebf2" } },
  { id: "grafito", label: "Grafito", swatch: { bg: "#18181a", surface: "#222225", sidebar: "#141416", line: "#2f2f33", text: "#ececee" } },
  { id: "negro", label: "Negro", swatch: { bg: "#070708", surface: "#111113", sidebar: "#000000", line: "#232327", text: "#f2f2f3" } },
  { id: "noche", label: "Azul noche", swatch: { bg: "#0b1220", surface: "#121b2d", sidebar: "#081022", line: "#223049", text: "#e6ecf5" } },
  { id: "morado", label: "Morado noche", swatch: { bg: "#120d1f", surface: "#1a1430", sidebar: "#0d0919", line: "#2c2347", text: "#efeaf8" } },
  { id: "bosque", label: "Bosque noche", swatch: { bg: "#0f1210", surface: "#161a17", sidebar: "#0b0e0c", line: "#28302a", text: "#e7ebe6" } },
];

export interface AccentInfo {
  id: AccentId;
  label: string;
  light: string;
  dark: string;
}

export const ACCENTS: AccentInfo[] = [
  { id: "violeta", label: "Violeta", light: "#6d5dd3", dark: "#8b7ff0" },
  { id: "azul", label: "Azul", light: "#1f6feb", dark: "#4c9aff" },
  { id: "cian", label: "Cian", light: "#0891b2", dark: "#22d3ee" },
  { id: "verde", label: "Verde", light: "#1f7a4d", dark: "#4cc38a" },
  { id: "naranja", label: "Naranja", light: "#e8590c", dark: "#ff8a4c" },
  { id: "rosa", label: "Rosa", light: "#d6336c", dark: "#f472b6" },
  { id: "rojo", label: "Rojo", light: "#d92d20", dark: "#f87171" },
  { id: "ambar", label: "Ámbar", light: "#b45309", dark: "#fbbf24" },
  { id: "mono", label: "Blanco y negro", light: "#18181b", dark: "#f4f4f5" },
];

/** Combinaciones rápidas: aplican diseño, fondos, acento y tema de una vez. */
export interface AppearancePreset {
  id: string;
  label: string;
  description: string;
  theme: "light" | "dark";
  appearance: Appearance;
}

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  { id: "clasico", label: "Clásico", description: "La plantilla predeterminada.", theme: "light", appearance: { ...DEFAULT_APPEARANCE } },
  { id: "oceano", label: "Océano", description: "Azul profesional.", theme: "light", appearance: { layout: "clasico", bgLight: "hielo", bgDark: "noche", accent: "azul", tintedBorders: false } },
  { id: "bosque", label: "Bosque", description: "Verde y cálido.", theme: "light", appearance: { layout: "clasico", bgLight: "calido", bgDark: "bosque", accent: "verde", tintedBorders: false } },
  { id: "coral", label: "Coral", description: "Naranja amigable.", theme: "light", appearance: { layout: "flotante", bgLight: "calido", bgDark: "grafito", accent: "naranja", tintedBorders: false } },
  { id: "berenjena", label: "Berenjena", description: "Morado noche, sobrio.", theme: "dark", appearance: { layout: "clasico", bgLight: "blanco", bgDark: "morado", accent: "violeta", tintedBorders: false } },
  { id: "panel", label: "Panel", description: "Íconos de colores, azul noche.", theme: "dark", appearance: { layout: "riel", bgLight: "hielo", bgDark: "noche", accent: "azul", tintedBorders: false } },
  { id: "medianoche", label: "Medianoche", description: "Negro con píldora violeta.", theme: "dark", appearance: { layout: "flotante", bgLight: "blanco", bgDark: "negro", accent: "violeta", tintedBorders: false } },
  { id: "estudio", label: "Estudio", description: "Grafito y blanco, sobrio.", theme: "dark", appearance: { layout: "estudio", bgLight: "blanco", bgDark: "grafito", accent: "mono", tintedBorders: false } },
  { id: "negro-azul", label: "Negro y azul", description: "Fondo negro, botones y bordes azules.", theme: "dark", appearance: { layout: "clasico", bgLight: "hielo", bgDark: "negro", accent: "azul", tintedBorders: true } },
];

/**
 * Tipos MIME permitidos para el logotipo almacenado como BLOB en SQLite.
 * SVG queda excluido inicialmente hasta contar con sanitización dedicada.
 */
export type AllowedLogoMimeType = "image/png" | "image/jpeg" | "image/webp";

/**
 * Perfil de la única empresa configurada en la instalación local.
 * Mantiene desacoplados el tipo de negocio, los módulos habilitados,
 * el plan comercial y los complementos adicionales.
 */
export interface CompanyProfile {
  tradeName: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logoDataUrl: string | null;
  logoMimeType: string | null;
  businessProfileKey: string;
  commercialPlanKey: string;
  enabledModuleKeys: string[];
  enabledAddonKeys: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Datos de entrada para crear o actualizar la información de la empresa.
 * El logotipo se envía codificado en Base64 junto con su tipo MIME (`image/png`, `image/jpeg`, `image/webp`)
 * para almacenarse como BLOB puro en SQLite.
 */
export interface SaveCompanyProfileInput {
  tradeName: string;
  legalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logoBase64?: string | null;
  logoMimeType?: string | null;
  removeLogo?: boolean;
}

/**
 * Datos de entrada para crear el primer administrador durante la configuración inicial.
 */
export interface CreateInitialAdminInput {
  fullName: string;
  username: string;
  password: string;
  passwordConfirm: string;
}

/**
 * Carga atómica de configuración inicial: registra la empresa y el administrador principal
 * en una única transacción SQLite.
 */
export interface CompleteInitialSetupInput {
  company: SaveCompanyProfileInput;
  admin: CreateInitialAdminInput;
  /** Tamaño de hoja predeterminado elegido en el asistente. */
  paperSize?: string | null;
}

/** Dónde guardar los datos en la primera ejecución. */
export type SetupDataMode = "default" | "folder" | "existing";

/**
 * Credenciales de inicio de sesión local.
 */
export interface LoginInput {
  username: string;
  password: string;
}

/**
 * Datos de entrada para cambiar la contraseña del usuario autenticado.
 * El backend Rust verifica primero `currentPassword` mediante Argon2id.
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
  newPasswordConfirm: string;
}

/**
 * Resumen seguro del usuario autenticado (nunca incluye hashes ni secretos).
 * Mantiene roles y permisos asociados al usuario, separados del perfil y plan de la empresa.
 */
export interface AuthenticatedUserSummary {
  id: number;
  fullName: string;
  username: string;
  /** Clave del rol ("admin", "vendedor"…). */
  role: string;
  /** Nombre visible del rol. */
  roleName?: string;
  isAdmin?: boolean;
  /** ["*"] para el administrador; si no, "modulo:read" o "modulo:write". */
  permissions: string[];
  createdAt: string;
  lastLoginAt: string | null;
}

// ------------------------------------------------------------------ Usuarios y roles

export type AccessLevel = "none" | "read" | "write";

export interface Role {
  id: number;
  key: string;
  name: string;
  description: string | null;
  /** El rol Administrador: acceso total, no se borra. */
  isSystem: boolean;
  /** Módulo → "read" | "write" (vacío para el administrador). */
  permissions: Partial<Record<ModuleKey, "read" | "write">>;
  userCount: number;
}

export interface RoleInput {
  id: number | null;
  name: string;
  description: string | null;
  permissions: Partial<Record<ModuleKey, AccessLevel>>;
}

export interface UserAccount {
  id: number;
  username: string;
  fullName: string;
  roleKey: string;
  roleName: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface UserInput {
  id: number | null;
  fullName: string;
  username: string;
  roleKey: string;
  /** Obligatoria al crear; al editar, solo para cambiarla. */
  password: string | null;
  isActive: boolean;
}

export const USER_COMMANDS = {
  LIST_ROLES: "list_roles",
  SAVE_ROLE: "save_role",
  DELETE_ROLE: "delete_role",
  LIST_USERS: "list_users",
  SAVE_USER: "save_user",
} as const;

/** Acceso desde celulares por la red local (ADR 0009). Solo administradores. */
export const LAN_COMMANDS = {
  GET_LAN_STATUS: "get_lan_status",
  SET_LAN_ACCESS: "set_lan_access",
  DISCONNECT_LAN_DEVICES: "disconnect_lan_devices",
} as const;

export interface LanStatus {
  /** El administrador dejó activo el acceso (se vuelve a abrir al iniciar el programa). */
  enabled: boolean;
  /** El servidor está funcionando en este momento. */
  running: boolean;
  port: number;
  /** Direcciones para abrir en el celular; la primera es la recomendada. */
  urls: string[];
  /** Código QR (SVG) de la primera dirección. */
  qrSvg: string | null;
  activeSessions: number;
  error: string | null;
  /** La app de Android puede registrar ventas, clientes y gastos (no solo consultar). */
  writesAllowed?: boolean;
}

export interface SystemOverview {
  appName: string;
  appVersion: string;
  phase: string;
  architectureMode: "local-first";
  osPlatform: string;
  osArch: string;
  runtimeMode: RuntimeMode;
  preferences: AppPreferences;
  database: DatabaseStatusReport;
  company: CompanyProfile | null;
  hasAdminUser: boolean;
  isAuthenticated: boolean;
  currentUser: AuthenticatedUserSummary | null;
  /** Estado de la licencia (null en versiones antiguas del backend). */
  license?: LicenseStatus | null;
  /** Módulos desactivados u ocultos (ausente en backends antiguos: todo activo y visible). */
  moduleSettings?: ModuleSettings;
}

// ------------------------------------------------------------------ Licencias y módulos

/** Módulos que se pueden activar o desactivar por cliente. */
export type ModuleKey = "invoices" | "quotes" | "customers" | "catalog" | "inventory" | "expenses" | "finance";

export const ALL_MODULES: ModuleKey[] = ["invoices", "quotes", "customers", "catalog", "inventory", "expenses", "finance"];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  invoices: "Facturas",
  quotes: "Cotizaciones",
  customers: "Clientes",
  catalog: "Catálogo",
  inventory: "Inventario",
  expenses: "Gastos",
  finance: "Resumen financiero",
};

/**
 * Dependencias obligatorias entre módulos (igual que `module_requires` en Rust, que es la
 * regla que realmente se aplica).
 */
export const MODULE_REQUIRES: Partial<Record<ModuleKey, ModuleKey>> = {
  quotes: "invoices",
  inventory: "catalog",
  finance: "invoices",
};

/**
 * - dev: compilación de desarrollo sin clave pública (todo habilitado).
 * - licensed: licencia válida.
 * - restricted: licencia desactivada o vencida: solo ver facturas.
 * - unlicensed: aún no se ha activado en este equipo.
 */
export type LicenseMode = "dev" | "licensed" | "restricted" | "unlicensed";

export interface LicenseStatus {
  mode: LicenseMode;
  reason: string | null;
  message: string | null;
  customer: string | null;
  plan: string | null;
  modules: ModuleKey[];
  maxDevices: number | null;
  validUntil: string | null;
  daysLeft: number | null;
  licenseExpiresAt: string | null;
  lastCheckAt: string | null;
  lastCheckError: string | null;
  deviceCode: string;
  serverConfigured: boolean;
  licenseKeyMasked: string | null;
  support: string | null;
  /** Empresa registrada con la licencia: llena sola el asistente inicial. */
  company?: LicenseCompany | null;
  /** `false` cuando esta copia no usa licencias (todo habilitado). */
  licensingEnabled?: boolean;
  /** Menú personalizado del cliente (viene en la licencia). */
  ui?: LicenseUi | null;
}

/** Activación y visibilidad de módulos decididas por el administrador de la instalación. */
export interface ModuleSettings {
  /** Módulos desactivados para esta empresa (sus datos se conservan). */
  disabled: ModuleKey[];
  /** Módulos ocultos del menú. Solo visual: no quita permisos. */
  hidden: ModuleKey[];
}

export const MODULE_COMMANDS = {
  SET_MODULE_ACTIVE: "set_module_active",
  SET_MODULE_VISIBLE: "set_module_visible",
} as const;

export interface LicenseUi {
  /** Opciones del menú ocultas (ids de NavigationSectionId). */
  hide: string[];
  /** Nombres propios por opción. */
  labels: Record<string, string>;
  /** Funciones exclusivas habilitadas. */
  features: string[];
}

export interface LicenseCompany {
  tradeName: string | null;
  legalName: string | null;
  taxId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export const LICENSE_COMMANDS = {
  GET_LICENSE_STATUS: "get_license_status",
  ACTIVATE_LICENSE_ONLINE: "activate_license_online",
  ACTIVATE_LICENSE_OFFLINE: "activate_license_offline",
  CHECK_LICENSE_NOW: "check_license_now",
} as const;

export const LICENSE_CHANGED_EVENT = "license-changed";

export const TAURI_COMMANDS = {
  GET_SYSTEM_OVERVIEW: "get_system_overview",
  COMPLETE_INITIAL_SETUP: "complete_initial_setup",
  LOGIN_USER: "login_user",
  LOGOUT_USER: "logout_user",
  CHANGE_USER_PASSWORD: "change_user_password",
  RECORD_PERSISTENCE_CHECK: "record_persistence_check",
  SET_THEME_PREFERENCE: "set_theme_preference",
  SET_APPEARANCE: "set_appearance",
  SET_UI_PREFERENCES: "set_ui_preferences",
  RESET_UI_PREFERENCES: "reset_ui_preferences",
  SAVE_COMPANY_PROFILE: "save_company_profile",
} as const;
