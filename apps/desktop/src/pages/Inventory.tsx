import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, Boxes, ClipboardCheck, Coins, Package, PackageX } from "lucide-react";
import type { InventoryMovement, MovementKind, PaymentMethod, Product } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAsync, useDebounced } from "../lib/hooks";
import { errorMessage, fmtDateTime, METHOD_LABELS, money, parseQty, qty, todayISO } from "../lib/format";
import { Alert, Badge, Button, Drawer, EmptyState, Field, MoneyInput, PageHeader, SearchBox, Segmented, SkeletonRows, StatCard, Switch, useToast } from "../components/ui";
import { stockBadge } from "./Catalog";

const MOVEMENT_LABEL: Record<MovementKind, { label: string; tone: string }> = {
  initial: { label: "Inicial", tone: "neutral" },
  purchase: { label: "Compra", tone: "success" },
  adjustment: { label: "Ajuste", tone: "info" },
  sale: { label: "Venta", tone: "accent" },
  void_return: { label: "Anulación", tone: "warning" },
};

export function InventoryPage({ navigate }: PageProps) {
  const toast = useToast();
  const [tab, setTab] = useState<"stock" | "movements">("stock");
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const q = useDebounced(search);
  const products = useAsync(() => api.listProducts({ search: q, onlyLowStock: onlyLow }), [q, onlyLow]);
  const movements = useAsync(() => (tab === "movements" ? api.listMovements(null, 300) : Promise.resolve([] as InventoryMovement[])), [tab]);
  const [adjusting, setAdjusting] = useState<{ product: Product; mode: "purchase" | "adjustment" } | null>(null);

  const tracked = useMemo(() => (products.data ?? []).filter((p) => p.trackStock), [products.data]);
  const stats = useMemo(() => {
    const all = tracked;
    return {
      count: all.length,
      value: all.reduce((s, p) => s + Math.max(0, p.stockQty) * p.cost, 0),
      low: all.filter((p) => p.isLowStock && p.stockQty > 0).length,
      out: all.filter((p) => p.stockQty <= 0).length,
    };
  }, [tracked]);

  return (
    <div className="page">
      <PageHeader
        title="Inventario"
        subtitle="Existencias, compras de mercancía y ajustes por conteo."
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "stock", label: "Existencias" },
              { value: "movements", label: "Movimientos" },
            ]}
          />
        }
      />

      {tab === "stock" ? (
        <>
          <div className="grid grid-4 mb-16">
            <StatCard label="Productos con inventario" value={stats.count} icon={<Boxes size={18} />} />
            <StatCard label="Valor a costo" value={money(Math.round(stats.value))} icon={<Coins size={18} />} tone="success" />
            <StatCard label="Stock bajo" value={stats.low} icon={<AlertTriangle size={18} />} tone="warning" />
            <StatCard label="Agotados" value={stats.out} icon={<PackageX size={18} />} tone="danger" />
          </div>
          <div className="card">
            <div className="toolbar">
              <SearchBox value={search} onChange={setSearch} placeholder="Buscar producto…" />
              <Switch checked={onlyLow} onChange={setOnlyLow} label="Solo stock bajo" />
            </div>
            {products.error && (
              <div style={{ padding: 16 }}>
                <Alert tone="danger">{products.error}</Alert>
              </div>
            )}
            {products.loading && !products.data ? (
              <SkeletonRows />
            ) : tracked.length === 0 ? (
              <EmptyState
                icon={<Package size={24} />}
                title={onlyLow ? "Ningún producto con stock bajo" : "Aún no hay productos con inventario"}
                text={onlyLow ? "Todo está por encima de su mínimo." : "Crea productos en el catálogo y activa «Controlar inventario»."}
                action={
                  !onlyLow ? (
                    <Button variant="primary" onClick={() => navigate({ page: "catalog" })}>
                      Ir al catálogo
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Existencia</th>
                      <th className="t-right">Mínimo</th>
                      <th className="t-right">Costo unit.</th>
                      <th className="t-right">Valor</th>
                      <th className="t-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tracked.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <div className="cell-flex">
                            <div className="thumb">{p.imageDataUrl ? <img src={p.imageDataUrl} alt="" /> : <Package size={16} />}</div>
                            <div>
                              <div className="cell-main">{p.name}</div>
                              <div className="cell-sub">{p.sku ?? p.categoryName ?? ""}</div>
                            </div>
                          </div>
                        </td>
                        <td>{stockBadge(p)}</td>
                        <td className="t-right num">{qty(p.minStock)}</td>
                        <td className="t-right money">{money(p.cost)}</td>
                        <td className="t-right money">{money(Math.round(Math.max(0, p.stockQty) * p.cost))}</td>
                        <td className="t-right">
                          <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                            <Button size="sm" icon={<ArrowDownToLine size={14} />} onClick={() => setAdjusting({ product: p, mode: "purchase" })}>
                              Compra
                            </Button>
                            <Button size="sm" variant="ghost" icon={<ClipboardCheck size={14} />} onClick={() => setAdjusting({ product: p, mode: "adjustment" })}>
                              Ajustar
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card">
          {movements.loading && !movements.data ? (
            <SkeletonRows rows={8} />
          ) : (movements.data ?? []).length === 0 ? (
            <EmptyState icon={<Boxes size={24} />} title="Sin movimientos todavía" text="Aquí verás cada venta, compra, ajuste y anulación que cambie tus existencias." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Tipo</th>
                    <th className="t-right">Cantidad</th>
                    <th className="t-right">Queda</th>
                    <th>Referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.data?.map((m) => (
                    <tr key={m.id} className={m.referenceType === "invoice" && m.referenceId ? "is-clickable" : ""} onClick={() => m.referenceType === "invoice" && m.referenceId && navigate({ page: "invoice", id: m.referenceId })}>
                      <td className="cell-sub" style={{ whiteSpace: "nowrap" }}>
                        {fmtDateTime(m.createdAt)}
                      </td>
                      <td className="cell-main">{m.productName}</td>
                      <td>
                        <Badge tone={MOVEMENT_LABEL[m.kind].tone}>{MOVEMENT_LABEL[m.kind].label}</Badge>
                      </td>
                      <td className="t-right num" style={{ color: m.quantity >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                        {m.quantity > 0 ? "+" : ""}
                        {qty(m.quantity)}
                      </td>
                      <td className="t-right num">{qty(m.stockAfter)}</td>
                      <td className="cell-sub">{m.referenceLabel ?? m.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {adjusting && (
        <StockDrawer
          product={adjusting.product}
          initialMode={adjusting.mode}
          onClose={() => setAdjusting(null)}
          onSaved={(msg) => {
            toast(msg);
            setAdjusting(null);
            void products.reload();
          }}
        />
      )}
    </div>
  );
}

function StockDrawer({ product, initialMode, onClose, onSaved }: { product: Product; initialMode: "purchase" | "adjustment"; onClose: () => void; onSaved: (msg: string) => void }) {
  const [mode, setMode] = useState(initialMode);
  const [qtyText, setQtyText] = useState(initialMode === "adjustment" ? String(product.stockQty) : "");
  const [unitCost, setUnitCost] = useState(product.cost);
  const [recordExpense, setRecordExpense] = useState(true);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quantity = parseQty(qtyText);

  const save = async () => {
    setError(null);
    if (mode === "purchase" && !(quantity > 0)) {
      setError("Escribe cuántas unidades compraste.");
      return;
    }
    if (mode === "adjustment" && !(quantity >= 0)) {
      setError("Escribe la cantidad contada.");
      return;
    }
    setBusy(true);
    try {
      await api.adjustStock({
        productId: product.id,
        kind: mode,
        quantity,
        unitCost: mode === "purchase" ? unitCost : null,
        note,
        recordExpense: mode === "purchase" && recordExpense,
        expenseDate: date,
        method,
        supplier,
      });
      onSaved(mode === "purchase" ? "Compra registrada" : "Inventario ajustado");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={product.name}
      subtitle={`Existencia actual: ${qty(product.stockQty)} ${product.unit}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {mode === "purchase" ? "Registrar compra" : "Guardar ajuste"}
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            setQtyText(m === "adjustment" ? String(product.stockQty) : "");
          }}
          options={[
            { value: "purchase", label: "Compra / entrada" },
            { value: "adjustment", label: "Ajuste por conteo" },
          ]}
        />
        {mode === "purchase" ? (
          <>
            <div className="form-grid">
              <Field label={`Cantidad comprada (${product.unit})`}>
                <input className="input num" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} autoFocus />
              </Field>
              <Field label="Costo unitario">
                <MoneyInput value={unitCost} onChange={setUnitCost} />
              </Field>
            </div>
            {quantity > 0 && (
              <Alert tone="info">
                Quedarán {qty(product.stockQty + quantity)} {product.unit}. Total de la compra: <strong>{money(Math.round(quantity * unitCost))}</strong>
              </Alert>
            )}
            <Switch checked={recordExpense} onChange={setRecordExpense} label="Registrar como gasto" description="Suma esta compra a «Compras de inventario» en Finanzas." />
            {recordExpense && (
              <div className="form-grid">
                <Field label="Fecha de la compra">
                  <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Proveedor" optional>
                  <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                </Field>
                <Field label="Método de pago" className="span-all">
                  <Segmented<PaymentMethod> value={method} onChange={setMethod} options={(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))} />
                </Field>
              </div>
            )}
          </>
        ) : (
          <>
            <Field label={`Cantidad contada (${product.unit})`} hint="Escribe lo que hay físicamente; calculamos la diferencia.">
              <input className="input num" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} autoFocus />
            </Field>
            {qtyText !== "" && quantity !== product.stockQty && (
              <Alert tone={quantity < product.stockQty ? "warning" : "info"}>
                Diferencia: {quantity > product.stockQty ? "+" : ""}
                {qty(quantity - product.stockQty)} {product.unit}
              </Alert>
            )}
          </>
        )}
        <Field label="Nota" optional>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "purchase" ? "Factura del proveedor, lote…" : "Motivo: daño, pérdida, conteo mensual…"} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Drawer>
  );
}
