import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChangePasswordInput,
  CompleteInitialSetupInput,
  LoginInput,
  NavigationSectionId,
  ResolvedTheme,
  SaveCompanyProfileInput,
  SystemOverview,
  ThemePreference,
} from "@cartucho/shared";
import {
  changeUserPassword,
  completeInitialSetup,
  fetchSystemOverview,
  loginUser,
  logoutUser,
  recordPersistenceCheck,
  saveCompanyProfile,
  saveThemePreference,
} from "./services/systemClient";
import {
  findModuleDescriptor,
  resolveManagementNavigationSpaces,
} from "./config/moduleRegistry";
import { Sidebar, Statusbar, Topbar } from "./components/layout";
import { InitialSetupScreen, LoginScreen } from "./components/onboarding";
import {
  ErrorState,
  LoadingState,
  ToastMessage,
  ToastRegion,
} from "./components/ui";
import {
  CompanyView,
  HomeView,
  PlannedModuleView,
  SettingsAboutView,
  SettingsAppearanceView,
  SettingsDatabaseView,
  SettingsUsersView,
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
  const [savingCompany, setSavingCompany] = useState<boolean>(false);
  const [completingSetup, setCompletingSetup] = useState<boolean>(false);
  const [loggingIn, setLoggingIn] = useState<boolean>(false);
  const [changingPassword, setChangingPassword] = useState<boolean>(false);
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

  const resolvedTheme: ResolvedTheme =
    themePreference === "system" ? systemScheme : themePreference;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

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

  const company = overview?.company ?? null;

  // Construcción dinámica de los espacios de Gestión según los módulos habilitados (inicialmente `[]`)
  const managementNavigationSpaces = useMemo(
    () => resolveManagementNavigationSpaces(company?.enabledModuleKeys),
    [company?.enabledModuleKeys]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadOverview(false);
    pushToast("success", "Vista actualizada correctamente.");
  };

  const handleCompleteInitialSetup = async (
    input: CompleteInitialSetupInput
  ) => {
    setCompletingSetup(true);
    try {
      const updated = await completeInitialSetup(input);
      setOverview(updated);
      setActiveSection("home");
      pushToast(
        "success",
        "Configuración inicial completada. Bienvenido a tu espacio de trabajo."
      );
    } catch (err: unknown) {
      pushToast(
        "error",
        err instanceof Error
          ? err.message
          : "Error al guardar la configuración inicial."
      );
      throw err;
    } finally {
      setCompletingSetup(false);
    }
  };

  const handleLogin = async (input: LoginInput) => {
    setLoggingIn(true);
    try {
      const updated = await loginUser(input);
      setOverview(updated);
      setActiveSection("home");
      pushToast("success", "Sesión iniciada correctamente.");
    } catch (err: unknown) {
      throw err;
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      const updated = await logoutUser();
      setOverview(updated);
      setActiveSection("home");
      pushToast("success", "Sesión cerrada correctamente.");
    } catch (err: unknown) {
      pushToast(
        "error",
        err instanceof Error ? err.message : "Error al cerrar sesión."
      );
    }
  };

  const handleChangePassword = async (input: ChangePasswordInput) => {
    setChangingPassword(true);
    try {
      const updated = await changeUserPassword(input);
      setOverview(updated);
      pushToast(
        "success",
        "Contraseña actualizada de forma segura con Argon2id."
      );
    } catch (err: unknown) {
      pushToast(
        "error",
        err instanceof Error
          ? err.message
          : "Error al actualizar la contraseña."
      );
      throw err;
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRecordCheck = async (note: string) => {
    setSavingCheck(true);
    try {
      const updated = await recordPersistenceCheck(note);
      setOverview(updated);
      pushToast("success", "Registro guardado en la base de datos local.");
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
    const prevTheme = themePreference;
    setThemePreferenceState(nextTheme);
    try {
      const updated = await saveThemePreference(nextTheme);
      setOverview(updated);
      pushToast(
        "success",
        `Apariencia (${
          nextTheme === "system"
            ? "Sistema"
            : nextTheme === "dark"
            ? "Oscuro"
            : "Claro"
        }) guardada correctamente.`
      );
    } catch (err: unknown) {
      setThemePreferenceState(prevTheme);
      pushToast(
        "error",
        err instanceof Error
          ? err.message
          : "Error al guardar preferencia de apariencia."
      );
    } finally {
      setSavingTheme(false);
    }
  };

  const handleSaveCompany = async (input: SaveCompanyProfileInput) => {
    setSavingCompany(true);
    try {
      const updated = await saveCompanyProfile(input);
      setOverview(updated);
      pushToast(
        "success",
        "Información de la empresa guardada en SQLite correctamente."
      );
    } catch (err: unknown) {
      pushToast(
        "error",
        err instanceof Error
          ? err.message
          : "Error al guardar los datos de la empresa en SQLite."
      );
      throw err;
    } finally {
      setSavingCompany(false);
    }
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

  // 1. Flujo de primera ejecución: si no existe empresa o no existe administrador, mostrar configuración inicial atómica
  if (!overview.hasAdminUser || !company) {
    return (
      <>
        <InitialSetupScreen
          appVersion={overview.appVersion}
          existingCompany={company}
          saving={completingSetup}
          onCompleteSetup={handleCompleteInitialSetup}
        />
        <ToastRegion toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  // 2. Bloqueo de acceso sin autenticación: si no hay sesión activa, mostrar pantalla de Inicio de Sesión
  if (!overview.isAuthenticated || !overview.currentUser) {
    return (
      <>
        <LoginScreen
          appVersion={overview.appVersion}
          company={company}
          loggingIn={loggingIn}
          onLogin={handleLogin}
        />
        <ToastRegion toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const activeModuleDescriptor = findModuleDescriptor(
    activeSection,
    company.enabledModuleKeys
  );

  return (
    <div className="desktop-layout">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        appVersion={overview.appVersion}
        company={company}
        managementModules={managementNavigationSpaces}
      />

      <Topbar
        activeSection={activeSection}
        companyName={company.tradeName}
        currentUserName={overview.currentUser.fullName}
        onRefresh={handleRefresh}
        onLogout={handleLogout}
        refreshing={refreshing}
      />

      <main className="app-main">
        {activeSection === "home" && (
          <HomeView
            company={company}
            managementModules={managementNavigationSpaces}
            onNavigate={setActiveSection}
          />
        )}

        {activeSection === "company" && (
          <CompanyView
            company={company}
            savingCompany={savingCompany}
            onSaveCompany={handleSaveCompany}
          />
        )}

        {activeModuleDescriptor && (
          <PlannedModuleView
            moduleDescriptor={activeModuleDescriptor}
            onBackHome={() => setActiveSection("home")}
          />
        )}

        {activeSection === "settings-appearance" && (
          <SettingsAppearanceView
            themePreference={themePreference}
            resolvedTheme={resolvedTheme}
            preferencesUpdatedAt={overview.preferences.updatedAt}
            onSelectTheme={handleSelectTheme}
            savingTheme={savingTheme}
          />
        )}

        {activeSection === "settings-users" && (
          <SettingsUsersView
            overview={overview}
            onLogout={handleLogout}
            onChangePassword={handleChangePassword}
            changingPassword={changingPassword}
          />
        )}

        {activeSection === "settings-database" && (
          <SettingsDatabaseView
            overview={overview}
            onRecordCheck={handleRecordCheck}
            savingCheck={savingCheck}
          />
        )}

        {activeSection === "settings-about" && (
          <SettingsAboutView overview={overview} />
        )}
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
