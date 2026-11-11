import { useState } from "react";
import { Download, FilePlus2, FileText } from "lucide-react";
import type { PageProps } from "../components/views";
import { api, isDesktop, pickSavePath } from "../services/systemClient";
import { useAsync, useDebounced } from "../lib/hooks";
import { errorMessage, fmtDate, isOverdue, money, todayISO } from "../lib/format";
import { Alert, Button, EmptyState, InvoiceStatusBadge, PageHeader, SearchBox, Segmented, SkeletonRows, useToast } from "../components/ui";

type StatusFilter = "" | "open" | "paid" | "void";

export function InvoicesPage({ navigate, initialStatus }: PageProps & { initialStatus?: string }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>((initialStatus as StatusFilter) ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const q = useDebounced(search);
  const { data, loading, error } = useAsync(
    () => api.listInvoices({ search: q, status: status || null, dateFrom: from || null, dateTo: to || null }),
    [q, status, from, to],
  );

  const totals = (data ?? []).reduce(
    (acc, i) => {
      if (i.status !== "void") {
        acc.total += i.total;
        acc.balance += i.balance;
      }
      return acc;
    },
    { total: 0, balance: 0 },
  );

  const exportCsv = async () => {
    try {
      const dest = await pickSavePath("Exportar facturas", `facturas_${todayISO()}.csv`, "csv", "Archivo CSV (Excel)");
      if (!dest) return;
      const path = await api.exportCsv("invoices", from || null, to || null, dest);
      toast(`Exportado: ${path}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Facturas"
        subtitle="Historial de ventas, pagos y saldos pendientes."
        actions={
          <>
            {isDesktop() && (
              <Button icon={<Download size={16} />} onClick={exportCsv}>
                Exportar
              </Button>
            )}
            <Button variant="primary" icon={<FilePlus2 size={16} />} onClick={() => navigate({ page: "invoice-new" })}>
              Nueva factura
            </Button>
          </>
        }
      />

      <div className="card">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Número, cliente o documento…" />
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "Todas" },
              { value: "open", label: "Por cobrar" },
              { value: "paid", label: "Pagadas" },
              { value: "void", label: "Anuladas" },
            ]}
          />
          <div className="row" style={{ marginLeft: "auto" }}>
            <input type="date" className="input" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
            <span className="subtle">a</span>
            <input type="date" className="input" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          </div>
        </div>

        {error && (
          <div style={{ padding: 16 }}>
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        {loading && !data ? (
          <SkeletonRows rows={8} />
        ) : data && data.length === 0 ? (
          search || status || from || to ? (
            <EmptyState icon={<FileText size={24} />} title="No hay facturas con esos filtros" text="Prueba con otra búsqueda o limpia los filtros." />
          ) : (
            <EmptyState
              icon={<FilePlus2 size={24} />}
              title="Crea tu primera factura"
              text="Tus facturas quedarán aquí con su estado de pago, listas para reimprimir."
              action={
                <Button variant="primary" onClick={() => navigate({ page: "invoice-new" })}>
                  Nueva factura
                </Button>
              }
            />
          )
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Fecha</th>
                    <th>Vence</th>
                    <th>Estado</th>
                    <th className="t-right">Total</th>
                    <th className="t-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.map((i) => (
                    <tr key={i.id} className={`is-clickable ${i.status === "void" ? "is-muted" : ""}`} onClick={() => navigate({ page: "invoice", id: i.id })}>
                      <td className="cell-main">{i.number}</td>
                      <td>{i.customerName}</td>
                      <td>{fmtDate(i.issueDate)}</td>
                      <td>{i.dueDate ? fmtDate(i.dueDate) : <span className="subtle">—</span>}</td>
                      <td>
                        <InvoiceStatusBadge status={i.status} overdue={isOverdue(i.dueDate, i.balance, i.status)} />
                      </td>
                      <td className="t-right money" style={i.status === "void" ? { textDecoration: "line-through" } : undefined}>
                        {money(i.total)}
                      </td>
                      <td className="t-right money">{i.balance > 0 ? <strong>{money(i.balance)}</strong> : <span className="subtle">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-between" style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", fontSize: 13 }}>
              <span className="muted">{data?.length} facturas</span>
              <span>
                Total <strong className="money">{money(totals.total)}</strong> · Por cobrar <strong className="money">{money(totals.balance)}</strong>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
