/**
 * Marco de ventana propio: reemplaza la barra de título del sistema operativo
 * (la ventana se crea con `decorations: false` en tauri.conf.json).
 *
 * - Arrastrar la barra mueve la ventana; doble clic la maximiza o restaura.
 * - Los bordes siguen permitiendo cambiar el tamaño (Tauri lo maneja en ventanas sin decoración).
 * - En la vista previa del navegador se muestra igual, pero los botones no hacen nada.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Minus, X } from "lucide-react";
import { isDesktop } from "../services/systemClient";

type TauriWindow = import("@tauri-apps/api/window").Window;

let windowPromise: Promise<TauriWindow | null> | null = null;
function appWindow(): Promise<TauriWindow | null> {
  if (!isDesktop()) return Promise.resolve(null);
  windowPromise ??= import("@tauri-apps/api/window").then((m) => m.getCurrentWindow()).catch(() => null);
  return windowPromise;
}

// ------------------------------------------------------------------ Título dinámico

interface FrameTitle {
  title: string;
  logo: string | null;
}
const TitleContext = createContext<(t: FrameTitle) => void>(() => {});

/** Cambia el nombre (y logo) que se muestra en la barra de título. */
export function useWindowTitle(title: string, logo: string | null = null) {
  const set = useContext(TitleContext);
  useEffect(() => {
    set({ title, logo });
    document.title = title;
  }, [set, title, logo]);
}

// ------------------------------------------------------------------ Íconos (trazo fino, estilo Windows 11)

const MaximizeIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="0.5" y="2.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" />
    <path d="M2.5 2.5V1.8C2.5 1.1 3.1 0.5 3.8 0.5H8.2C8.9 0.5 9.5 1.1 9.5 1.8V6.2C9.5 6.9 8.9 7.5 8.2 7.5H7.5" fill="none" stroke="currentColor" />
  </svg>
);

// ------------------------------------------------------------------ Barra

function TitleBar({ title, logo }: FrameTitle) {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    let off: Array<() => void> = [];
    let cancelled = false;
    void appWindow().then(async (w) => {
      if (!w) return;
      const sync = async () => setMaximized(await w.isMaximized());
      await sync();
      // Al arrastrar un borde llegan decenas de eventos por segundo: se consulta solo al terminar.
      let timer: number | undefined;
      const a = await w.onResized(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void sync(), 120);
      });
      const b = await w.onFocusChanged(({ payload }) => setFocused(payload));
      if (cancelled) {
        a();
        b();
      } else off = [a, b];
    });
    return () => {
      cancelled = true;
      off.forEach((u) => u());
    };
  }, []);

  const run = useCallback((fn: (w: TauriWindow) => Promise<void>) => void appWindow().then((w) => w && fn(w)), []);

  return (
    <header className={`titlebar ${focused ? "" : "is-blurred"}`} data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        {logo ? (
          <img className="titlebar-logo" src={logo} alt="" data-tauri-drag-region draggable={false} />
        ) : (
          <span className="titlebar-mark" data-tauri-drag-region>
            CE
          </span>
        )}
        <span className="titlebar-title" data-tauri-drag-region>
          {title}
        </span>
      </div>
      <div className="titlebar-spacer" data-tauri-drag-region />
      <div className="titlebar-controls">
        <button type="button" className="titlebar-btn" aria-label="Minimizar" title="Minimizar" onClick={() => run((w) => w.minimize())}>
          <Minus size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="titlebar-btn"
          aria-label={maximized ? "Restaurar" : "Maximizar"}
          title={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => run((w) => w.toggleMaximize())}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button type="button" className="titlebar-btn is-close" aria-label="Cerrar" title="Cerrar" onClick={() => run((w) => w.close())}>
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ Marco

export function WindowFrame({ children }: { children: ReactNode }) {
  const [frame, setFrame] = useState<FrameTitle>({ title: "Cartucho ERP", logo: null });
  const set = useCallback((t: FrameTitle) => setFrame((prev) => (prev.title === t.title && prev.logo === t.logo ? prev : t)), []);
  return (
    <TitleContext.Provider value={set}>
      <div className="window-frame">
        <TitleBar {...frame} />
        <div className="window-content">{children}</div>
      </div>
    </TitleContext.Provider>
  );
}
