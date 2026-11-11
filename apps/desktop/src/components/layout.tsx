import React, { useState } from "react";
import {
  Blocks,
  Building2,
  ChevronDown,
  ChevronRight,
  Database,
  Home,
  Info,
  Layers,
  LogOut,
  Minus,
  Package,
  Palette,
  ReceiptText,
  RefreshCw,
  Settings,
  ShieldCheck,
  Square,
  Users,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  CompanyProfile,
  ErpModuleDescriptor,
  NavigationSectionId,
  ResolvedTheme,
  SystemOverview,
  ThemePreference,
} from "@cartucho/shared";
import { Button } from "./ui";

/* ==========================================================================
   Iconos por Clave de Módulo Dinámico
   ========================================================================== */

function getModuleIcon(moduleKey: string): React.ReactNode {
  switch (moduleKey) {
    case "inventory":
      return <Package size={15} />;
    case "sales":
      return <ReceiptText size={15} />;
    case "customers":
      return <Users size={15} />;
    default:
      return <Blocks size={15} />;
  }
}

/* ==========================================================================
   Sidebar Reorganizado con Categorías y Submenús Expandibles
   ========================================================================== */

interface SettingsSubItem {
  id: NavigationSectionId;
  label: string;
  icon: React.ReactNode;
}

const SETTINGS_SUBMENU: SettingsSubItem[] = [
  { id: "settings-appearance", label: "Apariencia", icon: <Palette size={14} /> },
  {
    id: "settings-users",
    label: "Usuarios y acceso",
    icon: <ShieldCheck size={14} />,
  },
  { id: "settings-database", label: "Base de datos", icon: <Database size={14} /> },
  { id: "settings-about", label: "Acerca de", icon: <Info size={14} /> },
];

export interface SidebarProps {
  activeSection: NavigationSectionId;
  onSelectSection: (section: NavigationSectionId) => void;
  appVersion: string;
  company: CompanyProfile | null;
  managementModules: ErpModuleDescriptor[];
}

export function Sidebar({
  activeSection,
  onSelectSection,
  appVersion,
  company,
  managementModules,
}: SidebarProps) {
  const isSettingsSection = activeSection.startsWith("settings-");
  const [settingsExpanded, setSettingsExpanded] = useState<boolean>(true);
  const [managementExpanded, setManagementExpanded] = useState<boolean>(true);

  const handleToggleSettings = () => {
    setSettingsExpanded((prev) => !prev);
  };

  const handleToggleManagement = () => {
    setManagementExpanded((prev) => !prev);
  };

  return (
    <aside className="app-sidebar" aria-label="Navegación principal">
      <div className="sidebar-top">
        <div className="brand-header">
          <div className="brand-mark" aria-hidden="true">
            {company?.logoDataUrl ? (
              <img src={company.logoDataUrl} alt={company.tradeName} />
            ) : (
              <Layers size={17} />
            )}
          </div>
          <div className="brand-text">
            <span className="brand-title">
              {company?.tradeName ? company.tradeName : "CARTUCHO"}
            </span>
            <span className="brand-descriptor">
              {company?.tradeName ? "Cartucho ERP" : "ERP · Espacio de Trabajo"}
            </span>
          </div>
        </div>

        <nav className="nav-groups">
          {/* Categoría: GENERAL */}
          <div className="nav-group">
            <div className="nav-group-label">General</div>
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${
                    activeSection === "home" ? "active" : ""
                  }`}
                  onClick={() => onSelectSection("home")}
                  aria-current={activeSection === "home" ? "page" : undefined}
                >
                  <span className="nav-item-main">
                    <Home size={15} />
                    <span>Inicio</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>

          {/* Categoría: EMPRESA */}
          <div className="nav-group">
            <div className="nav-group-label">Empresa</div>
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${
                    activeSection === "company" ? "active" : ""
                  }`}
                  onClick={() => onSelectSection("company")}
                  aria-current={activeSection === "company" ? "page" : undefined}
                >
                  <span className="nav-item-main">
                    <Building2 size={15} />
                    <span>Mi empresa</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>

          {/* Categoría: GESTIÓN (Construida dinámicamente según módulos habilitados) */}
          <div className="nav-group">
            <button
              type="button"
              className="nav-item-btn"
              style={{ padding: "2px 10px" }}
              onClick={handleToggleManagement}
              aria-expanded={managementExpanded}
            >
              <span className="nav-group-label" style={{ padding: 0, margin: 0 }}>
                Gestión
              </span>
              {managementExpanded ? (
                <ChevronDown size={13} color="var(--text-secondary)" />
              ) : (
                <ChevronRight size={13} color="var(--text-secondary)" />
              )}
            </button>

            {managementExpanded && (
              <ul className="nav-list">
                {managementModules.map((mod) => (
                  <li key={mod.id}>
                    <button
                      type="button"
                      className={`nav-item-btn ${
                        activeSection === mod.id ? "active" : ""
                      }`}
                      onClick={() => onSelectSection(mod.id)}
                      aria-current={
                        activeSection === mod.id ? "page" : undefined
                      }
                    >
                      <span className="nav-item-main">
                        {getModuleIcon(mod.key)}
                        <span>{mod.label}</span>
                      </span>
                      {mod.status === "planned" && (
                        <span className="nav-tag-planned">Próximo</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Categoría: APLICACIÓN -> Submenú Configuración */}
          <div className="nav-group">
            <div className="nav-group-label">Aplicación</div>
            <ul className="nav-list">
              <li>
                <button
                  type="button"
                  className={`nav-item-btn ${
                    isSettingsSection ? "active" : ""
                  }`}
                  onClick={handleToggleSettings}
                  aria-expanded={settingsExpanded}
                >
                  <span className="nav-item-main">
                    <Settings size={15} />
                    <span>Configuración</span>
                  </span>
                  {settingsExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>

                {settingsExpanded && (
                  <ul className="nav-sublist">
                    {SETTINGS_SUBMENU.map((sub) => (
                      <li key={sub.id}>
                        <button
                          type="button"
                          className={`nav-subitem-btn ${
                            activeSection === sub.id ? "active" : ""
                          }`}
                          onClick={() => onSelectSection(sub.id)}
                          aria-current={
                            activeSection === sub.id ? "page" : undefined
                          }
                        >
                          {sub.icon}
                          <span>{sub.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            </ul>
          </div>
        </nav>
      </div>

      <div className="sidebar-footer">
        <span>Cartucho ERP</span>
        <span className="mono">v{appVersion}</span>
      </div>
    </aside>
  );
}

/* ==========================================================================
   Topbar Sencilla y Profesional + Controles Discretos de Ventana
   ========================================================================== */

const SECTION_META: Record<
  NavigationSectionId,
  { category: string; title: string; subtitle: string }
> = {
  home: {
    category: "General",
    title: "Inicio",
    subtitle: "Espacio principal de trabajo",
  },
  company: {
    category: "Empresa",
    title: "Mi empresa",
    subtitle: "Información e identidad de la empresa registrada",
  },
  "module-inventory": {
    category: "Gestión",
    title: "Inventario",
    subtitle: "Espacio preparado para gestión de productos y existencias",
  },
  "module-sales": {
    category: "Gestión",
    title: "Ventas",
    subtitle: "Espacio preparado para documentos de venta internos y pagos manuales",
  },
  "module-customers": {
    category: "Gestión",
    title: "Clientes",
    subtitle: "Espacio preparado para directorio de clientes",
  },
  "module-future": {
    category: "Gestión",
    title: "Módulos personalizables",
    subtitle: "Arquitectura preparada para distintos tipos de negocio",
  },
  "settings-appearance": {
    category: "Configuración",
    title: "Apariencia",
    subtitle: "Preferencia de tema visual de la aplicación",
  },
  "settings-users": {
    category: "Configuración",
    title: "Usuarios y acceso",
    subtitle: "Administrador de la instalación y seguridad de acceso",
  },
  "settings-database": {
    category: "Configuración",
    title: "Base de datos",
    subtitle: "Estado de almacenamiento local y persistencia",
  },
  "settings-about": {
    category: "Configuración",
    title: "Acerca de",
    subtitle: "Información del producto y versión instalada",
  },
};

export interface TopbarProps {
  activeSection: NavigationSectionId;
  companyName: string | null;
  currentUserName: string | null;
  onRefresh: () => void;
  onLogout: () => void;
  refreshing: boolean;
}

export function Topbar({
  activeSection,
  companyName,
  currentUserName,
  onRefresh,
  onLogout,
  refreshing,
}: TopbarProps) {
  const meta = SECTION_META[activeSection];
  const inTauri = isTauri();

  const handleMinimize = async () => {
    if (!inTauri) return;
    await getCurrentWindow().minimize();
  };

  const handleToggleMaximize = async () => {
    if (!inTauri) return;
    await getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    if (!inTauri) return;
    await getCurrentWindow().close();
  };

  return (
    <header className="app-topbar" data-tauri-drag-region>
      <div className="topbar-left" data-tauri-drag-region>
        <span className="topbar-breadcrumb">{meta.category} /</span>
        <h1 className="topbar-section-title">{meta.title}</h1>
        <span className="topbar-subtitle">{meta.subtitle}</span>
      </div>

      <div className="topbar-right">
        {companyName && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-secondary)",
              padding: "4px 10px",
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--bg-subtle)",
              border: "1px solid var(--border-default)",
            }}
          >
            {companyName}
          </span>
        )}

        {currentUserName && (
          <span
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            {currentUserName}
          </span>
        )}

        <Button
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
          title="Actualizar vista"
          aria-label="Actualizar vista"
          icon={<RefreshCw size={14} />}
        />

        <Button
          variant="ghost"
          onClick={onLogout}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          icon={<LogOut size={14} />}
        >
          Salir
        </Button>

        {inTauri && (
          <div
            className="window-controls"
            aria-label="Controles de ventana"
          >
            <button
              type="button"
              className="win-ctrl-btn"
              onClick={handleMinimize}
              title="Minimizar"
              aria-label="Minimizar ventana"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="win-ctrl-btn"
              onClick={handleToggleMaximize}
              title="Maximizar o restaurar"
              aria-label="Maximizar o restaurar ventana"
            >
              <Square size={12} />
            </button>
            <button
              type="button"
              className="win-ctrl-btn"
              onClick={handleClose}
              title="Cerrar"
              aria-label="Cerrar ventana"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/* ==========================================================================
   Statusbar Discreta
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
            {database.connected
              ? "Almacenamiento local activo"
              : "Almacenamiento desconectado"}
          </span>
        </span>
      </div>

      <div className="statusbar-group">
        <span className="statusbar-item">Apariencia: {themeLabel}</span>
        <span className="statusbar-item mono">v{overview.appVersion}</span>
      </div>
    </footer>
  );
}
