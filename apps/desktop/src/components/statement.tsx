/** Estado de cuenta de un cliente: facturas, abonos y saldo, con impresión en carta. */
import { useState } from "react";
import { Printer } from "lucide-react";
import type { CustomerStatement } from "@cartucho/shared";
import { api } from "../services/systemClient";
import { useAsync } from "../lib/hooks";
import { fmtDate, METHOD_LABELS, money, todayISO } from "../lib/format";
import { Alert, Button, InvoiceStatusBadge, Modal, SkeletonRows } from "./ui";
import { PrintReport } from "./report";

export function StatementDialog({ customerId, company, onClose }: { customerId: number; company: string; onClose: () => void }) {
  const today = todayISO();
  const { data, loading, error } = useAsync(() => api.customerStatement(customerId, today), [customerId]);
  const [printing, setPrinting] = useState(false);
  return (
    <Modal
      large
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" icon={<Printer size={16} />} disabled={!data} onClick={() => setPrinting(true)}>
            Imprimir o guardar PDF
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {loading && !data ? <SkeletonRows rows={5} /> : data && <StatementBody data={data} company={company} today={today} />}
      {printing && data && (
        <PrintReport onDone={() => setPrinting(false)}>
          <StatementBody data={data} company={company} today={today} forPrint />
        </PrintReport>
      )}
    </Modal>
  );
}

function StatementBody({ data, company, today, forPrint }: { data: CustomerStatement; company: string; today: string; forPrint?: boolean }) {
  const c = data.customer;
  return (
    <div className={forPrint ? "" : "statement"}>
      <div className="row-between" style={{ alignItems: "flex-start", gap: 16, marginBottom: 14 }}>
        <div>
          <div className="rd-title">Estado de cuenta</div>
          <div className="cell-main" style={{ fontSize: 16 }}>{c.name}</div>
          <div className="subtle" style={{ fontSize: 13 }}>
            {[c.documentId, c.phone, c.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="cell-main">{company}</div>
          <div className="subtle" style={{ fontSize: 13 }}>Corte: {fmtDate(today)}</div>
        </div>
      </div>
      <div className="statement-totals">
        <div>
          <span>Facturado</span>
          <strong>{money(data.totalInvoiced)}</strong>
        </div>
        <div>
          <span>Pagado</span>
          <strong>{money(data.totalPaid)}</strong>
        </div>
        <div className={data.balance > 0 ? "is-due" : ""}>
          <span>Saldo pendiente</span>
          <strong>{money(data.balance)}</strong>
        </div>
        {data.overdueBalance > 0 && (
          <div className="is-due">
            <span>Vencido</span>
            <strong>{money(data.overdueBalance)}</strong>
          </div>
        )}
      </div>
      <table className="table statement-table">
        <thead>
          <tr>
            <th>Factura</th>
            <th>Fecha</th>
            <th>Vence</th>
            <th>Estado</th>
            <th className="t-right">Total</th>
            <th className="t-right">Pagado</th>
            <th className="t-right">Saldo</th>
          </tr>
        </thead>
        <tbody>
          {data.invoices.length === 0 && (
            <tr>
              <td colSpan={7} className="subtle">
                Este cliente no tiene facturas.
              </td>
            </tr>
          )}
          {data.invoices.map((i) => (
            <tr key={i.id}>
              <td className="num">{i.number}</td>
              <td>{fmtDate(i.issueDate)}</td>
              <td>{i.dueDate ? fmtDate(i.dueDate) : "—"}</td>
              <td>{forPrint ? (i.balance > 0 ? (i.dueDate && i.dueDate < today ? "Vencida" : "Pendiente") : "Pagada") : <InvoiceStatusBadge status={i.status} overdue={!!i.dueDate && i.dueDate < today && i.balance > 0} />}</td>
              <td className="t-right money">{money(i.total)}</td>
              <td className="t-right money">{money(i.paidAmount)}</td>
              <td className="t-right money t-strong">{i.balance ? money(i.balance) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.payments.length > 0 && (
        <>
          <div className="card-title" style={{ margin: "18px 0 8px" }}>
            Pagos y abonos
          </div>
          <table className="table statement-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Factura</th>
                <th>Forma</th>
                <th className="t-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.paidAt)}</td>
                  <td className="num">{p.invoiceNumber}</td>
                  <td>{METHOD_LABELS[p.method]}</td>
                  <td className="t-right money">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
