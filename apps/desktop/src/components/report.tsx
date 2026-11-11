/**
 * Impresión de reportes sencillos (cierre de caja, estado de cuenta).
 * Monta el contenido en `.print-root` (fuera de la app) y abre el diálogo de impresión.
 */
import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

export function PrintReport({ children, narrow, onDone }: { children: ReactNode; narrow?: boolean; onDone: () => void }) {
  useEffect(() => {
    const done = () => onDone();
    window.addEventListener("afterprint", done);
    // Un instante para que el navegador pinte el contenido antes de imprimir.
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [onDone]);
  return createPortal(
    <div className="print-root">
      <div className={`report-doc ${narrow ? "is-narrow" : ""}`}>{children}</div>
    </div>,
    document.body,
  );
}
