import { useState } from "react";
import { Download, Pencil, Plus, Receipt, ShoppingCart, Tags, Trash2 } from "lucide-react";
import type { Category, Expense, ExpenseInput, PaymentMethod } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api, isDesktop, pickSavePath } from "../services/systemClient";
import { useAccess } from "../lib/access";
import { useAsync, useDebounced, useShowMore } from "../lib/hooks";
import { errorMessage, fmtDate, METHOD_LABELS, money, monthStart, todayISO } from "../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Drawer, EmptyState, Field, IconButton, MoneyInput, PageHeader, SearchBox, Segmented, SkeletonRows, useToast, ShowMore } from "../components/ui";
import { CategoryManager } from "../components/categories";
import { Period, PeriodPicker, periodRange } from "./Finance";

export function ExpensesPage(_props: PageProps) {
  const canEdit = useAccess().canWrite("expenses");
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("month");
  const [custom, setCustom] = useState({ from: monthStart(), to: todayISO() });
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const range = periodRange(period, custom);
  const { data, loading, error, reload } = useAsync(() => api.listExpenses(range.from, range.to, categoryId, q), [range.from, range.to, categoryId, q]);
  const page = useShowMore(data?.length ?? 0, 100, data);
  const cats = useAsync(() => api.listCategories("expense"), []);
  const [editing, setEditing] = useState<Expense | "new" | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [managingCats, setManagingCats] = useState(false);

  const total = (data ?? []).reduce((s, e) => s + e.amount, 0);

  const exportCsv = async () => {
    try {
      const dest = await pickSavePath("Exportar gastos", `gastos_${range.from}_${range.to}.csv`, "csv", "Archivo CSV (Excel)");
      if (!dest) return;
      toast(`Exportado: ${await api.exportCsv("expenses", range.from, range.to, dest)}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Gastos"
        subtitle="Arriendo, servicios públicos, nómina, transporte, compras de mercancía y más."
        actions={
          <>
            {canEdit && (
              <Button icon={<Tags size={16} />} onClick={() => setManagingCats(true)}>
                Categorías
              </Button>
            )}
            {isDesktop() && (
              <Button icon={<Download size={16} />} onClick={exportCsv}>
                Exportar
              </Button>
            )}
            {canEdit && (
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>
                Registrar gasto
              </Button>
            )}
          </>
        }
      />
      <div className="mb-16">
        <PeriodPicker period={period} setPeriod={setPeriod} custom={custom} setCustom={setCustom} />
      </div>
      <div className="card">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Descripción o proveedor…" />
          <select className="select" style={{ width: 240 }} value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todas las categorías</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div style={{ marginLeft: "auto", fontSize: 13 }}>
            Total del periodo: <strong className="money">{money(total)}</strong>
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
            icon={<Receipt size={24} />}
            title="No hay gastos en este periodo"
            text="Registra arriendo, luz, agua, internet, nómina o cualquier pago del negocio para conocer tu ganancia real."
            action={
              canEdit ? (
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Registrar gasto
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th>Categoría</th>
                  <th>Método</th>
                  <th className="t-right">Valor</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.slice(0, page.limit).map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.expenseDate)}</td>
                    <td>
                      <div className="cell-main">
                        {e.kind === "inventory" && <ShoppingCart size={13} style={{ verticalAlign: -2, marginRight: 6, color: "var(--info)" }} />}
                        {e.description}
                      </div>
                      {e.supplier && <div className="cell-sub">{e.supplier}</div>}
                    </td>
                    <td>{e.categoryName ? <Badge dot={false}>{e.categoryName}</Badge> : <span className="subtle">—</span>}</td>
                    <td className="cell-sub">{METHOD_LABELS[e.method]}</td>
                    <td className="t-right money" style={{ fontWeight: 600 }}>
                      {money(e.amount)}
                    </td>
                    <td className="t-right" style={{ whiteSpace: "nowrap" }}>
                      <IconButton label="Editar" onClick={() => setEditing(e)}>
                        <Pencil size={15} />
                      </IconButton>
                      <IconButton label="Eliminar" danger onClick={() => setDeleting(e)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ShowMore remaining={page.remaining} onMore={page.more} />
          </div>
        )}
      </div>

      {editing && (
        <ExpenseDrawer
          expense={editing === "new" ? null : editing}
          categories={cats.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            toast(msg);
            setEditing(null);
            void reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="¿Eliminar este gasto?"
          text={
            deleting.kind === "inventory"
              ? `«${deleting.description}» por ${money(deleting.amount)}. Las existencias del producto no cambian; si la compra no ocurrió, ajústalas en Inventario.`
              : `«${deleting.description}» por ${money(deleting.amount)}. Esta acción no se puede deshacer.`
          }
          confirmLabel="Eliminar"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteExpense(deleting.id);
            toast("Gasto eliminado");
            void reload();
          }}
        />
      )}
      {managingCats && (
        <CategoryManager
          kind="expense"
          onClose={() => setManagingCats(false)}
          onChanged={() => {
            void cats.reload();
            void reload();
          }}
        />
      )}
    </div>
  );
}

function ExpenseDrawer({ expense, categories, onClose, onSaved }: { expense: Expense | null; categories: Category[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [form, setForm] = useState<ExpenseInput>({
    id: expense?.id ?? null,
    categoryId: expense?.categoryId ?? null,
    description: expense?.description ?? "",
    amount: expense?.amount ?? 0,
    expenseDate: expense?.expenseDate ?? todayISO(),
    method: expense?.method ?? "cash",
    supplier: expense?.supplier ?? "",
    note: expense?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!form.description.trim()) {
      setError("Describe el gasto.");
      return;
    }
    if (form.amount <= 0) {
      setError("Escribe el valor del gasto.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.saveExpense(form);
      onSaved(expense ? "Gasto actualizado" : "Gasto registrado");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const quick = categories.filter((c) => c.name !== "Compras de inventario").slice(0, 8);

  return (
    <Drawer
      readOnly={!useAccess().canWrite("expenses")}
      title={expense ? "Editar gasto" : "Registrar gasto"}
      subtitle="Todo lo que sale de la caja del negocio."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        {!expense && (
          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>
              Tipo de gasto
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {quick.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`badge no-dot ${form.categoryId === c.id ? "badge-accent" : ""}`}
                  style={{ height: 30, padding: "0 12px", border: "1px solid var(--border)", cursor: "pointer", fontSize: 12.5 }}
                  onClick={() => setForm({ ...form, categoryId: c.id, description: form.description || c.name.split(" (")[0] })}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="form-grid">
          <Field label="Descripción" className="span-all">
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Arriendo del local – noviembre" autoFocus />
          </Field>
          <Field label="Valor">
            <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} />
          </Field>
          <Field label="Fecha">
            <input type="date" className="input" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
          </Field>
          <Field label="Categoría" optional>
            <select className="select" value={form.categoryId ?? ""} onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Proveedor o beneficiario" optional>
            <input className="input" value={form.supplier ?? ""} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
          </Field>
          <Field label="Método de pago" className="span-all">
            <Segmented<PaymentMethod> value={form.method} onChange={(m) => setForm({ ...form, method: m })} options={(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))} />
          </Field>
          <Field label="Nota" optional className="span-all">
            <textarea className="textarea" rows={2} value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Drawer>
  );
}
