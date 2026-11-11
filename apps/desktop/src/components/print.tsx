/**
 * Impresión de facturas y cotizaciones en varios tamaños de hoja:
 * Carta, Media carta, A4 y tirilla térmica de 80 mm o 58 mm.
 *
 * Funciona con el diálogo de impresión del sistema (WebView2 en Windows), así que
 * también permite "Guardar como PDF".
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import type { BusinessSettings, CompanyProfile, CustomerSnapshot, DocumentLine, PaperSize, Payment } from "@cartucho/shared";
import { fmtDate, METHOD_LABELS, money, qty } from "../lib/format";
import { Button, Modal } from "./ui";

export interface PrintableDoc {
  kind: "invoice" | "quote";
  number: string;
  issueDate: string;
  secondDate: string | null;
  status: string;
  customer: CustomerSnapshot;
  lines: DocumentLine[];
  total: number;
  paidAmount: number;
  balance: number;
  payments: Payment[];
  notes: string | null;
  terms: string | null;
  footer: string | null;
  voidReason: string | null;
}

export const PAPER_OPTIONS: { id: PaperSize; label: string; desc: string; w: number; h: number | null }[] = [
  { id: "letter", label: "Carta", desc: "21,6 × 27,9 cm", w: 215.9, h: 279.4 },
  { id: "half-letter", label: "Media carta", desc: "14 × 21,6 cm", w: 139.7, h: 215.9 },
  { id: "a4", label: "A4", desc: "21 × 29,7 cm", w: 210, h: 297 },
  { id: "roll80", label: "Tirilla 80 mm", desc: "Impresora térmica", w: 80, h: null },
  { id: "roll58", label: "Tirilla 58 mm", desc: "Impresora térmica", w: 58, h: null },
];

const MM_TO_PX = 96 / 25.4;

export function PaperIcon({ id }: { id: PaperSize }) {
  const o = PAPER_OPTIONS.find((p) => p.id === id)!;
  const w = o.h ? (o.w / 279.4) * 34 : (o.w / 80) * 14;
  const h = o.h ? (o.h / 279.4) * 34 : 34;
  return <span className="paper-icon" style={{ width: w, height: h, borderStyle: o.h ? "solid" : "dashed" }} />;
}

function DocTitle(kind: PrintableDoc["kind"]) {
  return kind === "invoice" ? "Factura de venta" : "Cotización";
}

function FullDocument({ doc, company, settings, half }: { doc: PrintableDoc; company: CompanyProfile; settings: BusinessSettings; half: boolean }) {
  const isInvoice = doc.kind === "invoice";
  return (
    <div className={`doc ${half ? "doc-half" : "doc-full"}`}>
      <div className="doc-head">
        <div className="doc-company">
          {settings.showLogoOnPrint && company.logoDataUrl && <img className="doc-logo" src={company.logoDataUrl} alt="" />}
          <div>
            <div className="doc-company-name">{company.tradeName}</div>
            {company.legalName && <div className="doc-muted">{company.legalName}</div>}
            {company.taxId && <div className="doc-muted">NIT / Doc.: {company.taxId}</div>}
            {company.address && <div className="doc-muted">{company.address}</div>}
            <div className="doc-muted">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div className="doc-title-box">
          <div className="doc-type">{DocTitle(doc.kind)}</div>
          <div className="doc-number">N.º {doc.number}</div>
          <div className="doc-muted" style={{ marginTop: 4 }}>
            Fecha: {fmtDate(doc.issueDate)}
          </div>
          {doc.secondDate && (
            <div className="doc-muted">
              {isInvoice ? "Vence" : "Válida hasta"}: {fmtDate(doc.secondDate)}
            </div>
          )}
        </div>
      </div>

      {doc.status === "void" && <div className="doc-void-stamp">ANULADA{doc.voidReason ? ` — ${doc.voidReason}` : ""}</div>}

      <div className="doc-meta">
        <div>
          <div className="doc-box-label">Cliente</div>
          <div style={{ fontWeight: 600 }}>{doc.customer.name}</div>
          {doc.customer.documentId && <div className="doc-muted">Doc.: {doc.customer.documentId}</div>}
          {doc.customer.address && <div className="doc-muted">{doc.customer.address}</div>}
          <div className="doc-muted">{[doc.customer.phone, doc.customer.email].filter(Boolean).join(" · ")}</div>
        </div>
        {isInvoice && doc.status !== "void" && (
          <div>
            <div className="doc-box-label">Estado de pago</div>
            <div style={{ fontWeight: 600 }}>{doc.balance <= 0 ? "Pagada" : doc.paidAmount > 0 ? "Pago parcial" : "Pendiente de pago"}</div>
            {doc.payments.length > 0 && (
              <div className="doc-muted" style={{ whiteSpace: "pre-line" }}>
                {doc.payments.map((p) => `${fmtDate(p.paidAt)} · ${METHOD_LABELS[p.method]} · ${money(p.amount)}`).join("\n")}
              </div>
            )}
          </div>
        )}
      </div>

      <table className="doc-table">
        <thead>
          <tr>
            <th style={{ width: 28 }}>#</th>
            <th>Descripción</th>
            <th className="r">Cant.</th>
            <th className="r">Precio unit.</th>
            <th className="r">Total</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.position}</td>
              <td>{l.description}</td>
              <td className="r">{qty(l.quantity)}</td>
              <td className="r">{money(l.unitPrice)}</td>
              <td className="r">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-bottom">
        <div>
          {doc.notes && (
            <>
              <div className="doc-box-label">Notas</div>
              <div className="doc-text-block">{doc.notes}</div>
            </>
          )}
          {doc.terms && (
            <>
              <div className="doc-box-label">Condiciones</div>
              <div className="doc-text-block">{doc.terms}</div>
            </>
          )}
        </div>
        <div className="doc-totals">
          <div className="row grand">
            <span>Total</span>
            <span>{money(doc.total)}</span>
          </div>
          {isInvoice && doc.status !== "void" && (
            <>
              <div className="row">
                <span>Pagado</span>
                <span>{money(doc.paidAmount)}</span>
              </div>
              <div className="row" style={{ fontWeight: 600 }}>
                <span>Saldo</span>
                <span>{money(doc.balance)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {doc.footer && <div className="doc-footer">{doc.footer}</div>}
      <div className="doc-disclaimer">
        {isInvoice ? "Documento interno de venta. No es factura electrónica." : "Cotización sin valor contable."} · Generado con Cartucho ERP
      </div>
    </div>
  );
}

function TicketDocument({ doc, company, settings, narrow }: { doc: PrintableDoc; company: CompanyProfile; settings: BusinessSettings; narrow: boolean }) {
  const isInvoice = doc.kind === "invoice";
  return (
    <div className={`doc doc-ticket ${narrow ? "is-58" : ""}`}>
      <div className="t-center">
        {settings.showLogoOnPrint && company.logoDataUrl && <img className="t-logo" src={company.logoDataUrl} alt="" />}
        <div className="t-name">{company.tradeName}</div>
        {company.taxId && <div>NIT {company.taxId}</div>}
        {company.address && <div>{company.address}</div>}
        {company.phone && <div>Tel. {company.phone}</div>}
      </div>
      <div className="t-sep" />
      <div className="t-center" style={{ fontWeight: 700 }}>
        {DocTitle(doc.kind).toUpperCase()} {doc.number}
      </div>
      <div className="t-row">
        <span>Fecha</span>
        <span>{fmtDate(doc.issueDate)}</span>
      </div>
      {doc.secondDate && (
        <div className="t-row">
          <span>{isInvoice ? "Vence" : "Válida"}</span>
          <span>{fmtDate(doc.secondDate)}</span>
        </div>
      )}
      <div className="t-row">
        <span>Cliente</span>
        <span style={{ textAlign: "right" }}>{doc.customer.name}</span>
      </div>
      {doc.customer.documentId && (
        <div className="t-row">
          <span>Doc.</span>
          <span>{doc.customer.documentId}</span>
        </div>
      )}
      {doc.status === "void" && <div className="t-center" style={{ fontWeight: 700, margin: "2mm 0" }}>*** ANULADA ***</div>}
      <div className="t-sep" />
      {doc.lines.map((l) => (
        <div key={l.id} className="t-item">
          <div className="t-wrap">{l.description}</div>
          <div className="t-row">
            <span>
              {qty(l.quantity)} × {money(l.unitPrice)}
            </span>
            <span>{money(l.lineTotal)}</span>
          </div>
        </div>
      ))}
      <div className="t-sep" />
      <div className="t-row t-total">
        <span>TOTAL</span>
        <span>{money(doc.total)}</span>
      </div>
      {isInvoice && doc.status !== "void" && (
        <>
          {doc.payments.map((p) => (
            <div className="t-row" key={p.id}>
              <span>{METHOD_LABELS[p.method]}</span>
              <span>{money(p.amount)}</span>
            </div>
          ))}
          {doc.balance > 0 && (
            <div className="t-row" style={{ fontWeight: 700 }}>
              <span>SALDO</span>
              <span>{money(doc.balance)}</span>
            </div>
          )}
        </>
      )}
      {(doc.notes || doc.terms) && <div className="t-sep" />}
      {doc.notes && <div className="t-wrap">{doc.notes}</div>}
      {doc.terms && <div className="t-wrap" style={{ marginTop: "1mm" }}>{doc.terms}</div>}
      <div className="t-sep" />
      {doc.footer && <div className="t-center t-wrap">{doc.footer}</div>}
      <div className="t-center" style={{ fontSize: "6.5pt", marginTop: "2mm" }}>
        {isInvoice ? "Documento interno. No es factura electrónica." : "Cotización sin valor contable."}
      </div>
    </div>
  );
}

export function PrintableDocument({ doc, company, settings, paper }: { doc: PrintableDoc; company: CompanyProfile; settings: BusinessSettings; paper: PaperSize }) {
  if (paper === "roll80" || paper === "roll58") return <TicketDocument doc={doc} company={company} settings={settings} narrow={paper === "roll58"} />;
  return <FullDocument doc={doc} company={company} settings={settings} half={paper === "half-letter"} />;
}

/** Lanza el diálogo de impresión con el tamaño de hoja correcto. */
function runPrint(paper: PaperSize, root: HTMLElement) {
  const opt = PAPER_OPTIONS.find((p) => p.id === paper)!;
  let height = opt.h;
  if (!height) {
    // Tirilla: el alto se ajusta al contenido para no desperdiciar papel.
    root.style.display = "block";
    root.style.width = `${opt.w}mm`;
    height = Math.ceil(root.scrollHeight / MM_TO_PX) + 4;
    root.style.display = "";
  }
  const style = document.createElement("style");
  style.id = "cartucho-print-page";
  style.textContent = `@page { size: ${opt.w}mm ${height}mm; margin: 0; } .print-root { width: ${opt.w}mm; }`;
  document.head.appendChild(style);
  const cleanup = () => {
    style.remove();
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Respaldo por si el motor no emite `afterprint`.
  setTimeout(cleanup, 60_000);
}

export function PrintDialog({
  doc,
  company,
  settings,
  onClose,
  autoPrint,
}: {
  doc: PrintableDoc;
  company: CompanyProfile;
  settings: BusinessSettings;
  onClose: () => void;
  autoPrint?: boolean;
}) {
  const [paper, setPaper] = useState<PaperSize>(settings.paperSize);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const opt = PAPER_OPTIONS.find((p) => p.id === paper)!;
  const previewScale = opt.h ? Math.min(1, 560 / (opt.w * MM_TO_PX)) : 1;

  useEffect(() => {
    if (autoPrint && rootRef.current) {
      const t = setTimeout(() => rootRef.current && runPrint(paper, rootRef.current), 350);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Modal
        large
        onClose={onClose}
        footer={
          <>
            <span className="subtle" style={{ marginRight: "auto", fontSize: 12.5 }}>
              En el diálogo puedes elegir la impresora o «Guardar como PDF».
            </span>
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            <Button variant="primary" icon={<Printer size={16} />} onClick={() => rootRef.current && runPrint(paper, rootRef.current)}>
              Imprimir
            </Button>
          </>
        }
      >
        <div className="row-between mb-16">
          <div>
            <div className="modal-title">
              Imprimir {doc.kind === "invoice" ? "factura" : "cotización"} {doc.number}
            </div>
            <div className="modal-text">Elige el tamaño de hoja. Puedes cambiar el predeterminado en Configuración.</div>
          </div>
        </div>
        <div className="paper-options mb-16">
          {PAPER_OPTIONS.map((p) => (
            <button key={p.id} className={`paper-option ${paper === p.id ? "is-active" : ""}`} onClick={() => setPaper(p.id)}>
              <PaperIcon id={p.id} />
              <span>{p.label}</span>
              <span className="subtle" style={{ fontSize: 11 }}>
                {p.desc}
              </span>
            </button>
          ))}
        </div>
        <div className="print-preview-stage">
          <div
            className="print-preview-paper"
            style={{
              width: `${opt.w}mm`,
              minHeight: opt.h ? `${opt.h}mm` : undefined,
              transform: `scale(${previewScale})`,
              marginBottom: opt.h ? `calc(${opt.h}mm * ${previewScale - 1})` : 0,
            }}
          >
            <PrintableDocument doc={doc} company={company} settings={settings} paper={paper} />
          </div>
        </div>
      </Modal>
      {createPortal(
        <div className="print-root" ref={rootRef}>
          <PrintableDocument doc={doc} company={company} settings={settings} paper={paper} />
        </div>,
        document.body,
      )}
    </>
  );
}
