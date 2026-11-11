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
  updatedAt: string;
}

// ------------------------------------------------------------------ Apariencia

/** Diseño: estructura y forma (menú, tarjetas, esquinas). */
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

export const DEFAULT_APPEARANCE: Appearance = { layout: "clasico", bgLight: "blanco", bgDark: "pizarra", accent: "violeta", tintedBorders: false };

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
}

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
  SAVE_COMPANY_PROFILE: "save_company_profile",
} as const;
