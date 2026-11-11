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
}

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
