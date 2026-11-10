import { useCallback, useEffect, useState } from "react";
import type {
  NavigationSectionId,
  ResolvedTheme,
  SystemOverview,
  ThemePreference,
} from "@cartucho/shared";
import {
  fetchSystemOverview,
  recordPersistenceCheck,
  saveThemePreference,
} from "./services/systemClient";
import { Sidebar, Statusbar, Topbar } from "./components/layout";
import {
  ErrorState,
  LoadingState,
  ToastMessage,
  ToastRegion,
} from "./components/ui";
import {
  AboutView,
  HomeView,
  PreferencesView,
  StorageView,
} from "./components/views";
import "./styles/theme.css";

function getSystemColorScheme(): ResolvedTheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function App() {
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] =
    useState<NavigationSectionId>("home");
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>("system");
  const [systemScheme, setSystemScheme] = useState<ResolvedTheme>(
    getSystemColorScheme
  );
  const [savingCheck, setSavingCheck] = useState<boolean>(false);
  const [savingTheme, setSavingTheme] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((type: "success" | "error", text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 3500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Escuchar cambios de tema del sistema operativo en tiempo real
  useEffect(() => {
    if (!window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemScheme(e.matches ? "dark" : "light");
    };
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Resolver el tema efectivo ("light" | "dark") y aplicarlo al atributo data-theme del documento
  const resolvedTheme: ResolvedTheme =
    themePreference === "system" ? systemScheme : themePreference;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  // Carga inicial del estado real desde Tauri / SQLite
  const loadOverview = useCallback(async (incrementStartup: boolean) => {
    try {
      setError(null);
      const data = await fetchSystemOverview(incrementStartup);
      setOverview(data);
      if (data.preferences?.theme) {
        setThemePreferenceState(data.preferences.theme);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadOverview(true);
  }, [loadOverview]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadOverview(false);
    pushToast("success", "Estado del sistema actualizado desde SQLite.");
  };

  const handleRecordCheck = async (note: string) => {
    setSavingCheck(true);
    try {
      const updated = await recordPersistenceCheck(note);
      setOverview(updated);
      pushToast(
        "success",
        "Registro guardado correctamente en la base de datos SQLite local."
      );
    } catch (err: unknown) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Error al escribir en SQLite."
      );
    } finally {
      setSavingCheck(false);
    }
  };

  const handleSelectTheme = async (nextTheme: ThemePreference) => {
    setSavingTheme(true);
    setThemePreferenceState(nextTheme);
    try {
      const updated = await saveThemePreference(nextTheme);
      setOverview(updated);
      pushToast(
        "success",
        `Preferencia de tema (${
          nextTheme === "system"
            ? "Sistema"
            : nextTheme === "dark"
            ? "Oscuro"
            : "Claro"
        }) guardada en SQLite.`
      );
    } catch (err: unknown) {
      pushToast(
        "error",
        err instanceof Error
          ? err.message
          : "Error al guardar preferencia de tema."
      );
    } finally {
      setSavingTheme(false);
    }
  };

  const handleQuickToggleTheme = async () => {
    const nextTheme: ThemePreference =
      resolvedTheme === "dark" ? "light" : "dark";
    await handleSelectTheme(nextTheme);
  };

  if (loading) {
    return <LoadingState />;
  }

  if (error || !overview) {
    return (
      <ErrorState
        message={
          error ?? "No fue posible obtener el estado del sistema desde SQLite."
        }
        onRetry={() => {
          setLoading(true);
          loadOverview(false);
        }}
      />
    );
  }

  return (
    <div className="desktop-layout">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        appVersion={overview.appVersion}
      />

      <Topbar
        activeSection={activeSection}
        overview={overview}
        resolvedTheme={resolvedTheme}
        onQuickToggleTheme={handleQuickToggleTheme}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      <main className="app-main">
        {activeSection === "home" && (
          <HomeView overview={overview} onNavigate={setActiveSection} />
        )}

        {activeSection === "storage" && (
          <StorageView
            overview={overview}
            onRecordCheck={handleRecordCheck}
            savingCheck={savingCheck}
          />
        )}

        {activeSection === "preferences" && (
          <PreferencesView
            themePreference={themePreference}
            resolvedTheme={resolvedTheme}
            preferencesUpdatedAt={overview.preferences.updatedAt}
            onSelectTheme={handleSelectTheme}
            savingTheme={savingTheme}
          />
        )}

        {activeSection === "about" && <AboutView overview={overview} />}
      </main>

      <Statusbar
        overview={overview}
        themePreference={themePreference}
        resolvedTheme={resolvedTheme}
      />

      <ToastRegion toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default App;
