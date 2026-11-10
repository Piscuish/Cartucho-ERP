import React, { useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  FolderOpen,
  HardDrive,
  Info,
  Layers,
  Monitor,
  Moon,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import type {
  MigrationRecord,
  NavigationSectionId,
  PersistenceCheckRecord,
  ResolvedTheme,
  SystemOverview,
  ThemePreference,
} from "@cartucho/shared";
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

/* ==========================================================================
   1. Pantalla: Inicio (Home)
   ========================================================================== */

export function HomeView({
  overview,
  onNavigate,
}: {
  overview: SystemOverview;
  onNavigate: (section: NavigationSectionId) => void;
}) {
  const { database } = overview;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Bienvenido a Cartucho ERP</h2>
          <p className="page-description">
            Plataforma de escritorio local-first, autónoma e independiente. Todos los datos se
            almacenan localmente en este equipo sin depender de conexión a Internet.
          </p>
        </div>
        <Badge variant="neutral">Versión {overview.appVersion}</Badge>
      </div>

      <div className="grid-3">
        <Card
          title="Estado de la Aplicación"
          subtitle="Núcleo de escritorio local"
          icon={<Cpu size={16} />}
          action={<Badge variant="success">Operativo</Badge>}
        >
          <div className="meta-list">
            <div className="meta-item">
              <span className="meta-label">Arquitectura</span>
              <span className="meta-value">Local-First</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Inicios Registrados</span>
              <span className="meta-value">{database.startupCount}</span>
            </div>
            <div className="meta-item span-full">
              <span className="meta-label">Plataforma / Entorno</span>
              <span className="meta-value mono">
                {overview.osPlatform} ({overview.osArch}) · {overview.runtimeMode}
              </span>
            </div>
          </div>
        </Card>

        <Card
          title="Conexión SQLite Local"
          subtitle="Base de datos embebida"
          icon={<Database size={16} />}
          action={
            <Badge variant={database.connected ? "success" : "error"}>
              {database.connected ? "Conectado" : "Sin conexión"}
            </Badge>
          }
        >
          <div className="meta-list">
            <div className="meta-item">
              <span className="meta-label">Motor</span>
              <span className="meta-value">
                {database.engine} {database.sqliteVersion}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Modo Journal</span>
              <span className="meta-value mono">
                {database.journalMode.toUpperCase()}
              </span>
            </div>
            <div className="meta-item span-full">
              <span className="meta-label">Esquema / Migraciones</span>
              <span className="meta-value">
                Versión v{database.schemaVersion} ({database.appliedMigrations.length} aplicada)
              </span>
            </div>
          </div>
        </Card>

        <Card
          title="Almacenamiento del Sistema"
          subtitle="Directorio de usuario del SO"
          icon={<HardDrive size={16} />}
          action={
            <Button
              variant="secondary"
              onClick={() => onNavigate("storage")}
            >
              Ver detalles
            </Button>
          }
        >
          <div className="meta-list">
            <div className="meta-item">
              <span className="meta-label">Tamaño Actual</span>
              <span className="meta-value">
                {formatBytes(database.databaseSizeBytes)}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Registros Técnicos</span>
              <span className="meta-value">
                {database.recentPersistenceChecks.length}
              </span>
            </div>
            <div className="meta-item span-full">
              <span className="meta-label">Archivo SQLite</span>
              <span className="meta-value mono">{database.databasePath}</span>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Espacio de Trabajo Inicial"
        subtitle="Fase 0 — Fundación técnica y visual completada"
      >
        <EmptyState
          title="Sin módulos de negocio activos en esta fase"
          description="Esta versión inicial establece la arquitectura local-first con Tauri 2, Rust, SQLite y el sistema de diseño Business Minimalist. No se incluyen estadísticas ficticias ni módulos comerciales todavía."
          action={
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Button
                variant="primary"
                onClick={() => onNavigate("storage")}
              >
                Probar persistencia SQLite
              </Button>
              <Button
                variant="secondary"
                onClick={() => onNavigate("preferences")}
              >
                Configurar apariencia
              </Button>
            </div>
          }
        />
      </Card>
    </div>
  );
}

/* ==========================================================================
   2. Pantalla: Almacenamiento (Storage)
   ========================================================================== */

export function StorageView({
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
    `Comprobación manual de persistencia #${database.recentPersistenceChecks.length + 1}`
  );
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    await onRecordCheck(note);
    setNote(
      `Comprobación manual de persistencia #${database.recentPersistenceChecks.length + 2}`
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Almacenamiento Local y Base de Datos</h2>
          <p className="page-description">
            Diagnóstico real del archivo SQLite gestionado por la capa nativa en Rust y ubicado en
            el directorio de datos del sistema operativo.
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<Info size={14} />}
          onClick={() => setDialogOpen(true)}
        >
          Política de ubicación de datos
        </Button>
      </div>

      <Card
        title="Parámetros Técnicos de SQLite"
        subtitle="Información obtenida en tiempo real desde el motor nativo"
        icon={<FolderOpen size={16} />}
        action={
          <Badge variant={database.connected ? "success" : "error"}>
            {database.connected ? "Conexión Activa" : "Desconectado"}
          </Badge>
        }
      >
        <div className="meta-list">
          <div className="meta-item span-full">
            <span className="meta-label">Ruta Completa del Archivo SQLite</span>
            <span className="meta-value mono">{database.databasePath}</span>
          </div>
          <div className="meta-item span-full">
            <span className="meta-label">Directorio de Datos de Aplicación (SO)</span>
            <span className="meta-value mono">{database.appDataDir}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Versión de SQLite</span>
            <span className="meta-value mono">{database.sqliteVersion}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Tamaño en Disco</span>
            <span className="meta-value">
              {formatBytes(database.databaseSizeBytes)} ({database.databaseSizeBytes} bytes)
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Modo de Journal / Claves Foráneas</span>
            <span className="meta-value mono">
              {database.journalMode.toUpperCase()} /{" "}
              {database.foreignKeysEnabled ? "FK ON" : "FK OFF"}
            </span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Aperturas Acumuladas</span>
            <span className="meta-value">{database.startupCount} inicio(s)</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Primera Inicialización</span>
            <span className="meta-value">{formatDate(database.firstInitializedAt)}</span>
          </div>
          <div className="meta-item">
            <span className="meta-label">Última Apertura</span>
            <span className="meta-value">{formatDate(database.lastOpenedAt)}</span>
          </div>
        </div>
      </Card>

      <Card
        title="Prueba de Escritura y Persistencia Local"
        subtitle="Inserta un registro técnico en la tabla _persistence_checks para comprobar que se conserva tras cerrar y volver a abrir el programa"
      >
        <form className="inline-form-row" onSubmit={handleSubmit}>
          <Input
            id="persistence-note-input"
            label="Nota de comprobación"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe la prueba de persistencia..."
          />
          <Button
            type="submit"
            variant="primary"
            disabled={savingCheck || !note.trim()}
            icon={<Plus size={14} />}
          >
            {savingCheck ? "Guardando..." : "Registrar en SQLite"}
          </Button>
        </form>

        <DataTable<PersistenceCheckRecord>
          rowKey={(row) => row.id}
          data={database.recentPersistenceChecks}
          emptyMessage="Aún no se han registrado comprobaciones."
          columns={[
            {
              key: "id",
              header: "ID",
              render: (row) => <span className="mono">#{row.id}</span>,
            },
            {
              key: "note",
              header: "Nota Persistida en SQLite",
              render: (row) => row.note,
            },
            {
              key: "createdAt",
              header: "Fecha y Hora",
              render: (row) => (
                <span className="mono">{formatDate(row.createdAt)}</span>
              ),
            },
          ]}
        />
      </Card>

      <Card
        title="Historial de Migraciones de Esquema (_schema_migrations)"
        subtitle="Control de versiones del esquema SQLite ejecutado al iniciar la aplicación"
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
              header: "Nombre de la Migración",
              render: (row) => <span className="mono">{row.name}</span>,
            },
            {
              key: "appliedAt",
              header: "Aplicada el",
              render: (row) => (
                <span className="mono">{formatDate(row.appliedAt)}</span>
              ),
            },
          ]}
        />
      </Card>

      <Dialog
        open={dialogOpen}
        title="Ubicación y Aislamiento de la Base de Datos Local"
        onClose={() => setDialogOpen(false)}
        footer={
          <Button variant="primary" onClick={() => setDialogOpen(false)}>
            Entendido
          </Button>
        }
      >
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>
          Cartucho ERP almacena su archivo SQLite exclusivamente en el directorio de datos de
          aplicación asignado por el sistema operativo del usuario:
        </p>
        <ul
          style={{
            fontSize: 12.5,
            color: "var(--text-primary)",
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <li>
            <strong>Windows:</strong>{" "}
            <span className="mono">%LOCALAPPDATA%\cartucho\cartucho-erp\data</span>
          </li>
          <li>
            <strong>Linux:</strong>{" "}
            <span className="mono">~/.local/share/cartucho-erp</span>
          </li>
          <li>
            <strong>macOS:</strong>{" "}
            <span className="mono">~/Library/Application Support/com.cartucho.cartucho-erp</span>
          </li>
        </ul>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 10 }}>
          Nunca se guarda dentro de la carpeta de instalación ni en el repositorio Git, y no debe
          ubicarse en carpetas compartidas de red para evitar corrupción por bloqueos concurrentes.
        </p>
      </Dialog>
    </div>
  );
}

/* ==========================================================================
   3. Pantalla: Preferencias (Preferences)
   ========================================================================== */

export function PreferencesView({
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
      description: "Fondo #F4F5F7 y superficies #FFFFFF de alto contraste diurno.",
      icon: <Sun size={18} />,
    },
    {
      value: "dark",
      title: "Oscuro",
      description: "Fondo #17191E y superficies #24272E para entornos de baja luz.",
      icon: <Moon size={18} />,
    },
    {
      value: "system",
      title: "Sistema operativo",
      description: "Adopta automáticamente la apariencia configurada en tu sistema.",
      icon: <Monitor size={18} />,
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Preferencias de la Aplicación</h2>
          <p className="page-description">
            Personaliza el tema visual de Cartucho ERP. La preferencia seleccionada se guarda
            directamente en la base de datos SQLite local y se restaura al iniciar el programa.
          </p>
        </div>
      </div>

      <Card
        title="Apariencia y Tema Visual (Business Minimalist)"
        subtitle="Selección persistente mediante tokens semánticos centralizados"
        icon={<SlidersHorizontal size={16} />}
        action={
          <Badge variant="neutral">
            Activo: {resolvedTheme === "dark" ? "Tema Oscuro" : "Tema Claro"}
          </Badge>
        }
      >
        <div className="theme-options-grid" role="radiogroup" aria-label="Preferencia de tema">
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
            label="Selector compacto de tema"
            helperText={`Última actualización en SQLite: ${formatDate(preferencesUpdatedAt)}`}
            value={themePreference}
            disabled={savingTheme}
            onChange={(e) => onSelectTheme(e.target.value as ThemePreference)}
            options={[
              { value: "light", label: "Tema Claro (#F4F5F7 / #FFFFFF)" },
              { value: "dark", label: "Tema Oscuro (#17191E / #24272E)" },
              { value: "system", label: "Seguir tema del Sistema Operativo" },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}

/* ==========================================================================
   4. Pantalla: Acerca de (About)
   ========================================================================== */

export function AboutView({ overview }: { overview: SystemOverview }) {
  const upcomingModules = [
    {
      stage: "Fase 1",
      name: "Configuración de Empresa Local y Copias de Seguridad",
      scope: "Datos básicos del negocio y exportación/importación de respaldos SQLite locales.",
    },
    {
      stage: "Fase 2",
      name: "Catálogos Básicos (Clientes y Productos/Servicios)",
      scope: "Registro local de clientes y artículos con control sencillo.",
    },
    {
      stage: "Fase 3",
      name: "Documentos de Venta Internos y Registro Manual de Pagos",
      scope:
        "Documentos de venta internos (Pendiente, Parcialmente pagada, Pagada) y registro manual informativo de pagos (Efectivo, Transferencia, Tarjeta, Otro). Sin pasarelas ni facturación electrónica DIAN.",
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2 className="page-title">Acerca de Cartucho ERP</h2>
          <p className="page-description">
            Información técnica de la aplicación, principios de diseño y hoja de ruta planificada.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <Card
          title="Identidad del Producto"
          subtitle="Software de gestión empresarial local-first"
          icon={<Layers size={16} />}
        >
          <div className="meta-list">
            <div className="meta-item">
              <span className="meta-label">Producto</span>
              <span className="meta-value">{overview.appName}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Versión</span>
              <span className="meta-value mono">v{overview.appVersion}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Fase Actual</span>
              <span className="meta-value">{overview.phase}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Identidad Visual</span>
              <span className="meta-value">Business Minimalist</span>
            </div>
          </div>
        </Card>

        <Card
          title="Arquitectura y Autonomía"
          subtitle="Sin dependencia de Internet ni servicios externos"
          icon={<ShieldCheck size={16} />}
        >
          <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Cartucho ERP se instala localmente en el ordenador del cliente y almacena toda su
            información en una base de datos SQLite dedicada dentro del directorio de usuario del
            sistema operativo.
          </p>
          <div className="meta-list">
            <div className="meta-item">
              <span className="meta-label">Capa Nativa</span>
              <span className="meta-value">Tauri 2 + Rust</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Interfaz</span>
              <span className="meta-value">React 19 + TypeScript + Vite</span>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Hoja de Ruta de Próximos Módulos (Informativo)"
        subtitle="Fases planificadas — No activas en la Fase 0"
      >
        <DataTable
          rowKey={(row) => row.stage}
          data={upcomingModules}
          columns={[
            {
              key: "stage",
              header: "Etapa",
              render: (row) => <Badge variant="neutral">{row.stage}</Badge>,
            },
            {
              key: "name",
              header: "Módulo Planificado",
              render: (row) => <strong>{row.name}</strong>,
            },
            {
              key: "scope",
              header: "Alcance Definido",
              render: (row) => row.scope,
            },
          ]}
        />
      </Card>
    </div>
  );
}
