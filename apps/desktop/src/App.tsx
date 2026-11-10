import React, { useEffect, useState } from "react";
import type { SystemOverview } from "@cartucho/shared";
import {
  fetchSystemOverview,
  recordPersistenceCheck,
} from "./services/systemClient";
import "./App.css";

export function App() {
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState<string>(
    "Comprobación de persistencia en SQLite local"
  );
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    fetchSystemOverview(true)
      .then((data) => {
        if (mounted) {
          setOverview(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleRecordCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await recordPersistenceCheck(noteInput);
      setOverview(updated);
      setNoteInput("Comprobación de persistencia #" + (updated.database.recentPersistenceChecks.length + 1));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="app-shell loading-screen">
        <div className="status-card">
          <h1>Inicializando Cartucho ERP...</h1>
          <p>Verificando motor local y conexión con SQLite...</p>
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="app-shell error-screen">
        <div className="status-card error-border">
          <h1>Error al inicializar el diagnóstico del sistema</h1>
          <p>{error ?? "No fue posible obtener el estado del sistema."}</p>
        </div>
      </div>
    );
  }

  const { database } = overview;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-badge">CE</div>
          <div>
            <h1>{overview.appName}</h1>
            <p className="subtitle">
              {overview.phase} · v{overview.appVersion}
            </p>
          </div>
        </div>
        <div className="badges">
          <span className="pill pill-primary">Arquitectura: Local-First</span>
          <span className={`pill ${database.connected ? "pill-success" : "pill-danger"}`}>
            {database.connected ? "SQLite Conectado" : "SQLite Desconectado"}
          </span>
          <span className="pill pill-neutral">
            Entorno: {overview.runtimeMode === "tauri-desktop" ? "Tauri 2 Nativo" : "Vista Previa Web"}
          </span>
        </div>
      </header>

      <main className="content-grid">
        <section className="panel">
          <h2>Estado de la Aplicación y Entorno</h2>
          <p className="panel-description">
            Aplicación de escritorio autónoma. Funciona 100% sin conexión a Internet y almacena
            sus datos localmente en el equipo del usuario.
          </p>
          <dl className="kv-list">
            <div>
              <dt>Nombre / Versión</dt>
              <dd>{overview.appName} v{overview.appVersion}</dd>
            </div>
            <div>
              <dt>Modo Arquitectónico</dt>
              <dd>Instalación Local Independiente ({overview.architectureMode})</dd>
            </div>
            <div>
              <dt>Plataforma / Arquitectura</dt>
              <dd>{overview.osPlatform} ({overview.osArch})</dd>
            </div>
            <div>
              <dt>Aperturas Registradas</dt>
              <dd>{database.startupCount} inicio(s) persistidos</dd>
            </div>
            <div>
              <dt>Primera Inicialización</dt>
              <dd>{new Date(database.firstInitializedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Última Actividad</dt>
              <dd>{new Date(database.lastOpenedAt).toLocaleString()}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2>Estado de Base de Datos Local (SQLite)</h2>
          <p className="panel-description">
            Ubicada en el directorio de datos de aplicación del sistema operativo, fuera de la
            carpeta de instalación y del repositorio Git.
          </p>
          <dl className="kv-list">
            <div>
              <dt>Motor / Versión</dt>
              <dd>{database.engine} ({database.sqliteVersion})</dd>
            </div>
            <div>
              <dt>Versión de Esquema</dt>
              <dd>v{database.schemaVersion} ({database.appliedMigrations.length} migración aplicada)</dd>
            </div>
            <div className="full-width">
              <dt>Directorio de Datos del SO (AppData)</dt>
              <dd className="mono">{database.appDataDir}</dd>
            </div>
            <div className="full-width">
              <dt>Ruta del Archivo SQLite</dt>
              <dd className="mono">{database.databasePath}</dd>
            </div>
          </dl>

          <div className="subpanel">
            <h3>Migraciones Aplicadas</h3>
            <ul className="migration-list">
              {database.appliedMigrations.map((m) => (
                <li key={m.version}>
                  <span className="mono">v{m.version}</span>
                  <span>{m.name}</span>
                  <span className="muted">{new Date(m.appliedAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="panel full-span">
          <div className="panel-header-row">
            <div>
              <h2>Prueba Técnica de Persistencia Local (SQLite)</h2>
              <p className="panel-description">
                Registra un evento de prueba en la base de datos SQLite local para verificar que los
                datos persisten al cerrar y volver a abrir la aplicación.
              </p>
            </div>
          </div>

          <form className="persistence-form" onSubmit={handleRecordCheck}>
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Escribe una nota de verificación..."
              aria-label="Nota de verificación de persistencia"
            />
            <button type="submit" disabled={saving}>
              {saving ? "Guardando en SQLite..." : "Registrar Prueba en SQLite"}
            </button>
          </form>

          <div className="table-wrapper">
            <table className="records-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nota de Verificación</th>
                  <th>Fecha y Hora (UTC / Local)</th>
                </tr>
              </thead>
              <tbody>
                {database.recentPersistenceChecks.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No hay registros de prueba todavía.
                    </td>
                  </tr>
                ) : (
                  database.recentPersistenceChecks.map((item) => (
                    <tr key={item.id}>
                      <td className="mono">#{item.id}</td>
                      <td>{item.note}</td>
                      <td className="mono">{new Date(item.createdAt).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
