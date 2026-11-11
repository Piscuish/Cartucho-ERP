/**
 * Orquestador principal: arranque, configuración inicial, inicio de sesión, tema y navegación.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CompleteInitialSetupInput, ResolvedTheme, SystemOverview, ThemePreference } from "@cartucho/shared";
import { api, onLicenseChanged } from "./services/systemClient";
import { AccessProvider, buildAccess } from "./lib/access";
import { ActivationScreen } from "./components/license";
import { useWindowTitle, WindowFrame } from "./components/titleBar";
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
    <WindowFrame>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </WindowFrame>
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
  useWindowTitle(overview?.company?.tradeName || "Cartucho ERP", overview?.company?.logoDataUrl ?? null);

  const visualStyle = overview?.preferences.visualStyle ?? "violeta";

  // Tema y estilo se aplican en <html>; el cambio se anima brevemente.
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === theme && root.dataset.style === visualStyle) return;
    const animate = !!root.dataset.theme;
    if (animate) root.classList.add("is-restyling");
    root.dataset.theme = theme;
    root.dataset.style = visualStyle;
    if (!animate) return;
    const t = window.setTimeout(() => root.classList.remove("is-restyling"), 320);
    return () => window.clearTimeout(t);
  }, [theme, visualStyle]);

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
  const license = overview?.license ?? null;
  const access = buildAccess(license);

  // La verificación periódica (cada hora) puede cambiar módulos o desactivar la licencia.
  useEffect(() => onLicenseChanged(() => void load()), [load]);

  // Si la ruta actual dejó de estar permitida, vuelve al inicio.
  useEffect(() => {
    if (!access.canOpen(route)) setRoute({ page: "dashboard" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license]);

  // Contador de stock bajo para el menú lateral; se refresca al navegar.
  useEffect(() => {
    if (!authenticated || !access.can("inventory")) return;
    api
      .listProducts({ onlyLowStock: true })
      .then((p) => setLowStockCount(p.length))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, route, license]);

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

  if (license?.mode === "unlicensed") {
    return <ActivationScreen license={license} onActivated={load} />;
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
    <AccessProvider license={license}>
    <AppShell
      company={overview.company}
      user={overview.currentUser}
      route={route}
      navigate={navigate}
      resolvedTheme={theme}
      onToggleTheme={toggleTheme}
      lowStockCount={access.can("inventory") ? lowStockCount : 0}
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
    </AccessProvider>
  );
}
