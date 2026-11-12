/**
 * Actualizaciones automáticas.
 *
 * El programa consulta `latest.json` en las versiones publicadas de GitHub (gratis). Cada
 * instalador va firmado: el programa solo instala una actualización si la firma coincide con
 * la clave pública que trae dentro. Antes de instalar se hace una copia de seguridad.
 */
import { isTauri } from "@tauri-apps/api/core";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  /** Descarga, instala y reinicia. `onProgress` recibe 0–100 (o null si no se conoce el tamaño). */
  install: (onProgress: (pct: number | null) => void) => Promise<void>;
}

const PREF_KEY = "cartucho.updates.auto";

export function autoCheckEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoCheck(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignorar */
  }
}

export const updatesSupported = () => isTauri();

/** Devuelve la actualización disponible o `null` si ya está al día. */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 20000 });
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
    install: async (onProgress) => {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") {
          total = ev.data.contentLength ?? 0;
          onProgress(total ? 0 : null);
        } else if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          onProgress(total ? Math.min(100, Math.round((done / total) * 100)) : null);
        } else if (ev.event === "Finished") {
          onProgress(100);
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}

/** Mensaje legible para errores de la búsqueda de actualizaciones. */
export function updateErrorMessage(e: unknown): string {
  const text = String((e as { message?: string })?.message ?? e ?? "");
  if (/network|connect|dns|timed? ?out|request/i.test(text)) return "No hay conexión a Internet para buscar actualizaciones.";
  if (/signature/i.test(text)) return "La actualización no tiene una firma válida y no se instaló.";
  if (/404|not found|json/i.test(text)) return "Todavía no hay versiones publicadas.";
  return "No se pudo buscar actualizaciones en este momento.";
}
