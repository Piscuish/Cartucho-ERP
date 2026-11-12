/**
 * Menú para agregar productos o servicios a una factura o cotización.
 * - «Catálogo»: cuadrícula con todos los productos; un clic los agrega.
 * - «Personalizado»: un ítem libre solo para esta venta (no se guarda en el catálogo).
 */
import { useMemo, useState } from "react";
import { Check, Package, PencilLine, Plus, Search } from "lucide-react";
import { itemKind, type Product } from "@cartucho/shared";
import { money, parseQty, qty } from "../lib/format";
import { findByCode } from "../lib/barcode";
import { Button, Field, Modal, MoneyInput, Segmented } from "./ui";

export interface CustomItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export function ProductPickerModal({
  products,
  catalogEnabled = true,
  showStock = true,
  inCart,
  onAddProduct,
  onAddCustom,
  onClose,
  onGoToCatalog,
}: {
  products: Product[];
  /** Sin módulo de catálogo solo se ofrecen ítems personalizados. */
  catalogEnabled?: boolean;
  /** Sin módulo de inventario no se muestran existencias. */
  showStock?: boolean;
  /** Cantidad ya agregada por producto (para marcar las tarjetas). */
  inCart: Map<number, number>;
  onAddProduct: (p: Product) => void;
  onAddCustom: (item: CustomItem) => void;
  onClose: () => void;
  onGoToCatalog: () => void;
}) {
  const [tab, setTab] = useState<"catalog" | "custom">(catalogEnabled && products.length ? "catalog" : "custom");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  const [added, setAdded] = useState(0);
  const [flash, setFlash] = useState<number | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.categoryName && set.add(p.categoryName));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const q = search.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      (!category || p.categoryName === category) &&
      (!q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q)),
  );

  const add = (p: Product) => {
    onAddProduct(p);
    setAdded((n) => n + 1);
    setFlash(p.id);
    setTimeout(() => setFlash((f) => (f === p.id ? null : f)), 450);
  };

  return (
    <Modal
      large
      onClose={onClose}
      footer={
        <>
          <span className="subtle" style={{ marginRight: "auto", fontSize: 13 }}>
            {added > 0 ? `${added} ${added === 1 ? "agregado" : "agregados"}` : catalogEnabled ? "Toca un producto para agregarlo" : ""}
          </span>
          <Button variant="primary" onClick={onClose}>
            Listo
          </Button>
        </>
      }
    >
      <div className="row-between mb-16">
        <div className="modal-title">Agregar producto o servicio</div>
        {catalogEnabled && (
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "catalog", label: <><Package size={14} /> Catálogo</> },
            { value: "custom", label: <><PencilLine size={14} /> Personalizado</> },
          ]}
        />
        )}
      </div>

      {tab === "catalog" ? (
        <>
          <div className="input-group mb-16">
            <Search size={16} />
            <input
              className="input"
              autoFocus
              placeholder="Buscar o escanear código de barras…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                // Código exacto (lector de código de barras): se agrega y se limpia para el siguiente.
                const exact = findByCode(products, search);
                if (exact) {
                  add(exact);
                  setSearch("");
                } else if (visible[0]) add(visible[0]);
              }}
            />
          </div>
          {categories.length > 0 && (
            <div className="chip-row mb-16">
              <button className={`chip ${category === "" ? "is-active" : ""}`} onClick={() => setCategory("")}>
                Todos
              </button>
              {categories.map((c) => (
                <button key={c} className={`chip ${category === c ? "is-active" : ""}`} onClick={() => setCategory(c)}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {products.length === 0 ? (
            <div className="empty" style={{ padding: "40px 16px" }}>
              <div className="empty-icon">
                <Package size={24} />
              </div>
              <div className="empty-title">Tu catálogo está vacío</div>
              <p className="empty-text">Agrega un ítem personalizado para esta venta o crea tus productos en el catálogo.</p>
              <div className="row">
                <Button onClick={onGoToCatalog}>Ir al catálogo</Button>
                <Button variant="primary" onClick={() => setTab("custom")}>
                  Personalizado
                </Button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty" style={{ padding: "40px 16px" }}>
              <div className="empty-title">Sin resultados</div>
              <p className="empty-text">¿No está en tu catálogo? Agrégalo como personalizado.</p>
              <Button variant="primary" onClick={() => setTab("custom")}>
                Crear personalizado
              </Button>
            </div>
          ) : (
            <div className="pick-grid">
              {visible.map((p) => {
                const count = inCart.get(p.id) ?? 0;
                const out = showStock && p.trackStock && p.stockQty <= 0;
                return (
                  <button key={p.id} className={`pick-card ${count > 0 ? "is-in" : ""} ${flash === p.id ? "is-flash" : ""}`} onClick={() => add(p)}>
                    <div className="pick-media">
                      {p.imageDataUrl ? <img src={p.imageDataUrl} alt="" /> : <Package size={26} />}
                      {count > 0 && (
                        <span className="pick-count">
                          <Check size={12} /> {qty(count)}
                        </span>
                      )}
                    </div>
                    <div className="pick-body">
                      <div className="pick-name">{p.name}</div>
                      <div className="row-between">
                        <span className="pick-price">{money(p.price)}</span>
                        <span className={`pick-stock ${out ? "is-out" : p.isLowStock ? "is-low" : ""}`}>
                          {!showStock ? p.unit : p.trackStock ? (out ? "Agotado" : `${qty(p.stockQty)} ${p.unit}`) : itemKind(p) === "service" ? "Servicio" : "Sin límite"}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <CustomItemForm
          initialName={search}
          onAdd={(item) => {
            onAddCustom(item);
            setAdded((n) => n + 1);
          }}
        />
      )}
    </Modal>
  );
}

function CustomItemForm({ initialName, onAdd }: { initialName: string; onAdd: (i: CustomItem) => void }) {
  const [description, setDescription] = useState(initialName);
  const [qtyText, setQtyText] = useState("1");
  const [price, setPrice] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = () => {
    const quantity = parseQty(qtyText);
    if (!description.trim()) return setError("Escribe qué estás vendiendo.");
    if (!(quantity > 0)) return setError("La cantidad debe ser mayor a cero.");
    onAdd({ description: description.trim(), quantity, unitPrice: price });
    setDescription("");
    setQtyText("1");
    setPrice(0);
    setError(null);
    setDone(true);
    setTimeout(() => setDone(false), 1600);
  };

  return (
    <form
      className="custom-item"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="muted" style={{ fontSize: 13 }}>
        Solo para esta venta. No se guarda en el catálogo ni afecta el inventario.
      </p>
      <Field label="¿Qué vendes?" error={error}>
        <input className="input" autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej.: Instalación, envío, trabajo especial…" />
      </Field>
      <div className="form-grid">
        <Field label="Cantidad">
          <input className="input num" inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </Field>
        <Field label="Precio unitario">
          <MoneyInput value={price} onChange={setPrice} />
        </Field>
      </div>
      <div className="row-between">
        <span className="money" style={{ fontSize: 18, fontWeight: 650 }}>
          {money(Math.round(parseQty(qtyText) * price))}
        </span>
        <Button type="submit" variant="primary" icon={done ? <Check size={16} /> : <Plus size={16} />}>
          {done ? "Agregado" : "Agregar a la venta"}
        </Button>
      </div>
    </form>
  );
}
