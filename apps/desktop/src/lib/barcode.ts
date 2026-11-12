/**
 * Lector de código de barras.
 *
 * Los lectores USB/Bluetooth funcionan como un teclado: "escriben" el código muy rápido y
 * terminan con Enter. Aquí se reconoce ese patrón cuando el foco NO está en un campo de
 * texto (si está en un buscador, ese buscador maneja el Enter por su cuenta).
 */
import { useEffect, useRef } from "react";
import type { Product } from "@cartucho/shared";

/** Producto activo cuyo código de barras o código interno (SKU) coincide exactamente. */
export function findByCode(products: Product[], code: string): Product | undefined {
  const c = code.trim().toLowerCase();
  if (!c) return undefined;
  return (
    products.find((p) => p.isActive && (p.barcode ?? "").toLowerCase() === c) ??
    products.find((p) => p.isActive && (p.sku ?? "").toLowerCase() === c)
  );
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !["button", "checkbox", "radio", "range", "submit", "reset"].includes(el.type);
  return false;
}

/** Máximo de milisegundos entre teclas para considerarlo un lector y no una persona. */
const MAX_GAP_MS = 50;
const MIN_LENGTH = 3;

export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const handler = useRef(onScan);
  handler.current = onScan;
  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
      // Con un diálogo abierto, el lector no agrega productos detrás.
      if (document.querySelector(".modal-wrap")) return;
      const now = performance.now();
      if (now - last > MAX_GAP_MS) buffer = "";
      last = now;
      if (e.key === "Enter") {
        if (buffer.length >= MIN_LENGTH) {
          e.preventDefault();
          const code = buffer;
          buffer = "";
          handler.current(code);
        }
        buffer = "";
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}
