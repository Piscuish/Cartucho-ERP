import React, { useState } from "react";
import {
  Blocks,
  Building2,
  CheckCircle2,
  Database,
  FolderOpen,
  Info,
  KeyRound,
  Layers,
  Monitor,
  Moon,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Users,
} from "lucide-react";
import type {
  ChangePasswordInput,
  CompanyProfile,
  ErpModuleDescriptor,
  MigrationRecord,
  NavigationSectionId,
  PersistenceCheckRecord,
  ResolvedTheme,
  SaveCompanyProfileInput,
  SystemOverview,
  ThemePreference,
} from "@cartucho/shared";
import { CompanyProfileForm } from "./onboarding";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Input,
  Select,
} from "./ui";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function getModuleCardIcon(moduleKey: string): React.ReactNode {
  switch (moduleKey) {
    case "inventory":
      return <Package size={16} />;
    case "sales":
      return <ReceiptText size={16} />;
    case "customers":
      return <Users size={16} />;
    default:
      return <Blocks size={16} />;
  }
}

/* ==========================================================================
   1. Pantalla Rediseñada: Inicio (Espacio Principal de Trabajo de la Empresa)
   ========================================================================== */

export function HomeView({
  company,
  managementModules,
  onNavigate,
}: {
  company: CompanyProfile | null;
  managementModules: ErpModuleDescriptor[];
  onNavigate: (section: NavigationSectionId) => void;
}) {
  const displayCompanyName =
    company?.tradeName || "Empresa pendiente de configuración";

  return (
    <div className="page-container">
      {/* Cabecera de bienvenida empresarial con logotipo y nombre real de la empresa */}
      <section className="workspace-hero" aria-label="Bienvenida empresarial">
        <div className="workspace-hero-main">
          <div className="company-logo-box" aria-hidden="true">
            {company?.logoDataUrl ? (
              <img src={company.logoDataUrl} alt={displayCompanyName} />
            ) : (
              <Building2 size={26} />
            )}
          </div>
          <div className="workspace-hero-text">
            <h2 className="workspace-company-name">{displayCompanyName}</h2>
            <p className="workspace-welcome-line">
              Bienvenido a tu espacio de trabajo.
            </p>
            <p className="workspace-summary-line">
              Cartucho ERP te ayuda a organizar, administrar y gestionar las
              diferentes áreas de tu empresa desde un solo lugar.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Button
            variant="secondary"
            icon={<Building2 size={14} />}
            onClick={() => onNavigate("company")}
          >
            Mi empresa
          </Button>
          <Button
            variant="ghost"
            icon={<Settings size={14} />}
            onClick={() => onNavigate("settings-appearance")}
          >
            Configuración
          </Button>
        </div>
      </section>

      {/* Áreas de Gestión de la Empresa (preparadas dinámicamente sin métricas ficticias) */}
      <Card
        title="Áreas de Gestión Empresarial"
        subtitle="Espacios modulares de trabajo adaptables a las necesidades de tu negocio"
        icon={<Blocks size={16} />}
      >
        <div className="grid-2">
          {managementModules.map((mod) => (
            <div
              key={mod.id}
              className="meta-item"
              style={{
                padding: "14px 16px",
                gap: 8,
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontWeight: 600,
                    fontSize: 13.5,
                    color: "var(--text-primary)",
                  }}
                >
                  {getModuleCardIcon(mod.key)}
                  <span>{mod.label}</span>
                </span>
                <Badge variant="neutral">
                  {mod.status === "active" ? "Activo" : "Próximo módulo"}
                </Badge>
              </div>

              <p style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {mod.description}
              </p>

              <div style={{ marginTop: 4 }}>
                <Button
                  variant="secondary"
                  onClick={() => onNavigate(mod.id)}
                >
                  Abrir espacio
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Resumen limpio de la ficha empresarial activa */}
      <div className="grid-2">
        <Card
          title="Información de la Empresa"
          subtitle="Datos generales registrados en esta instalación"
          icon={<Building2 size={16} />}
          action={
            <Button
              variant="ghost"
              onClick={() => onNavigate("company")}
            >
              Ver ficha
            </Button>
          }
        >
          {company ? (
            <div className="meta-list">
              <div className="meta-item">
                <span className="meta-label">Nombre Comercial</span>
                <span className="meta-value">{company.tradeName}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Identificación / NIT</span>
                <span className="meta-value">
                  {company.taxId || "No especificado"}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Teléfono</span>
                <span className="meta-value">
                  {company.phone || "No especificado"}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Correo Electrónico</span>
                <span className="meta-value">
                  {company.email || "No especificado"}
                </span>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Sin datos de empresa registrados todavía"
              description="La información comercial y el logotipo de tu empresa se mostrarán aquí una vez completada la configuración inicial."
              action={
                <Button
                  variant="primary"
                  onClick={() => onNavigate("company")}
                >
                  Ir a Mi empresa
                </Button>
              }
            />
          )}
        </Card>

        <Card
          title="Acceso Rápido de Administración"
          subtitle="Ajustes generales del espacio de trabajo"
          icon={<Settings size={16} />}
        >
          <div className="meta-list">
            <div className="meta-item span-full">
              <span className="meta-label">Apariencia Visual</span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  marginBottom: 6,
                }}
              >
                Personaliza el tema claro, oscuro o automático del sistema.
              </span>
              <div>
                <Button
                  variant="secondary"
                  onClick={() => onNavigate("settings-appearance")}
                >
                  Configurar apariencia
                </Button>
              </div>
            </div>

            <div className="meta-item span-full">
              <span className="meta-label">Usuarios y Base de Datos</span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  marginBottom: 6,
                }}
              >
                Consulta el acceso del administrador y el estado del almacenamiento local.
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="secondary"
                  onClick={() => onNavigate("settings-users")}
                >
                  Usuarios y acceso
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => onNavigate("settings-database")}
                >
                  Base de datos
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ==========================================================================
   2. Pantalla: Mi Empresa (Company Section)
   ========================================================================== */

export function CompanyView({
  company,
  savingCompany,
  onSaveCompany,
}: {
  company: CompanyProfile | null;
  savingCompany: boolean;
  onSaveCompany: (input: SaveCompanyProfileInput) => Promise<void>;
}) {
  const [editing, setEditing] = useState<boolean>(!company);

  const handleSave = async (input: SaveCompanyProfileInput) => {
    await onSaveCompany(input);
    setEditing(false);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Mi empresa</h2>
          <p className="page-description">
            Ficha de identidad comercial, logotipo y datos de contacto asociados a esta instalación de Cartucho ERP.
          </p>
        </div>
        {company && !editing && (
          <Button
            variant="secondary"
            icon={<Pencil size={14} />}
            onClick={() => setEditing(true)}
          >
            Editar información
          </Button>
        )}
      </div>

      {editing || !company ? (
        <Card
          title={
            company
              ? "Editar Información de la Empresa"
              : "Registrar Información de la Empresa"
          }
          subtitle="Los cambios se almacenan localmente en SQLite (incluyendo el logotipo en formato binario)"
          icon={<Building2 size={16} />}
        >
          <CompanyProfileForm
            initialCompany={company}
            submitLabel={
              company ? "Guardar cambios" : "Registrar datos de la empresa"
            }
            saving={savingCompany}
            onCancel={company ? () => setEditing(false) : undefined}
            onSubmit={handleSave}
          />
        </Card>
      ) : (
        <>
          <Card
            title="Identidad y Datos de Contacto"
            subtitle="Información activa utilizada en la cabecera de la aplicación y documentos internos"
            icon={<Building2 size={16} />}
            action={
              <Badge variant="success">
                Actualizado: {formatDate(company.updatedAt)}
              </Badge>
            }
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                paddingBottom: 12,
                borderBottom: "1px solid var(--border-default)",
              }}
            >
              <div className="company-logo-box" aria-hidden="true">
                {company.logoDataUrl ? (
                  <img src={company.logoDataUrl} alt={company.tradeName} />
                ) : (
                  <Building2 size={26} />
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                  }}
                >
                  {company.tradeName}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {company.logoMimeType
                    ? `Logotipo almacenado en SQLite (${company.logoMimeType})`
                    : "Sin logotipo personalizado (usando icono empresarial por defecto)"}
                </span>
              </div>
            </div>

            <div className="meta-list">
              <div className="meta-item">
                <span className="meta-label">Nombre Comercial</span>
                <span className="meta-value">{company.tradeName}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Razón Social</span>
                <span className="meta-value">
                  {company.legalName || "No especificada"}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">
                  Identificación Tributaria / NIT
                </span>
                <span className="meta-value">
                  {company.taxId || "No especificada"}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Teléfono</span>
                <span className="meta-value">
                  {company.phone || "No especificado"}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Correo Electrónico</span>
                <span className="meta-value">
                  {company.email || "No especificado"}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Dirección Física</span>
                <span className="meta-value">
                  {company.address || "No especificada"}
                </span>
              </div>
            </div>
          </Card>

          <Card
            title="Configuración de Instalación y Alcance Modular"
            subtitle="Parámetros desacoplados para perfil de negocio, edición comercial, módulos y complementos"
            icon={<Blocks size={16} />}
          >
            <div className="meta-list">
              <div className="meta-item">
                <span className="meta-label">Perfil o Giro de Negocio</span>
                <span className="meta-value mono">
                  {company.businessProfileKey}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Plan o Edición Comercial</span>
                <span className="meta-value mono">
                  {company.commercialPlanKey}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Módulos Habilitados</span>
                <span className="meta-value">
                  {company.enabledModuleKeys.length > 0
                    ? company.enabledModuleKeys.join(", ")
                    : "Ninguno habilitado todavía ([])"}
                </span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Complementos Adicionales</span>
                <span className="meta-value">
                  {company.enabledAddonKeys.length > 0
                    ? company.enabledAddonKeys.join(", ")
                    : "Ninguno activo ([])"}
                </span>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   3. Pantalla: Espacio de Módulo de Gestión Futuro (Inventario, Ventas, Clientes...)
   ========================================================================== */

export function PlannedModuleView({
  moduleDescriptor,
  onBackHome,
}: {
  moduleDescriptor: ErpModuleDescriptor;
  onBackHome: () => void;
}) {
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">{moduleDescriptor.label}</h2>
          <p className="page-description">{moduleDescriptor.description}</p>
        </div>
        <Badge variant="neutral">Módulo en planificación</Badge>
      </div>

      <Card
        title={`Espacio preparado para ${moduleDescriptor.label}`}
        subtitle="Arquitectura modular desacoplada lista para futuras versiones"
        icon={getModuleCardIcon(moduleDescriptor.key)}
      >
        <EmptyState
          icon={getModuleCardIcon(moduleDescriptor.key)}
          title={`El módulo de ${moduleDescriptor.label} aún no está habilitado`}
          description="Este apartado forma parte de la estructura de navegación de Gestión. Se activará en su fase correspondiente manteniendo compatibilidad con configuraciones personalizadas según el tipo de negocio."
          action={
            <Button variant="secondary" onClick={onBackHome}>
              Volver a Inicio
            </Button>
          }
        />
      </Card>
    </div>
  );
}

/* ==========================================================================
   4. Configuración > Apariencia
   ========================================================================== */

export function SettingsAppearanceView({
  themePreference,
  resolvedTheme,
  preferencesUpdatedAt,
  onSelectTheme,
  savingTheme,
}: {
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  preferencesUpdatedAt: string;
  onSelectTheme: (theme: ThemePreference) => Promise<void>;
  savingTheme: boolean;
}) {
  const options: Array<{
    value: ThemePreference;
    title: string;
    description: string;
    icon: React.ReactNode;
  }> = [
    {
      value: "light",
      title: "Claro",
      description: "Superficies claras de alto contraste para entornos iluminados.",
      icon: <Sun size={18} />,
    },
    {
      value: "dark",
      title: "Oscuro",
      description: "Tonos oscuros neutros para reducir la fatiga visual.",
      icon: <Moon size={18} />,
    },
    {
      value: "system",
      title: "Sistema operativo",
      description: "Sincroniza automáticamente el tema con la configuración de tu equipo.",
      icon: <Monitor size={18} />,
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Apariencia</h2>
          <p className="page-description">
            Selecciona el tema visual de Cartucho ERP. Tu elección se guarda en la base de datos local y se conserva al reiniciar la aplicación.
          </p>
        </div>
      </div>

      <Card
        title="Tema de la Interfaz"
        subtitle="Identidad visual Business Minimalist"
        icon={<SlidersHorizontal size={16} />}
        action={
          <Badge variant="neutral">
            Vista actual: {resolvedTheme === "dark" ? "Oscuro" : "Claro"}
          </Badge>
        }
      >
        <div
          className="theme-options-grid"
          role="radiogroup"
          aria-label="Preferencia de tema"
        >
          {options.map((opt) => {
            const selected = themePreference === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={savingTheme}
                className={`theme-option-card ${selected ? "selected" : ""}`}
                onClick={() => onSelectTheme(opt.value)}
              >
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  {opt.icon}
                  {selected && (
                    <CheckCircle2 size={16} color="var(--text-primary)" />
                  )}
                </div>
                <span className="theme-option-title">{opt.title}</span>
                <span className="theme-option-desc">{opt.description}</span>
              </button>
            );
          })}
        </div>

        <div className="inline-form-row" style={{ marginTop: 8 }}>
          <Select
            id="theme-select-control"
            label="Preferencia activa"
            helperText={`Última actualización guardada: ${formatDate(
              preferencesUpdatedAt
            )}`}
            value={themePreference}
            disabled={savingTheme}
            onChange={(e) => onSelectTheme(e.target.value as ThemePreference)}
            options={[
              { value: "light", label: "Tema Claro" },
              { value: "dark", label: "Tema Oscuro" },
              { value: "system", label: "Seguir el tema del Sistema Operativo" },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}

/* ==========================================================================
   5. Configuración > Usuarios y acceso
   ========================================================================== */

export function SettingsUsersView({
  overview,
  onLogout,
  onChangePassword,
  changingPassword,
}: {
  overview: SystemOverview;
  onLogout: () => void;
  onChangePassword: (input: ChangePasswordInput) => Promise<void>;
  changingPassword: boolean;
}) {
  const admin = overview.currentUser;
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState<string>("");
  const [pwError, setPwError] = useState<string | null>(null);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);

    if (!currentPassword) {
      setPwError("Debes introducir tu contraseña actual.");
      return;
    }
    if (newPassword.length < 8) {
      setPwError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setPwError("La confirmación de la nueva contraseña no coincide.");
      return;
    }
    if (newPassword === currentPassword) {
      setPwError(
        "La nueva contraseña debe ser diferente de la contraseña actual."
      );
      return;
    }

    try {
      await onChangePassword({
        currentPassword,
        newPassword,
        newPasswordConfirm,
      });
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
    } catch (err: unknown) {
      setPwError(
        err instanceof Error
          ? err.message
          : "No fue posible actualizar la contraseña."
      );
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Usuarios y acceso</h2>
          <p className="page-description">
            Administración de credenciales y control de sesión local de la aplicación.
          </p>
        </div>
        {admin && (
          <Button variant="secondary" onClick={onLogout}>
            Cerrar sesión actual
          </Button>
        )}
      </div>

      <Card
        title="Administrador de la Instalación"
        subtitle="Control de acceso local protegido mediante derivación de contraseñas Argon2id"
        icon={<ShieldCheck size={16} />}
        action={
          <Badge variant={overview.isAuthenticated ? "success" : "neutral"}>
            {overview.isAuthenticated ? "Sesión activa" : "Sin sesión"}
          </Badge>
        }
      >
        {admin ? (
          <div className="meta-list">
            <div className="meta-item">
              <span className="meta-label">Nombre del Administrador</span>
              <span className="meta-value">{admin.fullName}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Usuario de Acceso</span>
              <span className="meta-value mono">{admin.username}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Rol Asignado</span>
              <span className="meta-value">
                {admin.role === "admin"
                  ? "Administrador Principal (admin)"
                  : admin.role}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Permisos del Usuario</span>
              <span className="meta-value mono">
                {admin.permissions.join(", ")}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Fecha de Creación</span>
              <span className="meta-value">{formatDate(admin.createdAt)}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Último Inicio de Sesión</span>
              <span className="meta-value">
                {admin.lastLoginAt
                  ? formatDate(admin.lastLoginAt)
                  : "Sesión actual"}
              </span>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<ShieldCheck size={22} color="var(--text-secondary)" />}
            title="Sin sesión activa"
            description="Inicia sesión para consultar los datos del administrador."
          />
        )}
      </Card>

      {admin && (
        <Card
          title="Cambiar Contraseña de Acceso"
          subtitle="El sistema verificará tu contraseña actual mediante Argon2id antes de guardar la nueva"
          icon={<KeyRound size={16} />}
        >
          <form
            onSubmit={handlePasswordSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
            noValidate
          >
            {pwError && (
              <div
                role="alert"
                style={{
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "var(--status-error-bg)",
                  border: "1px solid var(--status-error-border)",
                  color: "var(--status-error-text)",
                  fontSize: 12.5,
                }}
              >
                {pwError}
              </div>
            )}

            <div className="form-grid-2">
              <div style={{ gridColumn: "1 / -1" }}>
                <Input
                  id="change-pw-current"
                  type="password"
                  label="Contraseña actual *"
                  placeholder="Tu contraseña actual"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  disabled={changingPassword}
                  required
                />
              </div>

              <Input
                id="change-pw-new"
                type="password"
                label="Nueva contraseña *"
                placeholder="Mínimo 8 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={changingPassword}
                required
              />

              <Input
                id="change-pw-confirm"
                type="password"
                label="Confirmar nueva contraseña *"
                placeholder="Repite la nueva contraseña"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                disabled={changingPassword}
                required
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                type="submit"
                variant="primary"
                disabled={changingPassword}
                icon={<CheckCircle2 size={14} />}
              >
                {changingPassword
                  ? "Verificando y guardando..."
                  : "Actualizar contraseña"}
              </Button>
            </div>
          </form>

          <p
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              paddingTop: 8,
              borderTop: "1px solid var(--border-default)",
            }}
          >
            Nota de seguridad: La autenticación local protege el acceso a la
            interfaz y a las operaciones de Cartucho ERP dentro de la
            aplicación, pero no cifra el archivo de base de datos en disco
            frente a terceros con acceso directo al sistema de archivos del
            equipo.
          </p>
        </Card>
      )}
    </div>
  );
}

/* ==========================================================================
   6. Configuración > Base de datos
   ========================================================================== */

export function SettingsDatabaseView({
  overview,
  onRecordCheck,
  savingCheck,
}: {
  overview: SystemOverview;
  onRecordCheck: (note: string) => Promise<void>;
  savingCheck: boolean;
}) {
  const { database } = overview;
  const [note, setNote] = useState<string>(
    `Comprobación de almacenamiento #${database.recentPersistenceChecks.length + 1}`
  );
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    await onRecordCheck(note);
    setNote(
      `Comprobación de almacenamiento #${database.recentPersistenceChecks.length + 2}`
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Base de datos</h2>
          <p className="page-description">
            Estado del almacenamiento local donde se guardan los datos de tu empresa.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<Info size={14} />}
          onClick={() => setDialogOpen(true)}
        >
          Acerca del almacenamiento local
        </Button>
      </div>

      <Card
        title="Estado del Almacenamiento Local"
        subtitle="Información de la base de datos SQLite en este ordenador"
        icon={<FolderOpen size={16} />}
        action={
          <Badge variant={database.connected ? "success" : "error"}>
            {database.connected ? "Funcionando correctamente" : "Sin conexión"}
          </Badge>
        }
      >
        <div className="meta-list">
          <div className="meta-item span-full">
            <span className="meta-label">Ubicación de la Base de Datos</span>
            <span className="meta-value mono">{database.databasePath}</span>
          </div>
          <div className="meta-item span-full">
            <span className="meta-label">
              Carpeta de Respaldos Automáticos de Migración
            </span>
            <span className="meta-value mono">
              {database.appDataDir}/backups
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Espacio Utilizado</span>
            <span className="meta-value">
              {formatBytes(database.databaseSizeBytes)}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Versión de Esquema</span>
            <span className="meta-value">
              Esquema v{database.schemaVersion} (
              {database.appliedMigrations.length}{" "}
              {database.appliedMigrations.length === 1
                ? "migración aplicada"
                : "migraciones aplicadas"}
              )
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Primera Instalación</span>
            <span className="meta-value">
              {formatDate(database.firstInitializedAt)}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Última Apertura</span>
            <span className="meta-value">
              {formatDate(database.lastOpenedAt)}
            </span>
          </div>
        </div>
      </Card>

      <Card
        title="Verificación de Persistencia"
        subtitle="Permite comprobar que los datos escritos se conservan al cerrar y volver a abrir el programa"
        icon={<Database size={16} />}
      >
        <form className="inline-form-row" onSubmit={handleSubmit}>
          <Input
            id="persistence-note-input"
            label="Nota de registro"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escribe una nota de verificación..."
          />
          <Button
            type="submit"
            variant="primary"
            disabled={savingCheck || !note.trim()}
            icon={<Plus size={14} />}
          >
            {savingCheck ? "Guardando..." : "Guardar registro"}
          </Button>
        </form>

        <DataTable<PersistenceCheckRecord>
          rowKey={(row) => row.id}
          data={database.recentPersistenceChecks}
          emptyMessage="Aún no se han registrado comprobaciones."
          columns={[
            {
              key: "id",
              header: "N.º",
              render: (row) => <span className="mono">#{row.id}</span>,
            },
            {
              key: "note",
              header: "Descripción",
              render: (row) => row.note,
            },
            {
              key: "createdAt",
              header: "Fecha",
              render: (row) => (
                <span className="mono">{formatDate(row.createdAt)}</span>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title="Actualizaciones de Estructura (Migraciones)"
        subtitle="Historial de versiones de la base de datos aplicadas en este equipo"
      >
        <DataTable<MigrationRecord>
          rowKey={(row) => row.version}
          data={database.appliedMigrations}
          emptyMessage="No hay migraciones registradas."
          columns={[
            {
              key: "version",
              header: "Versión",
              render: (row) => <Badge variant="neutral">v{row.version}</Badge>,
            },
            {
              key: "name",
              header: "Identificador",
              render: (row) => <span className="mono">{row.name}</span>,
            },
            {
              key: "appliedAt",
              header: "Fecha de aplicación",
              render: (row) => (
                <span className="mono">{formatDate(row.appliedAt)}</span>
              ),
            },
          ]}
        />
      </Card>

      <Dialog
        open={dialogOpen}
        title="Protección y Ubicación de tus Datos"
        onClose={() => setDialogOpen(false)}
        footer={
          <Button variant="primary" onClick={() => setDialogOpen(false)}>
            Entendido
          </Button>
        }
      >
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Todos los datos de tu empresa se guardan directamente en este ordenador dentro de la carpeta protegida de aplicaciones del sistema operativo (<span className="mono">{database.appDataDir}</span>).
        </p>
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Cartucho ERP funciona sin necesidad de conexión a Internet y conserva tu información al cerrar el programa o actualizar la aplicación.
        </p>
      </Dialog>
    </div>
  );
}

/* ==========================================================================
   7. Configuración > Acerca de
   ========================================================================== */

export function SettingsAboutView({ overview }: { overview: SystemOverview }) {
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Acerca de Cartucho ERP</h2>
          <p className="page-description">
            Información general del producto y versión instalada.
          </p>
        </div>
      </div>

      <Card
        title="Cartucho ERP"
        subtitle="Plataforma de gestión empresarial local, modular y adaptable"
        icon={<Layers size={16} />}
      >
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Cartucho ERP es una aplicación de escritorio diseñada para ayudar a las empresas a organizar y administrar sus operaciones diarias de forma clara, rápida y segura en su propio equipo, con una arquitectura preparada para adaptarse a distintos tipos de negocio.
        </p>

        <div className="meta-list">
          <div className="meta-item">
            <span className="meta-label">Nombre del Producto</span>
            <span className="meta-value">{overview.appName}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Versión Instalada</span>
            <span className="meta-value mono">v{overview.appVersion}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Modalidad de Operación</span>
            <span className="meta-value">Escritorio Local Independiente</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Motor de Datos</span>
            <span className="meta-value">
              {overview.database.engine} {overview.database.sqliteVersion}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
}
