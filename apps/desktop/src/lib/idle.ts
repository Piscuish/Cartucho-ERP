import { useEffect, useRef } from "react";

/**
 * Llama a `onIdle` cuando pasan `minutes` minutos sin mouse, teclado ni toques.
 * Con `minutes` = 0 no hace nada. El aviso se comprueba cada 15 s (barato).
 */
export function useIdleTimeout(minutes: number, onIdle: () => void) {
  const last = useRef(Date.now());
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!minutes) return;
    last.current = Date.now();
    const touch = () => {
      last.current = Date.now();
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = window.setInterval(() => {
      if (Date.now() - last.current >= minutes * 60_000) {
        last.current = Date.now();
        cb.current();
      }
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(t);
    };
  }, [minutes]);
}
