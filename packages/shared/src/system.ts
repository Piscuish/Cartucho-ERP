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
  /** Estilo visual (paleta y forma). Ausente en versiones antiguas → "violeta". */
  visualStyle?: VisualStyleId;
  updatedAt: string;
}

// ------------------------------------------------------------------ Estilos visuales

export type VisualStyleId = "violeta" | "oceano" | "bosque" | "grafito" | "coral";

export interface VisualStyleInfo {
  id: VisualStyleId;
  label: string;
  description: string;
  /** Colores para la miniatura: [menú, fondo, tarjeta, acento, línea] en claro y oscuro. */
  preview: { light: [string, string, string, string, string]; dark: [string, string, string, string, string] };
  /** Radio de esquinas de la miniatura (px). */
  radius: number;
}

export const VISUAL_STYLES: VisualStyleInfo[] = [
  {
    id: "violeta",
    label: "Violeta",
    description: "El estilo original: limpio, con acento violeta.",
    preview: { light: ["#ffffff", "#f4f5f8", "#ffffff", "#6d5dd3", "#d0d5dd"], dark: ["#0a0d13", "#0e1117", "#161b24", "#8b7ff0", "#262d3a"] },
    radius: 6,
  },
  {
    id: "oceano",
    label: "Océano",
    description: "Azul profesional con menú lateral azul marino.",
    preview: { light: ["#0c1a33", "#f2f5f9", "#ffffff", "#1f6feb", "#cbd4e1"], dark: ["#070e1b", "#0b111d", "#121a29", "#4c9aff", "#223049"] },
    radius: 6,
  },
  {
    id: "bosque",
    label: "Bosque",
    description: "Verde y tonos cálidos, tranquilo para todo el día.",
    preview: { light: ["#fbfbf8", "#f5f5f1", "#ffffff", "#1f7a4d", "#d3d2c8"], dark: ["#0b0e0c", "#0f1210", "#161a17", "#4cc38a", "#28302a"] },
    radius: 6,
  },
  {
    id: "grafito",
    label: "Grafito",
    description: "Blanco y negro, esquinas rectas y sin sombras.",
    preview: { light: ["#fafafa", "#f6f6f6", "#ffffff", "#18181b", "#cfcfcf"], dark: ["#09090a", "#0c0c0d", "#141415", "#f4f4f5", "#27272a"] },
    radius: 2,
  },
  {
    id: "coral",
    label: "Coral",
    description: "Naranja cálido y bordes muy redondeados, amigable.",
    preview: { light: ["#fffdfb", "#faf7f5", "#ffffff", "#e8590c", "#ddd0c7"], dark: ["#100d0c", "#141110", "#1c1816", "#ff8a4c", "#322a26"] },
    radius: 10,
  },
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
  SET_VISUAL_STYLE: "set_visual_style",
  SAVE_COMPANY_PROFILE: "save_company_profile",
} as const;
