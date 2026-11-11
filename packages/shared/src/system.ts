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
  updatedAt: string;
}

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
  role: string;
  permissions: string[];
  createdAt: string;
  lastLoginAt: string | null;
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
  SAVE_COMPANY_PROFILE: "save_company_profile",
} as const;
