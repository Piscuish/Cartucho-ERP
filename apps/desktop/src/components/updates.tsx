/**
 * Actualizaciones: aviso en la barra superior, diálogo de instalación y sección en «Acerca de».
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Download, RefreshCw, Sparkles } from "lucide-react";
import { api } from "../services/systemClient";
import { autoCheckEnabled, checkForUpdate, setAutoCheck, updateErrorMessage, updatesSupported, type AvailableUpdate } from "../services/updates";
import { Alert, Button, Modal, Switch } from "./ui";

/** Cada cuánto se buscan actualizaciones automáticamente. */
const CHECK_EVERY = 12 * 60 * 60 * 1000;

/** Busca actualizaciones sola (al iniciar y cada 12 horas) si el usuario lo permite. */
export function useAutoUpdateCheck(enabled: boolean): [AvailableUpdate | null, (u: AvailableUpdate | null) => void] {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  useEffect(() => {
    if (!enabled || !updatesSupported()) return;
    let alive = true;
    const run = () => {
      if (!autoCheckEnabled()) return;
      checkForUpdate()
        .then((u) => alive && setUpdate(u))
        .catch(() => undefined); // sin Internet: se intenta más tarde, sin molestar
    };
    const first = window.setTimeout(run, 8000);
    const every = window.setInterval(run, CHECK_EVERY);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [enabled]);
  return [update, setUpdate];
}

export function UpdateButton({ update, onOpen }: { update: AvailableUpdate; onOpen: () => void }) {
  return (
    <button className="update-pill" onClick={onOpen} title={`Actualizar a la versión ${update.version}`}>
      <Sparkles size={14} /> Nueva versión {update.version}
    </button>
  );
}

export function UpdateDialog({ update, onClose }: { update: AvailableUpdate; onClose: () => void }) {
  const [phase, setPhase] = useState<"idle" | "backup" | "download" | "restart">("idle");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const install = async () => {
    setError(null);
    setPhase("backup");
    try {
      // Copia de seguridad antes de actualizar (además de la que se hace al migrar la base).
      await api.createManualBackup();
    } catch {
      /* si no se puede (por ejemplo, sin permisos), la actualización igual crea su copia al migrar */
    }
    setPhase("download");
    try {
      await update.install((p) => {
        setProgress(p);
        if (p === 100) setPhase("restart");
      });
    } catch (e) {
      setPhase("idle");
      setError(updateErrorMessage(e));
    }
  };

  const working = phase !== "idle";
  return (
    <Modal
      onClose={working ? () => undefined : onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={working}>
            Más tarde
          </Button>
          <Button variant="primary" icon={<Download size={16} />} loading={working} onClick={() => void install()}>
            Actualizar ahora
          </Button>
        </>
      }
    >
      <div className="modal-title">Versión {update.version} disponible</div>
      <p className="muted mt-8">
        Tienes la versión {update.currentVersion}. Antes de instalar se hace una copia de seguridad de tus datos; el programa se cierra y se
        vuelve a abrir solo.
      </p>
      {update.notes && <div className="update-notes">{update.notes}</div>}
      {working && (
        <div className="mt-16">
          <div className="update-progress">
            <span style={{ width: `${progress ?? 15}%` }} className={progress == null ? "is-indeterminate" : ""} />
          </div>
          <div className="subtle mt-8" style={{ fontSize: 12.5 }}>
            {phase === "backup" ? "Haciendo copia de seguridad…" : phase === "download" ? `Descargando${progress != null ? ` ${progress} %` : "…"}` : "Instalando y reiniciando…"}
          </div>
        </div>
      )}
      {error && (
        <div className="mt-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}

/** Sección «Actualizaciones» en Configuración › Acerca de. */
export function UpdatesSection({ version }: { version: string }) {
  const [auto, setAuto] = useState(autoCheckEnabled());
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [open, setOpen] = useState(false);
  const supported = updatesSupported();

  const check = async () => {
    setChecking(true);
    setResult(null);
    try {
      const u = await checkForUpdate();
      setUpdate(u);
      if (u) setOpen(true);
      else setResult({ tone: "success", text: `Tienes la versión más reciente (${version}).` });
    } catch (e) {
      setResult({ tone: "danger", text: updateErrorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="card mb-16">
      <div className="card-body">
        <div className="form-section-title">Actualizaciones</div>
        <div className="form-section-desc">Las nuevas versiones se descargan de Internet, van firmadas y no borran tus datos.</div>
        {!supported ? (
          <Alert tone="info">Disponible en la aplicación de escritorio.</Alert>
        ) : (
          <>
            <div className="row-between" style={{ gap: 16, flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 10 }}>
                <CheckCircle2 size={18} color="var(--success)" />
                <span>
                  Versión instalada: <strong>{version}</strong>
                </span>
              </div>
              <Button icon={<RefreshCw size={16} />} loading={checking} onClick={() => void check()}>
                Buscar actualizaciones
              </Button>
            </div>
            {result && (
              <div className="mt-16">
                <Alert tone={result.tone}>{result.text}</Alert>
              </div>
            )}
            <div className="mt-16">
              <Switch
                checked={auto}
                onChange={(v) => {
                  setAuto(v);
                  setAutoCheck(v);
                }}
                label="Buscar actualizaciones automáticamente"
                description="Al abrir el programa y cada 12 horas. Siempre te pregunta antes de instalar."
              />
            </div>
          </>
        )}
      </div>
      {open && update && <UpdateDialog update={update} onClose={() => setOpen(false)} />}
    </div>
  );
}
