import { useEffect, useState } from "react";
import { Copy, FileCheck2, FileSignature, Printer, XCircle } from "lucide-react";
import type { BusinessSettings, QuoteDetail, QuoteStatus } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAsync, useDebounced } from "../lib/hooks";
import { addDays, fmtDate, money, qty, todayISO } from "../lib/format";
import { Alert, Button, ConfirmDialog, EmptyState, PageHeader, QuoteStatusBadge, SearchBox, Segmented, SkeletonRows, useToast } from "../components/ui";
import { PrintDialog, PrintableDoc } from "../components/print";

export function QuotesPage({ navigate }: PageProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | QuoteStatus>("");
  const q = useDebounced(search);
  const { data, loading, error } = useAsync(() => api.listQuotes(q, status || null), [q, status]);
  const today = todayISO();

  return (
    <div className="page">
      <PageHeader
        title="Cotizaciones"
        subtitle="Presupuestos para tus clientes. Conviértelos en factura con un clic."
        actions={
          <Button variant="primary" icon={<FileSignature size={16} />} onClick={() => navigate({ page: "quote-new" })}>
            Nueva cotización
          </Button>
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Número o cliente…" />
          <Segmented<"" | QuoteStatus>
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "Todas" },
              { value: "open", label: "Abiertas" },
              { value: "converted", label: "Facturadas" },
              { value: "cancelled", label: "Canceladas" },
            ]}
          />
        </div>
        {error && (
          <div style={{ padding: 16 }}>
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        {loading && !data ? (
          <SkeletonRows />
        ) : data && data.length === 0 ? (
          <EmptyState
            icon={<FileSignature size={24} />}
            title={search || status ? "No hay cotizaciones con esos filtros" : "Envía tu primera cotización"}
            text={search || status ? undefined : "Prepara un presupuesto, imprímelo y, cuando el cliente acepte, conviértelo en factura."}
            action={
              !search && !status ? (
                <Button variant="primary" onClick={() => navigate({ page: "quote-new" })}>
                  Nueva cotización
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Fecha</th>
                  <th>Válida hasta</th>
                  <th>Estado</th>
                  <th className="t-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((x) => {
                  const expired = x.status === "open" && x.validUntil && x.validUntil < today;
                  return (
                    <tr key={x.id} className="is-clickable" onClick={() => navigate({ page: "quote", id: x.id })}>
                      <td className="cell-main">{x.number}</td>
                      <td>{x.customerName}</td>
                      <td>{fmtDate(x.issueDate)}</td>
                      <td style={expired ? { color: "var(--danger)" } : undefined}>{x.validUntil ? fmtDate(x.validUntil) : "—"}</td>
                      <td>
                        <QuoteStatusBadge status={x.status} />
                        {x.convertedInvoiceNumber && <span className="cell-sub"> → {x.convertedInvoiceNumber}</span>}
                      </td>
                      <td className="t-right money">{money(x.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function quoteToPrintable(q: QuoteDetail): PrintableDoc {
  return {
    kind: "quote",
    number: q.number,
    issueDate: q.issueDate,
    secondDate: q.validUntil,
    status: q.status,
    customer: q.customer,
    lines: q.lines,
    total: q.total,
    paidAmount: 0,
    balance: q.total,
    payments: [],
    notes: q.notes,
    terms: q.terms,
    footer: q.footer,
    voidReason: null,
  };
}

export function QuoteDetailPage({ id, autoPrint, goBack, navigate, overview }: PageProps & { id: number; autoPrint?: boolean }) {
  const toast = useToast();
  const { data: q, loading, error, setData } = useAsync(() => api.getQuote(id), [id]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [printing, setPrinting] = useState(!!autoPrint);
  const [cancelling, setCancelling] = useState(false);
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    api.getBusinessSettings().then(setSettings).catch(() => undefined);
  }, []);

  if (loading && !q)
    return (
      <div className="page">
        <div className="card">
          <SkeletonRows rows={6} />
        </div>
      </div>
    );
  if (error || !q)
    return (
      <div className="page">
        <Alert tone="danger">{error ?? "No se encontró la cotización."}</Alert>
      </div>
    );

  return (
    <div className="page">
      <PageHeader
        back={{ label: "Volver", onClick: goBack }}
        title={
          <span className="row" style={{ gap: 12 }}>
            Cotización {q.number} <QuoteStatusBadge status={q.status} />
          </span>
        }
        subtitle={`${q.customer.name} · ${fmtDate(q.issueDate)}${q.validUntil ? ` · válida hasta ${fmtDate(q.validUntil)}` : ""}`}
        actions={
          <>
            {q.status === "open" && (
              <Button variant="danger" icon={<XCircle size={16} />} onClick={() => setCancelling(true)}>
                Cancelar
              </Button>
            )}
            <Button icon={<Copy size={16} />} onClick={() => navigate({ page: "quote-new", fromQuoteId: q.id })}>
              Duplicar
            </Button>
            <Button icon={<Printer size={16} />} onClick={() => setPrinting(true)} disabled={!settings}>
              Imprimir
            </Button>
            {q.status === "open" && (
              <Button variant="primary" icon={<FileCheck2 size={16} />} onClick={() => setConverting(true)}>
                Convertir en factura
              </Button>
            )}
            {q.convertedInvoiceId && (
              <Button variant="primary" onClick={() => navigate({ page: "invoice", id: q.convertedInvoiceId! })}>
                Ver factura {q.convertedInvoiceNumber}
              </Button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="card-body">
          <div style={{ fontWeight: 600, fontSize: 15 }}>{q.customer.name}</div>
          <div className="muted" style={{ fontSize: 13 }}>
            {[q.customer.documentId, q.customer.phone, q.customer.email, q.customer.address].filter(Boolean).join(" · ")}
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
              {q.lines.map((l) => (
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
        <div className="card-body row-between" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 13, maxWidth: "60%" }}>
            {q.notes}
            {q.terms ? `\n${q.terms}` : ""}
          </div>
          <div className="totals-row is-grand" style={{ border: 0, minWidth: 220 }}>
            <span>Total</span>
            <span>{money(q.total)}</span>
          </div>
        </div>
      </div>

      {printing && settings && overview.company && <PrintDialog doc={quoteToPrintable(q)} company={overview.company} settings={settings} onClose={() => setPrinting(false)} autoPrint={autoPrint} />}

      {cancelling && (
        <ConfirmDialog
          title={`¿Cancelar la cotización ${q.number}?`}
          text="Quedará marcada como cancelada y ya no podrá convertirse en factura."
          confirmLabel="Cancelar cotización"
          danger
          onClose={() => setCancelling(false)}
          onConfirm={async () => {
            setData(await api.cancelQuote(q.id));
            toast("Cotización cancelada");
          }}
        />
      )}

      {converting && (
        <ConfirmDialog
          title="Convertir en factura"
          text={`Se creará una factura con fecha de hoy por ${money(q.total)} y se descontarán los productos del inventario.`}
          confirmLabel="Crear factura"
          onClose={() => setConverting(false)}
          onConfirm={async () => {
            const s = settings ?? (await api.getBusinessSettings());
            const today = todayISO();
            const inv = await api.convertQuote(q.id, today, s.defaultDueDays > 0 ? addDays(today, s.defaultDueDays) : null);
            toast(`Factura ${inv.number} creada`);
            navigate({ page: "invoice", id: inv.id });
          }}
        />
      )}
    </div>
  );
}
