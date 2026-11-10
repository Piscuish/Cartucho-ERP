import React from "react";
import {
  Database,
  HardDrive,
  Home,
  Info,
  Layers,
  Moon,
  RefreshCw,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type {
  NavigationSectionId,
  ResolvedTheme,
  SystemOverview,
  ThemePreference,
} from "@cartucho/shared";
import { Badge, Button } from "./ui";

/* ==========================================================================
   Sidebar
   ========================================================================== */

interface NavItem {
  id: NavigationSectionId;
  label: string;
  icon: React.ReactNode;
}

const GENERAL_NAV: NavItem[] = [
  { id: "home", label: "Inicio", icon: <Home size={16} /> },
];

const APP_NAV: NavItem[] = [
  { id: "storage", label: "Almacenamiento", icon: <HardDrive size={16} /> },
  { id: "preferences", label: "Preferencias", icon: <SlidersHorizontal size={16} /> },
  { id: "about", label: "Acerca de", icon: <Info size={16} /> },
];

export interface SidebarProps {
  activeSection: NavigationSectionId;
  onSelectSection: (section: NavigationSectionId) => void;
  appVersion: string;
}

export function Sidebar({
  activeSection,
  onSelectSection,
  appVersion,
}: SidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Navegación principal">
      <div>
        <div className="brand-header">
          <div className="brand-mark" aria-hidden="true">
            <Layers size={18} />
          </div>
          <div className="brand-text">
            <span className="brand-title">CARTUCHO</span>
            <span className="brand-descriptor">ERP · LOCAL-FIRST</span>
          </div>
        </div>

        <nav className="nav-groups">
          <div>
            <div className="nav-group-label">General</div>
            <ul className="nav-list">
              {GENERAL_NAV.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nav-item-btn ${
                      activeSection === item.id ? "active" : ""
                    }`}
                    onClick={() => onSelectSection(item.id)}
                    aria-current={activeSection === item.id ? "page" : undefined}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="nav-group-label">Aplicación</div>
            <ul className="nav-list">
              {APP_NAV.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nav-item-btn ${
                      activeSection === item.id ? "active" : ""
                    }`}
                    onClick={() => onSelectSection(item.id)}
                    aria-current={activeSection === item.id ? "page" : undefined}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>

      <div className="sidebar-footer">
        <span>Versión v{appVersion}</span>
        <span>Fase 0</span>
      </div>
    </aside>
  );
}

/* ==========================================================================
   Topbar
   ========================================================================== */

const SECTION_TITLES: Record<NavigationSectionId, { title: string; subtitle: string }> = {
  home: {
    title: "Inicio",
    subtitle: "Resumen operativo y estado de la instalación local",
  },
  storage: {
    title: "Almacenamiento",
    subtitle: "Motor SQLite local, migraciones y comprobación de persistencia",
  },
  preferences: {
    title: "Preferencias",
    subtitle: "Apariencia visual y configuración de la aplicación",
  },
  about: {
    title: "Acerca de",
    subtitle: "Información de versión, arquitectura y hoja de ruta",
  },
};

export interface TopbarProps {
  activeSection: NavigationSectionId;
  overview: SystemOverview;
  resolvedTheme: ResolvedTheme;
  onQuickToggleTheme: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function Topbar({
  activeSection,
  overview,
  resolvedTheme,
  onQuickToggleTheme,
  onRefresh,
  refreshing,
}: TopbarProps) {
  const meta = SECTION_TITLES[activeSection];

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        <h1 className="topbar-section-title">{meta.title}</h1>
        <span className="topbar-subtitle">{meta.subtitle}</span>
      </div>

      <div className="topbar-right">
        <Badge variant={overview.database.connected ? "success" : "error"}>
          <Database size={12} />
          <span>
            {overview.database.connected
              ? `SQLite ${overview.database.sqliteVersion}`
              : "SQLite Desconectado"}
          </span>
        </Badge>

        <Button
          variant="secondary"
          onClick={onQuickToggleTheme}
          title="Alternar tema Claro / Oscuro"
          aria-label="Alternar tema"
          icon={resolvedTheme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        >
          {resolvedTheme === "dark" ? "Oscuro" : "Claro"}
        </Button>

        <Button
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
          title="Actualizar estado del sistema"
          aria-label="Actualizar estado del sistema"
          icon={<RefreshCw size={14} />}
        />
      </div>
    </header>
  );
}

/* ==========================================================================
   Statusbar
   ========================================================================== */

export interface StatusbarProps {
  overview: SystemOverview;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
}

export function Statusbar({
  overview,
  themePreference,
  resolvedTheme,
}: StatusbarProps) {
  const { database } = overview;

  const themeLabel =
    themePreference === "system"
      ? `Sistema (${resolvedTheme === "dark" ? "Oscuro" : "Claro"})`
      : themePreference === "dark"
      ? "Oscuro"
      : "Claro";

  return (
    <footer className="app-statusbar" aria-label="Barra de estado de la aplicación">
      <div className="statusbar-group">
        <span className="statusbar-item">
          <span
            className={`status-dot ${database.connected ? "online" : "offline"}`}
          />
          <span>
            {database.connected ? "Almacenamiento Local Activo" : "Sin conexión SQLite"}
          </span>
        </span>
        <span className="statusbar-item mono">
          Esquema v{database.schemaVersion} · Modo {database.journalMode.toUpperCase()}
        </span>
      </div>

      <div className="statusbar-group">
        <span className="statusbar-item">Tema: {themeLabel}</span>
        <span className="statusbar-item mono">
          {overview.osPlatform}/{overview.osArch}
        </span>
      </div>
    </footer>
  );
}
