import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Download, FilePlus2, UserPlus, Users } from "lucide-react";
import type { Customer, CustomerInput, InvoiceSummary } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api, isDesktop, pickSavePath } from "../services/systemClient";
import { useAccess } from "../lib/access";
import { useAsync, useDebounced } from "../lib/hooks";
import { errorMessage, fmtDate, initials, isOverdue, money, todayISO } from "../lib/format";
import { Alert, Badge, Button, Drawer, EmptyState, Field, InvoiceStatusBadge, PageHeader, SearchBox, SkeletonRows, Switch, useToast } from "../components/ui";

export function CustomersPage({ navigate, openId }: PageProps & { openId?: number }) {
  const canEdit = useAccess().canWrite("customers");
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const q = useDebounced(search);
  const { data, loading, error, reload } = useAsync(() => api.listCustomers(q, showArchived), [q, showArchived]);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);

  useEffect(() => {
    if (openId && data) {
      const c = data.find((x) => x.id === openId);
      if (c) setEditing(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, data === null]);

  const exportCsv = async () => {
    try {
      const dest = await pickSavePath("Exportar clientes", `clientes_${todayISO()}.csv`, "csv", "Archivo CSV (Excel)");
      if (!dest) return;
      toast(`Exportado: ${await api.exportCsv("customers", null, null, dest)}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Clientes"
        subtitle="Tu directorio de clientes con lo que han comprado y lo que deben."
        actions={
          <>
            {isDesktop() && (
              <Button icon={<Download size={16} />} onClick={exportCsv}>
                Exportar
              </Button>
            )}
            {canEdit && (
              <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setEditing("new")}>
                Nuevo cliente
              </Button>
            )}
          </>
        }
      />
      <div className="card">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Nombre, documento o teléfono…" />
          <div style={{ marginLeft: "auto" }}>
            <Switch checked={showArchived} onChange={setShowArchived} label="Mostrar archivados" />
          </div>
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
            icon={<Users size={24} />}
            title={search ? "Ningún cliente coincide" : "Agrega tu primer cliente"}
            text={search ? "Prueba con otro nombre o documento." : "Guarda sus datos una vez y úsalos en todas tus facturas y cotizaciones."}
            action={
              !search && canEdit ? (
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Nuevo cliente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Contacto</th>
                  <th className="t-right">Facturas</th>
                  <th className="t-right">Total comprado</th>
                  <th className="t-right">Saldo pendiente</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((c) => (
                  <tr key={c.id} className={`is-clickable ${c.isActive ? "" : "is-muted"}`} onClick={() => setEditing(c)}>
                    <td>
                      <div className="cell-flex">
                        <div className="sb-avatar" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
                          {initials(c.name)}
                        </div>
                        <div>
                          <div className="cell-main">
                            {c.name} {!c.isActive && <Badge dot={false}>Archivado</Badge>}
                          </div>
                          <div className="cell-sub">{c.documentId ?? "Sin documento"}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div>{c.phone ?? <span className="subtle">—</span>}</div>
                      <div className="cell-sub">{c.email}</div>
                    </td>
                    <td className="t-right num">{c.invoiceCount}</td>
                    <td className="t-right money">{money(c.totalInvoiced)}</td>
                    <td className="t-right money">{c.balanceDue > 0 ? <span className="badge badge-warning">{money(c.balanceDue)}</span> : <span className="subtle">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <CustomerDrawer
          customer={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          navigate={navigate}
          onSaved={(c, msg) => {
            toast(msg);
            void reload();
            setEditing(c);
          }}
        />
      )}
    </div>
  );
}

function CustomerDrawer({
  customer,
  onClose,
  onSaved,
  navigate,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (c: Customer, msg: string) => void;
  navigate: PageProps["navigate"];
}) {
  const access = useAccess();
  const [form, setForm] = useState<CustomerInput>({
    id: customer?.id ?? null,
    name: customer?.name ?? "",
    documentId: customer?.documentId ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    notes: customer?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);

  useEffect(() => {
    if (customer) api.listInvoices({ customerId: customer.id, limit: 10 }).then(setInvoices).catch(() => setInvoices([]));
  }, [customer]);

  const set = (k: keyof CustomerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveCustomer(form);
      onSaved(saved, customer ? "Cliente actualizado" : "Cliente creado");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!customer) return;
    try {
      const c = await api.setCustomerActive(customer.id, !customer.isActive);
      onSaved(c, c.isActive ? "Cliente activado" : "Cliente archivado");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Drawer
      readOnly={!access.canWrite("customers")}
      title={customer ? customer.name : "Nuevo cliente"}
      subtitle={customer ? `Cliente desde ${fmtDate(customer.createdAt.slice(0, 10))}` : "Los campos opcionales se pueden completar después."}
      onClose={onClose}
      footer={
        <>
          {customer && (
            <Button variant="ghost" icon={customer.isActive ? <Archive size={16} /> : <ArchiveRestore size={16} />} onClick={toggleActive} style={{ marginRight: "auto" }}>
              {customer.isActive ? "Archivar" : "Activar"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        {customer && (
          <div className="grid grid-3" style={{ gap: 10 }}>
            <div className="card stat" style={{ padding: 12 }}>
              <span className="stat-label">Facturas</span>
              <span className="stat-value" style={{ fontSize: 20 }}>
                {customer.invoiceCount}
              </span>
            </div>
            <div className="card stat" style={{ padding: 12 }}>
              <span className="stat-label">Comprado</span>
              <span className="stat-value" style={{ fontSize: 18 }}>
                {money(customer.totalInvoiced)}
              </span>
            </div>
            <div className="card stat" style={{ padding: 12 }}>
              <span className="stat-label">Debe</span>
              <span className={`stat-value ${customer.balanceDue > 0 ? "profit-negative" : ""}`} style={{ fontSize: 18 }}>
                {money(customer.balanceDue)}
              </span>
            </div>
          </div>
        )}

        <div className="form-grid">
          <Field label="Nombre o razón social" className="span-all" error={error && !form.name.trim() ? error : null}>
            <input className="input" value={form.name} onChange={set("name")} autoFocus={!customer} />
          </Field>
          <Field label="Cédula / NIT" optional>
            <input className="input" value={form.documentId ?? ""} onChange={set("documentId")} />
          </Field>
          <Field label="Teléfono" optional>
            <input className="input" value={form.phone ?? ""} onChange={set("phone")} />
          </Field>
          <Field label="Correo" optional className="span-all">
            <input className="input" value={form.email ?? ""} onChange={set("email")} />
          </Field>
          <Field label="Dirección" optional className="span-all">
            <input className="input" value={form.address ?? ""} onChange={set("address")} />
          </Field>
          <Field label="Notas internas" optional className="span-all">
            <textarea className="textarea" rows={3} value={form.notes ?? ""} onChange={set("notes")} />
          </Field>
        </div>
        {error && form.name.trim() && <Alert tone="danger">{error}</Alert>}

        {customer && (
          <div>
            <div className="row-between mb-16">
              <div className="card-title">Últimas facturas</div>
              {access.canWrite("invoices") && (
                <Button size="sm" icon={<FilePlus2 size={14} />} onClick={() => navigate({ page: "invoice-new", customerId: customer.id })}>
                  Facturar a este cliente
                </Button>
              )}
            </div>
            {invoices === null ? (
              <SkeletonRows rows={2} />
            ) : invoices.length === 0 ? (
              <p className="subtle">Todavía no tiene facturas.</p>
            ) : (
              <div className="card list">
                {invoices.map((i) => (
                  <div className="list-item is-clickable" key={i.id} onClick={() => navigate({ page: "invoice", id: i.id })}>
                    <div className="list-item-main">
                      <div className="cell-main">{i.number}</div>
                      <div className="cell-sub">{fmtDate(i.issueDate)}</div>
                    </div>
                    <InvoiceStatusBadge status={i.status} overdue={isOverdue(i.dueDate, i.balance, i.status)} />
                    <span className="money">{money(i.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
