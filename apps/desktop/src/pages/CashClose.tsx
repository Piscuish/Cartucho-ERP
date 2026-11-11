/**
 * Cierre de caja: lo cobrado en el día por forma de pago y por usuario, el efectivo
 * que debería haber en caja y las facturas emitidas y anuladas. Se imprime en tirilla.
 *
 * El administrador ve el cierre de todos o de un usuario; los demás, solo el suyo (Rust lo impone).
 */
import { useState } from "react";
import { Banknote, CreditCard, Landmark, Printer, Wallet } from "lucide-react";
import type { CashClose, UserAccount } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAccess } from "../lib/access";
import { useAsync } from "../lib/hooks";
import { fmtDate, METHOD_LABELS, money, todayISO } from "../lib/format";
import { Alert, Button, EmptyState, PageHeader, SkeletonRows, StatCard } from "../components/ui";
import { PrintReport } from "../components/report";

export function CashClosePage({ overview, navigate }: PageProps) {
  const access = useAccess();
  const [date, setDate] = useState(todayISO());
  const [userId, setUserId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const users = useAsync<UserAccount[]>(() => (access.isAdmin ? api.listUsers() : Promise.resolve([])), [access.isAdmin]);
  const { data, loading, error } = useAsync(() => api.cashClose(date, userId), [date, userId]);
  const others = (data?.byMethod ?? []).filter((m) => m.method === "card" || m.method === "other").reduce((a, m) => a + m.total, 0);
  const method = (m: string) => data?.byMethod.find((x) => x.method === m)?.total ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="Cierre de caja"
        subtitle={access.isAdmin ? "Lo cobrado en el día, por forma de pago y por usuario." : "Lo que cobraste en el día, por forma de pago."}
        actions={
          <Button variant="primary" icon={<Printer size={16} />} disabled={!data} onClick={() => setPrinting(true)}>
            Imprimir cierre
          </Button>
        }
      />

      <div className="card mb-16">
        <div className="toolbar">
          <label className="row" style={{ gap: 8 }}>
            <span className="subtle">Día</span>
            <input className="input" type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ width: 170 }} />
          </label>
          {access.isAdmin && (
            <label className="row" style={{ gap: 8 }}>
              <span className="subtle">Usuario</span>
              <select className="input" value={userId ?? ""} onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)} style={{ width: 220 }}>
                <option value="">Todos</option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
      {loading && !data ? (
        <div className="card">
          <SkeletonRows rows={5} />
        </div>
      ) : data ? (
        <>
          <div className="cash-hero card mb-16">
            <div>
              <div className="stat-label">Efectivo que debe haber en caja</div>
              <div className="cash-hero-value">{money(data.expectedCash)}</div>
              <div className="subtle" style={{ fontSize: 13 }}>
                Cobrado en efectivo {money(data.cashCollected)}
                {data.userId === null && <> − gastos en efectivo {money(data.cashExpenses)}</>}
              </div>
            </div>
            <div className="cash-hero-total">
              <div className="stat-label">Total cobrado</div>
              <div className="cash-hero-value is-small">{money(data.collectedTotal)}</div>
              <div className="subtle" style={{ fontSize: 13 }}>
                {data.payments.length} {data.payments.length === 1 ? "pago" : "pagos"} · {fmtDate(data.date)}
              </div>
            </div>
          </div>

          <div className="grid grid-4 mb-16">
            <StatCard label="Efectivo" value={money(method("cash"))} icon={<Banknote size={18} />} tone="success" />
            <StatCard label="Transferencia" value={money(method("transfer"))} icon={<Landmark size={18} />} tone="info" />
            <StatCard label="Tarjeta y otros" value={money(others)} icon={<CreditCard size={18} />} />
            <StatCard
              label="Facturas del día"
              value={money(data.invoicesTotal)}
              icon={<Wallet size={18} />}
              tone="warning"
              foot={`${data.invoicesCount} ${data.invoicesCount === 1 ? "emitida" : "emitidas"}${data.voidedCount ? ` · ${data.voidedCount} anuladas (${money(data.voidedTotal)})` : ""}`}
            />
          </div>

          <div className="grid grid-main-side">
            <div className="card">
              <div className="card-header">
                <div className="card-title">Pagos del día</div>
              </div>
              {data.payments.length === 0 ? (
                <EmptyState icon={<Wallet size={24} />} title="Sin pagos este día" text="Aquí aparecen los cobros de facturas y abonos." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Factura</th>
                        <th>Cliente</th>
                        <th>Forma</th>
                        <th>Cobró</th>
                        <th className="t-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map((p) => (
                        <tr key={p.id} className="is-clickable" onClick={() => navigate({ page: "invoice", id: p.invoiceId })}>
                          <td className="num">{p.invoiceNumber}</td>
                          <td>{p.customerName}</td>
                          <td>{METHOD_LABELS[p.method]}</td>
                          <td className="subtle">{p.createdByName ?? "—"}</td>
                          <td className="t-right money">{money(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card">
              <div className="card-header">
                <div className="card-title">Por usuario</div>
              </div>
              {data.byUser.length === 0 ? (
                <div className="card-body subtle">Sin movimientos.</div>
              ) : (
                <div className="list">
                  {data.byUser.map((u) => (
                    <div key={u.userId ?? 0} className="list-item">
                      <div className="list-item-main">
                        <div className="cell-main">{u.userName}</div>
                        <div className="cell-sub">
                          {u.invoices} {u.invoices === 1 ? "factura" : "facturas"} · {u.payments} {u.payments === 1 ? "cobro" : "cobros"}
                        </div>
                      </div>
                      <div className="money t-strong">{money(u.collected)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {printing && data && (
        <PrintReport narrow onDone={() => setPrinting(false)}>
          <CashCloseTicket data={data} company={overview.company?.tradeName ?? ""} printedBy={overview.currentUser?.fullName ?? ""} />
        </PrintReport>
      )}
    </div>
  );
}

function CashCloseTicket({ data, company, printedBy }: { data: CashClose; company: string; printedBy: string }) {
  return (
    <>
      <div className="rd-center rd-strong">{company}</div>
      <div className="rd-center">CIERRE DE CAJA</div>
      <div className="rd-center">{fmtDate(data.date)}</div>
      <div className="rd-center">{data.userName ? `Usuario: ${data.userName}` : "Todos los usuarios"}</div>
      <hr />
      {data.byMethod.map((m) => (
        <div key={m.method} className="rd-row">
          <span>
            {METHOD_LABELS[m.method]} ({m.count})
          </span>
          <span>{money(m.total)}</span>
        </div>
      ))}
      <hr />
      <div className="rd-row rd-strong">
        <span>Total cobrado</span>
        <span>{money(data.collectedTotal)}</span>
      </div>
      {data.userId === null && (
        <div className="rd-row">
          <span>Gastos en efectivo</span>
          <span>-{money(data.cashExpenses)}</span>
        </div>
      )}
      <div className="rd-row rd-strong">
        <span>Efectivo en caja</span>
        <span>{money(data.expectedCash)}</span>
      </div>
      <hr />
      <div className="rd-row">
        <span>Facturas emitidas ({data.invoicesCount})</span>
        <span>{money(data.invoicesTotal)}</span>
      </div>
      {data.voidedCount > 0 && (
        <div className="rd-row">
          <span>Anuladas ({data.voidedCount})</span>
          <span>{money(data.voidedTotal)}</span>
        </div>
      )}
      {data.byUser.length > 1 && (
        <>
          <hr />
          {data.byUser.map((u) => (
            <div key={u.userId ?? 0} className="rd-row">
              <span>{u.userName}</span>
              <span>{money(u.collected)}</span>
            </div>
          ))}
        </>
      )}
      <hr />
      <div className="rd-small">Impreso por {printedBy} · {new Date().toLocaleString("es-CO")}</div>
      <div className="rd-sign">Firma: ______________________</div>
    </>
  );
}
