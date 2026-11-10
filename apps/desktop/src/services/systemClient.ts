import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  SystemOverview,
  TAURI_COMMANDS,
  ThemePreference,
} from "@cartucho/shared";

const BROWSER_STORAGE_KEY = "cartucho_erp_phase0_preview_state_v1";
const THEME_STORAGE_KEY = "cartucho_erp_theme_preference";

interface BrowserPreviewState {
  startupCount: number;
  firstInitializedAt: string;
  lastOpenedAt: string;
  theme: ThemePreference;
  themeUpdatedAt: string;
  checks: Array<{ id: number; note: string; createdAt: string }>;
}

function getOrUpdateBrowserState(incrementStartup: boolean): BrowserPreviewState {
  const now = new Date().toISOString();
  const raw = localStorage.getItem(BROWSER_STORAGE_KEY);
  const storedTheme = (localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null) ?? "system";

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
    };
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  const parsed = JSON.parse(raw) as BrowserPreviewState;
  if (!parsed.theme) {
    parsed.theme = storedTheme;
    parsed.themeUpdatedAt = now;
  }
  if (incrementStartup) {
    parsed.startupCount += 1;
    parsed.lastOpenedAt = now;
    localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(parsed));
  }
  return parsed;
}

export async function fetchSystemOverview(incrementStartup = false): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.GET_SYSTEM_OVERVIEW);
  }

  const state = getOrUpdateBrowserState(incrementStartup);
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
      databaseSizeBytes: 24576,
      schemaVersion: 1,
      appliedMigrations: [
        {
          version: 1,
          name: "0001_init_system_metadata_preferences_and_persistence_checks",
          appliedAt: state.firstInitializedAt,
        },
      ],
      startupCount: state.startupCount,
      firstInitializedAt: state.firstInitializedAt,
      lastOpenedAt: state.lastOpenedAt,
      recentPersistenceChecks: state.checks.slice().reverse().slice(0, 10),
    },
  };
}

export async function recordPersistenceCheck(note: string): Promise<SystemOverview> {
  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.RECORD_PERSISTENCE_CHECK, {
      note,
    });
  }

  const state = getOrUpdateBrowserState(false);
  const now = new Date().toISOString();
  const nextId = state.checks.length > 0 ? state.checks[state.checks.length - 1].id + 1 : 1;
  state.checks.push({
    id: nextId,
    note: note.trim() || "Verificación manual de persistencia local",
    createdAt: now,
  });
  state.lastOpenedAt = now;
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));

  return fetchSystemOverview(false);
}

export async function saveThemePreference(theme: ThemePreference): Promise<SystemOverview> {
  localStorage.setItem(THEME_STORAGE_KEY, theme);

  if (isTauri()) {
    return await invoke<SystemOverview>(TAURI_COMMANDS.SET_THEME_PREFERENCE, {
      theme,
    });
  }

  const state = getOrUpdateBrowserState(false);
  const now = new Date().toISOString();
  state.theme = theme;
  state.themeUpdatedAt = now;
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));

  return fetchSystemOverview(false);
}
