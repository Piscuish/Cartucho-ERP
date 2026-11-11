import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AuthenticatedUserSummary,
  ChangePasswordInput,
  CompanyProfile,
  CompleteInitialSetupInput,
  LoginInput,
  SaveCompanyProfileInput,
  SystemOverview,
  TAURI_COMMANDS,
  ThemePreference,
} from "@cartucho/shared";

const BROWSER_STORAGE_KEY = "cartucho_erp_phase0_preview_state_v2";
const THEME_STORAGE_KEY = "cartucho_erp_theme_preference";

interface BrowserStoredAdmin {
  summary: AuthenticatedUserSummary;
  passwordVerifier: string;
}

interface BrowserPreviewState {
  startupCount: number;
  firstInitializedAt: string;
  lastOpenedAt: string;
  theme: ThemePreference;
  themeUpdatedAt: string;
  checks: Array<{ id: number; note: string; createdAt: string }>;
  company: CompanyProfile | null;
  admin: BrowserStoredAdmin | null;
}

// Estado de sesión en memoria para el modo previsualización (se pierde al recargar/cerrar)
let browserActiveSession = false;

function getOrUpdateBrowserState(incrementStartup: boolean): BrowserPreviewState {
  const now = new Date().toISOString();
  const raw = localStorage.getItem(BROWSER_STORAGE_KEY);
  const storedTheme =
    (localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null) ??
    "system";

  if (!raw) {
    const initial: BrowserPreviewState = {
      startupCount: 1,
      firstInitializedAt: now,
      lastOpenedAt: now,
      theme: storedTheme,
      themeUpdatedAt: now,
      checks: [
        {
          id: 1,
          note: "Inicialización técnica Fase 0 (modo previsualización navegador)",
          createdAt: now,
        },
      ],
      company: null,
      admin: null,
    };
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  const parsed = JSON.parse(raw) as BrowserPreviewState;
  if (!parsed.theme) {
    parsed.theme = storedTheme;
    parsed.themeUpdatedAt = now;
  }
  if (typeof parsed.company === "undefined") {
    parsed.company = null;
  }
  if (typeof parsed.admin === "undefined") {
    parsed.admin = null;
  }
  if (incrementStartup) {
    parsed.startupCount += 1;
    parsed.lastOpenedAt = now;
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(parsed));
  }
  return parsed;
}

function requireBrowserSession(state: BrowserPreviewState): void {
  if (!browserActiveSession || !state.admin) {
    throw new Error(
      "Acceso no autorizado: debes iniciar sesión con una cuenta válida para realizar esta operación."
    );
  }
}

export async function fetchSystemOverview(
  incrementStartup = false
): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.GET_SYSTEM_OVERVIEW);
  }

  const state = getOrUpdateBrowserState(incrementStartup);
  const hasAdminUser = Boolean(state.admin);
  const isAuthenticated = hasAdminUser && browserActiveSession;

  return {
    appName: "Cartucho ERP",
    appVersion: "0.1.0",
    phase: "Fase 0 — Fundación Local-First",
    architectureMode: "local-first",
    osPlatform: navigator.platform || "linux-x64",
    osArch: "x86_64",
    runtimeMode: "browser-preview",
    preferences: {
      theme: state.theme,
      updatedAt: state.themeUpdatedAt,
    },
    database: {
      connected: true,
      engine: "SQLite",
      sqliteVersion: "3.46.1 (WAL)",
      journalMode: "wal",
      foreignKeysEnabled: true,
      databasePath: "<AppDataDir>/com.cartucho.erp/cartucho_erp.sqlite3",
      appDataDir: "<AppDataDir>/com.cartucho.erp",
      databaseSizeBytes: 32768,
      schemaVersion: 3,
      appliedMigrations: [
        {
          version: 1,
          name: "0001_init_system_metadata_preferences_and_persistence_checks",
          appliedAt: state.firstInitializedAt,
        },
        {
          version: 2,
          name: "0002_create_company_profile_and_installation_entitlements",
          appliedAt: state.firstInitializedAt,
        },
        {
          version: 3,
          name: "0003_create_app_users_and_permissions",
          appliedAt: state.firstInitializedAt,
        },
      ],
      startupCount: state.startupCount,
      firstInitializedAt: state.firstInitializedAt,
      lastOpenedAt: state.lastOpenedAt,
      recentPersistenceChecks: isAuthenticated
        ? state.checks.slice().reverse().slice(0, 10)
        : [],
    },
    company: state.company,
    hasAdminUser,
    isAuthenticated,
    currentUser: isAuthenticated && state.admin ? state.admin.summary : null,
  };
}

export async function completeInitialSetup(
  input: CompleteInitialSetupInput
): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.COMPLETE_INITIAL_SETUP, {
      input,
    });
  }

  const state = getOrUpdateBrowserState(false);
  if (state.admin) {
    throw new Error(
      "Operación denegada: la configuración inicial ya fue completada y ya existe un administrador registrado."
    );
  }

  const tradeName = input.company.tradeName.trim();
  if (!tradeName) {
    throw new Error("El nombre comercial de la empresa es obligatorio.");
  }

  const fullName = input.admin.fullName.trim();
  const username = input.admin.username.trim();
  if (!fullName) {
    throw new Error("El nombre del administrador es obligatorio.");
  }
  if (username.length < 3) {
    throw new Error("El nombre de usuario debe tener al menos 3 caracteres.");
  }
  if (input.admin.password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }
  if (input.admin.password !== input.admin.passwordConfirm) {
    throw new Error("La confirmación de la contraseña no coincide.");
  }

  const now = new Date().toISOString();
  let logoDataUrl: string | null = null;
  let logoMimeType: string | null = null;

  if (input.company.logoBase64 && input.company.logoMimeType) {
    const cleanB64 = input.company.logoBase64.includes(",")
      ? input.company.logoBase64.split(",")[1] ?? input.company.logoBase64
      : input.company.logoBase64;
    logoDataUrl = `data:${input.company.logoMimeType};base64,${cleanB64}`;
    logoMimeType = input.company.logoMimeType;
  }

  state.company = {
    tradeName,
    legalName: input.company.legalName?.trim() || null,
    taxId: input.company.taxId?.trim() || null,
    address: input.company.address?.trim() || null,
    phone: input.company.phone?.trim() || null,
    email: input.company.email?.trim() || null,
    logoDataUrl,
    logoMimeType,
    businessProfileKey: "general",
    commercialPlanKey: "local-standard",
    enabledModuleKeys: [],
    enabledAddonKeys: [],
    createdAt: now,
    updatedAt: now,
  };

  state.admin = {
    summary: {
      id: 1,
      fullName,
      username,
      role: "admin",
      permissions: ["*"],
      createdAt: now,
      lastLoginAt: now,
    },
    passwordVerifier: btoa(encodeURIComponent(input.admin.password)),
  };

  state.lastOpenedAt = now;
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));
  browserActiveSession = true;

  return fetchSystemOverview(false);
}

export async function loginUser(input: LoginInput): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.LOGIN_USER, {
      input,
    });
  }

  const state = getOrUpdateBrowserState(false);
  const cleanUser = input.username.trim().toLowerCase();
  if (
    !state.admin ||
    state.admin.summary.username.toLowerCase() !== cleanUser ||
    state.admin.passwordVerifier !== btoa(encodeURIComponent(input.password))
  ) {
    throw new Error(
      "Credenciales incorrectas. Verifica tu usuario y contraseña."
    );
  }

  const now = new Date().toISOString();
  state.admin.summary.lastLoginAt = now;
  state.lastOpenedAt = now;
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));
  browserActiveSession = true;

  return fetchSystemOverview(false);
}

export async function logoutUser(): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.LOGOUT_USER);
  }

  browserActiveSession = false;
  return fetchSystemOverview(false);
}

export async function changeUserPassword(
  input: ChangePasswordInput
): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.CHANGE_USER_PASSWORD, {
      input,
    });
  }

  const state = getOrUpdateBrowserState(false);
  requireBrowserSession(state);

  if (!input.currentPassword) {
    throw new Error("Debes introducir tu contraseña actual.");
  }
  if (input.newPassword.length < 8) {
    throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
  }
  if (input.newPassword !== input.newPasswordConfirm) {
    throw new Error("La confirmación de la nueva contraseña no coincide.");
  }
  if (input.newPassword === input.currentPassword) {
    throw new Error(
      "La nueva contraseña debe ser diferente de la contraseña actual."
    );
  }
  if (
    !state.admin ||
    state.admin.passwordVerifier !==
      btoa(encodeURIComponent(input.currentPassword))
  ) {
    throw new Error("La contraseña actual introducida es incorrecta.");
  }

  state.admin.passwordVerifier = btoa(encodeURIComponent(input.newPassword));
  state.lastOpenedAt = new Date().toISOString();
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));

  return fetchSystemOverview(false);
}

export async function recordPersistenceCheck(
  note: string
): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(
      TAURI_COMMANDS.RECORD_PERSISTENCE_CHECK,
      {
        note,
      }
    );
  }

  const state = getOrUpdateBrowserState(false);
  requireBrowserSession(state);

  const now = new Date().toISOString();
  const nextId =
    state.checks.length > 0 ? state.checks[state.checks.length - 1].id + 1 : 1;
  state.checks.push({
    id: nextId,
    note: note.trim() || "Verificación manual de persistencia local",
    createdAt: now,
  });
  state.lastOpenedAt = now;
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));

  return fetchSystemOverview(false);
}

export async function saveThemePreference(
  theme: ThemePreference
): Promise<SystemOverview> {
  if (isTauri()) {
    const res = await invoke<SystemOverview>(
      TAURI_COMMANDS.SET_THEME_PREFERENCE,
      {
        theme,
      }
    );
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    return res;
  }

  const state = getOrUpdateBrowserState(false);
  requireBrowserSession(state);

  localStorage.setItem(THEME_STORAGE_KEY, theme);
  const now = new Date().toISOString();
  state.theme = theme;
  state.themeUpdatedAt = now;
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));

  return fetchSystemOverview(false);
}

export async function saveCompanyProfile(
  input: SaveCompanyProfileInput
): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.SAVE_COMPANY_PROFILE, {
      input,
    });
  }

  const state = getOrUpdateBrowserState(false);
  requireBrowserSession(state);

  const tradeName = input.tradeName.trim();
  if (!tradeName) {
    throw new Error("El nombre comercial de la empresa es obligatorio.");
  }

  const now = new Date().toISOString();
  const existing = state.company;

  let logoDataUrl = existing?.logoDataUrl ?? null;
  let logoMimeType = existing?.logoMimeType ?? null;

  if (input.removeLogo) {
    logoDataUrl = null;
    logoMimeType = null;
  } else if (input.logoBase64 && input.logoMimeType) {
    const cleanB64 = input.logoBase64.includes(",")
      ? input.logoBase64.split(",")[1] ?? input.logoBase64
      : input.logoBase64;
    logoDataUrl = `data:${input.logoMimeType};base64,${cleanB64}`;
    logoMimeType = input.logoMimeType;
  }

  state.company = {
    tradeName,
    legalName: input.legalName?.trim() || null,
    taxId: input.taxId?.trim() || null,
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    logoDataUrl,
    logoMimeType,
    businessProfileKey: existing?.businessProfileKey ?? "general",
    commercialPlanKey: existing?.commercialPlanKey ?? "local-standard",
    enabledModuleKeys: existing?.enabledModuleKeys ?? [],
    enabledAddonKeys: existing?.enabledAddonKeys ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  state.lastOpenedAt = now;
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));

  return fetchSystemOverview(false);
}
