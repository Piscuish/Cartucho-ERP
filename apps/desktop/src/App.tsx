/**
 * Orquestador principal: arranque, configuración inicial, inicio de sesión, tema y navegación.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CompleteInitialSetupInput, ResolvedTheme, SystemOverview, ThemePreference } from "@cartucho/shared";
import { api } from "./services/systemClient";
import { errorMessage } from "./lib/format";
import { AppShell } from "./components/layout";
import { LoginScreen, SetupWizard, StartupErrorScreen } from "./components/onboarding";
import { ToastProvider, useToast } from "./components/ui";
import { Route } from "./config/moduleRegistry";
import { PageRouter } from "./components/views";

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useResolvedTheme(pref: ThemePreference | undefined): ResolvedTheme {
  const [sys, setSys] = useState<ResolvedTheme>(systemTheme);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const h = () => setSys(mq.matches ? "dark" : "light");
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return !pref || pref === "system" ? sys : pref;
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const toast = useToast();
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ page: "dashboard" });
  const [, setHistory] = useState<Route[]>([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const theme = useResolvedTheme(overview?.preferences.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const load = useCallback(async () => {
    try {
      setOverview(await api.overview());
      setStartupError(null);
    } catch (e) {
      const raw = typeof e === "string" ? e : errorMessage(e);
      setStartupError(raw.replace(/^STARTUP_ERROR:\s*/, ""));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const authenticated = !!overview?.isAuthenticated;

  // Contador de stock bajo para el menú lateral; se refresca al navegar.
  useEffect(() => {
    if (!authenticated) return;
    api
      .listProducts({ onlyLowStock: true })
      .then((p) => setLowStockCount(p.length))
      .catch(() => undefined);
  }, [authenticated, route]);

  const navigate = useCallback(
    (r: Route) => {
      setHistory((h) => [...h.slice(-30), route]);
      setRoute(r);
    },
    [route],
  );

  const goBack = useCallback(() => {
    setHistory((h) => {
      const prev = h[h.length - 1];
      setRoute(prev ?? { page: "dashboard" });
      return h.slice(0, -1);
    });
  }, []);

  const toggleTheme = async () => {
    const next: ThemePreference = theme === "dark" ? "light" : "dark";
    try {
      setOverview(await api.setTheme(next));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  if (startupError) {
    return (
      <StartupErrorScreen
        message={startupError}
        onRetry={async () => {
          setOverview(await api.retryOpenDatabase());
          setStartupError(null);
        }}
        onReset={async () => {
          setOverview(await api.resetDataLocation());
          setStartupError(null);
        }}
      />
    );
  }

  if (!overview) {
    return (
      <div className="center-screen">
        <Loader2 className="spin" size={28} color="var(--accent)" />
      </div>
    );
  }

  if (!overview.hasAdminUser || !overview.company) {
    return (
      <SetupWizard
        existingCompany={overview.company}
        onComplete={async (input: CompleteInitialSetupInput) => {
          setOverview(await api.completeSetup(input));
          setRoute({ page: "dashboard" });
          toast("Tu empresa quedó configurada. ¡Bienvenido!");
        }}
      />
    );
  }

  if (!overview.isAuthenticated || !overview.currentUser) {
    return (
      <LoginScreen
        company={overview.company}
        onLogin={async (username, password) => {
          setOverview(await api.login({ username, password }));
          setRoute({ page: "dashboard" });
          setHistory([]);
        }}
      />
    );
  }

  return (
    <AppShell
      company={overview.company}
      user={overview.currentUser}
      route={route}
      navigate={navigate}
      resolvedTheme={theme}
      onToggleTheme={toggleTheme}
      lowStockCount={lowStockCount}
      onLogout={async () => {
        setOverview(await api.logout());
        setHistory([]);
      }}
    >
      <PageRouter
        key={JSON.stringify(route)}
        route={route}
        navigate={navigate}
        goBack={goBack}
        overview={overview}
        setOverview={setOverview}
        reloadOverview={load}
      />
    </AppShell>
  );
}
