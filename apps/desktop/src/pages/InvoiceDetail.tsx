import { useEffect, useState } from "react";
import { Ban, Banknote, Copy, FileSignature, Printer } from "lucide-react";
import type { BusinessSettings, InvoiceDetail, PaymentMethod } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAsync } from "../lib/hooks";
import { errorMessage, fmtDate, fmtDateTime, isOverdue, METHOD_LABELS, money, qty, todayISO } from "../lib/format";
import { Alert, Button, ConfirmDialog, Drawer, Field, InvoiceStatusBadge, MoneyInput, PageHeader, Segmented, SkeletonRows, useToast } from "../components/ui";
import { PrintDialog, PrintableDoc } from "../components/print";

export function invoiceToPrintable(inv: InvoiceDetail): PrintableDoc {
  return {
    kind: "invoice",
    number: inv.number,
    issueDate: inv.issueDate,
    secondDate: inv.dueDate,
    status: inv.status,
    customer: inv.customer,
    lines: inv.lines,
    total: inv.total,
    paidAmount: inv.paidAmount,
    balance: inv.balance,
    payments: inv.payments,
    notes: inv.notes,
    terms: inv.terms,
    footer: inv.footer,
    voidReason: inv.voidReason,
  };
}

export function InvoiceDetailPage({ id, autoPrint, goBack, navigate, overview }: PageProps & { id: number; autoPrint?: boolean }) {
  const toast = useToast();
  const { data: inv, loading, error, setData } = useAsync(() => api.getInvoice(id), [id]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [printing, setPrinting] = useState(!!autoPrint);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    api.getBusinessSettings().then(setSettings).catch(() => undefined);
  }, []);

  if (loading && !inv)
    return (
      <div className="page">
        <div className="card">
          <SkeletonRows rows={8} />
        </div>
      </div>
    );
  if (error || !inv)
    return (
      <div className="page">
        <Alert tone="danger">{error ?? "No se encontró la factura."}</Alert>
      </div>
    );

  const overdue = isOverdue(inv.dueDate, inv.balance, inv.status);
  const paidPct = inv.total > 0 ? Math.min(100, (inv.paidAmount / inv.total) * 100) : 100;

  return (
    <div className="page">
      <PageHeader
        back={{ label: "Volver", onClick: goBack }}
        title={
          <span className="row" style={{ gap: 12 }}>
            Factura {inv.number} <InvoiceStatusBadge status={inv.status} overdue={overdue} />
          </span>
        }
        subtitle={`${inv.customer.name} · ${fmtDate(inv.issueDate)}`}
        actions={
          <>
            {inv.status !== "void" && (
              <Button variant="danger" icon={<Ban size={16} />} onClick={() => setVoiding(true)}>
                Anular
              </Button>
            )}
            <Button icon={<Copy size={16} />} onClick={() => navigate({ page: "invoice-new", fromInvoiceId: inv.id })}>
              Duplicar
            </Button>
            <Button icon={<Printer size={16} />} onClick={() => setPrinting(true)} disabled={!settings}>
              Imprimir
            </Button>
            {inv.status !== "void" && inv.balance > 0 && (
              <Button variant="primary" icon={<Banknote size={16} />} onClick={() => setPaying(true)}>
                Registrar pago
              </Button>
            )}
          </>
        }
      />

      {inv.status === "void" && (
        <div className="mb-16">
          <Alert tone="warning" title="Factura anulada">
            {inv.voidReason} · {fmtDateTime(inv.voidedAt)}. Se conserva el número y el registro; las existencias se devolvieron al inventario y sus pagos no cuentan como ingreso.
          </Alert>
        </div>
      )}

      <div className="grid grid-main-side">
        <div className="card">
          <div className="card-body">
            <div className="grid grid-2" style={{ gap: 24 }}>
              <div>
                <div className="field-label subtle mb-16" style={{ marginBottom: 6 }}>
                  Cliente
                </div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{inv.customer.name}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {[inv.customer.documentId, inv.customer.phone, inv.customer.email].filter(Boolean).join(" · ")}
                </div>
                {inv.customer.address && <div className="muted" style={{ fontSize: 13 }}>{inv.customer.address}</div>}
              </div>
              <dl className="kv" style={{ gridTemplateColumns: "120px 1fr" }}>
                <dt>Emisión</dt>
                <dd>{fmtDate(inv.issueDate)}</dd>
                <dt>Vencimiento</dt>
                <dd style={overdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{inv.dueDate ? fmtDate(inv.dueDate) : "—"}</dd>
                {inv.quoteNumber && (
                  <>
                    <dt>Cotización</dt>
                    <dd>
                      <button className="back-link" style={{ margin: 0, color: "var(--accent-text)" }} onClick={() => inv.quoteId && navigate({ page: "quote", id: inv.quoteId })}>
                        <FileSignature size={13} /> {inv.quoteNumber}
                      </button>
                    </dd>
                  </>
                )}
              </dl>
            </div>
          </div>
          <div className="table-wrap" style={{ borderTop: "1px solid var(--border)" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Descripción</th>
                  <th className="t-right">Cantidad</th>
                  <th className="t-right">Precio</th>
                  <th className="t-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {inv.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="t-right num">{qty(l.quantity)}</td>
                    <td className="t-right money">{money(l.unitPrice)}</td>
                    <td className="t-right money">{money(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="row-between">
              <div style={{ maxWidth: "60%" }}>
                {inv.notes && (
                  <p className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                    <strong>Notas:</strong> {inv.notes}
                  </p>
                )}
                {inv.terms && (
                  <p className="muted mt-8" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
                    <strong>Condiciones:</strong> {inv.terms}
                  </p>
                )}
              </div>
              <div className="totals" style={{ minWidth: 220 }}>
                <div className="totals-row is-grand" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
                  <span>Total</span>
                  <span style={inv.status === "void" ? { textDecoration: "line-through" } : undefined}>{money(inv.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="stack-lg">
          <div className="card card-pad">
            <div className="card-title mb-16">Pagos</div>
            <div className="totals">
              <div className="totals-row">
                <span className="muted">Total</span>
                <span>{money(inv.total)}</span>
              </div>
              <div className="totals-row">
                <span className="muted">Pagado</span>
                <span className="profit-positive">{money(inv.paidAmount)}</span>
              </div>
              <div className="hbar-track mt-8">
                <div className="hbar-fill" style={{ width: `${paidPct}%`, background: "var(--success)" }} />
              </div>
              <div className="totals-row is-grand" style={{ fontSize: 18 }}>
                <span>Saldo</span>
                <span className={inv.balance > 0 ? "profit-negative" : ""}>{money(inv.balance)}</span>
              </div>
            </div>
            {inv.status !== "void" && inv.balance > 0 && (
              <Button variant="primary" block className="mt-16" icon={<Banknote size={16} />} onClick={() => setPaying(true)}>
                Registrar pago
              </Button>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Historial de pagos</div>
            </div>
            {inv.payments.length === 0 ? (
              <div className="card-body subtle">Aún no hay pagos registrados.</div>
            ) : (
              <div className="list">
                {inv.payments.map((p) => (
                  <div className="list-item" key={p.id}>
                    <div className="list-item-main">
                      <div className="cell-main">{METHOD_LABELS[p.method]}</div>
                      <div className="cell-sub">
                        {fmtDate(p.paidAt)}
                        {p.note ? ` · ${p.note}` : ""}
                      </div>
                    </div>
                    <span className="money" style={{ fontWeight: 600 }}>
                      {money(p.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {printing && settings && overview.company && (
        <PrintDialog doc={invoiceToPrintable(inv)} company={overview.company} settings={settings} onClose={() => setPrinting(false)} autoPrint={autoPrint} />
      )}

      {paying && (
        <PaymentDrawer
          invoice={inv}
          onClose={() => setPaying(false)}
          onSaved={(updated) => {
            setData(updated);
            setPaying(false);
            toast(updated.balance === 0 ? "Factura pagada por completo" : "Pago registrado");
          }}
        />
      )}

      {voiding && (
        <ConfirmDialog
          title={`¿Anular la factura ${inv.number}?`}
          text="La factura queda registrada como anulada (no se borra). Los productos vuelven al inventario y sus pagos dejan de contar como ingreso. Esta acción no se puede deshacer."
          confirmLabel="Anular factura"
          danger
          requireReason
          reasonLabel="Motivo de la anulación"
          onClose={() => setVoiding(false)}
          onConfirm={async (reason) => {
            const updated = await api.voidInvoice(inv.id, reason);
            setData(updated);
            toast("Factura anulada");
          }}
        />
      )}
    </div>
  );
}

function PaymentDrawer({ invoice, onClose, onSaved }: { invoice: InvoiceDetail; onClose: () => void; onSaved: (inv: InvoiceDetail) => void }) {
  const [amount, setAmount] = useState(invoice.balance);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (amount <= 0) {
      setError("Escribe el valor recibido.");
      return;
    }
    if (amount > invoice.balance) {
      setError(`El pago no puede superar el saldo de ${money(invoice.balance)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.addPayment(invoice.id, { amount, method, paidAt: date, note }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title="Registrar pago"
      subtitle={`Factura ${invoice.number} · Saldo ${money(invoice.balance)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Guardar pago
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        <Field label="Valor recibido" error={error}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <div className="row">
          <Button size="sm" onClick={() => setAmount(invoice.balance)}>
            Saldo completo
          </Button>
          <Button size="sm" onClick={() => setAmount(Math.round(invoice.balance / 2))}>
            Mitad
          </Button>
        </div>
        <Field label="Método de pago">
          <Segmented<PaymentMethod> value={method} onChange={setMethod} options={(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))} />
        </Field>
        <Field label="Fecha del pago">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Nota" optional hint="Ej.: número de transferencia, Nequi, Daviplata.">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {amount > 0 && amount < invoice.balance && <Alert tone="info">Quedará un saldo pendiente de {money(invoice.balance - amount)}.</Alert>}
      </div>
    </Drawer>
  );
}
