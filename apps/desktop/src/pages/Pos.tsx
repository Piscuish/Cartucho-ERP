/**
 * Punto de venta: cobro rápido en el mostrador.
 *
 * - Izquierda: buscador (también recibe el lector de código de barras) y productos en tarjetas.
 * - Derecha: la venta actual, forma de pago, dinero recibido y cambio.
 * Cada venta se guarda como una factura normal (aparece en Facturas y en el Cierre de caja).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Banknote, Check, CreditCard, HandCoins, Landmark, Minus, Package, Plus, Printer, ScanBarcode, ShoppingCart, Trash2, UserRound, X } from "lucide-react";
import { itemKind, type BusinessSettings, type Customer, type InvoiceDetail, type PaymentMethod, type Product } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAccess } from "../lib/access";
import { findByCode, useBarcodeScanner } from "../lib/barcode";
import { errorMessage, money, parseQty, qty, todayISO } from "../lib/format";
import { Alert, Button, EmptyState, IconButton, Modal, MoneyInput, SearchBox, useToast } from "../components/ui";
import { PrintDialog } from "../components/print";
import { invoiceToPrintable } from "./InvoiceDetail";

interface CartLine {
  productId: number;
  name: string;
  unitPrice: number;
  quantityText: string;
}

type PayKind = PaymentMethod | "credit";

/** La venta en curso se conserva si sales del punto de venta y vuelves. */
let savedCart: { lines: CartLine[]; customerId: number | null } = { lines: [], customerId: null };

const fmtQtyText = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

const PAY_OPTIONS: { id: PayKind; label: string; icon: typeof Banknote }[] = [
  { id: "cash", label: "Efectivo", icon: Banknote },
  { id: "transfer", label: "Transferencia", icon: Landmark },
  { id: "card", label: "Tarjeta", icon: CreditCard },
  { id: "credit", label: "Fiado", icon: HandCoins },
];

/** Billetes con los que suele pagar el cliente, por encima del total. */
function quickAmounts(total: number): number[] {
  const out = new Set<number>();
  for (const bill of [2000, 5000, 10000, 20000, 50000, 100000]) {
    const v = Math.ceil(total / bill) * bill;
    if (v > total) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 3);
}

export function PosPage({ navigate, overview }: PageProps) {
  const toast = useToast();
  const access = useAccess();
  const useCustomers = access.can("customers");
  const showStock = access.can("inventory");
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lines, setLines] = useState<CartLine[]>(savedCart.lines);
  const [customerId, setCustomerId] = useState<number | null>(savedCart.customerId);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [pay, setPay] = useState<PayKind>("cash");
  const [received, setReceived] = useState(0);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ invoice: InvoiceDetail; change: number } | null>(null);
  const [printing, setPrinting] = useState<InvoiceDetail | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const loadProducts = () =>
    api
      .listProducts()
      .then((p) => setProducts(p.filter((x) => x.isActive)))
      .catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    api.getBusinessSettings().then(setSettings).catch(() => undefined);
    void loadProducts();
    if (useCustomers) api.listCustomers().then((c) => setCustomers(c.filter((x) => x.isActive))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    savedCart = { lines, customerId };
  }, [lines, customerId]);
  useEffect(() => setError(null), [customerId, pay]);

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);
  const computed = lines.map((l) => {
    const q = parseQty(l.quantityText);
    return { ...l, quantity: q, total: Math.round(q * l.unitPrice) };
  });
  const total = computed.reduce((s, l) => s + l.total, 0);
  const units = computed.reduce((s, l) => s + (l.quantity > 0 ? l.quantity : 0), 0);
  const change = pay === "cash" && received > 0 ? received - total : 0;
  const inCart = useMemo(() => new Map(computed.map((l) => [l.productId, l.quantity])), [computed]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    (products ?? []).forEach((p) => p.categoryName && set.add(p.categoryName));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const q = search.trim().toLowerCase();
  const visible = (products ?? []).filter(
    (p) =>
      (!category || p.categoryName === category) &&
      (!q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q) || (p.barcode ?? "").toLowerCase().includes(q)),
  );

  const add = (p: Product) => {
    setError(null);
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, quantityText: fmtQtyText(parseQty(l.quantityText) + 1) } : l));
      return [...ls, { productId: p.id, name: p.name, unitPrice: p.price, quantityText: "1" }];
    });
    setFlash(p.id);
    setTimeout(() => setFlash((f) => (f === p.id ? null : f)), 450);
  };
  const update = (id: number, patch: Partial<CartLine>) => setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, ...patch } : l)));
  const step = (id: number, delta: number) =>
    setLines((ls) => ls.flatMap((l) => {
      if (l.productId !== id) return [l];
      const n = parseQty(l.quantityText) + delta;
      return n <= 0 ? [] : [{ ...l, quantityText: fmtQtyText(n) }];
    }));
  const remove = (id: number) => setLines((ls) => ls.filter((l) => l.productId !== id));
  const clear = () => {
    setLines([]);
    setCustomerId(null);
    setReceived(0);
    setPay("cash");
    setError(null);
  };

  const scan = (code: string) => {
    const p = findByCode(products ?? [], code);
    if (p) add(p);
    else toast(`No hay ningún producto con el código ${code}`, "error");
  };
  // Lector con el foco fuera del buscador (por ejemplo, después de tocar un botón).
  useBarcodeScanner(scan, !done && !printing && !pickingCustomer);

  const charge = async () => {
    setError(null);
    if (computed.length === 0) return setError("Agrega al menos un producto.");
    if (computed.some((l) => !(l.quantity > 0))) return setError("Revisa las cantidades: deben ser mayores a cero.");
    if (pay === "credit" && !customer) return setError("Para vender fiado elige primero el cliente.");
    if (pay === "cash" && received > 0 && received < total) return setError(`El dinero recibido no alcanza: faltan ${money(total - received)}.`);
    setBusy(true);
    try {
      const inv = await api.createInvoice({
        customerId: customer?.id ?? null,
        customer: customer ? null : { name: "" },
        issueDate: todayISO(),
        dueDate: null,
        lines: computed.map((l) => ({ productId: l.productId, description: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
        notes: settings?.defaultNotes ?? null,
        terms: settings?.defaultTerms ?? null,
        footer: settings?.defaultFooter ?? null,
        initialPayment: pay === "credit" || total === 0 ? null : { amount: total, method: pay, paidAt: todayISO() },
      });
      setDone({ invoice: inv, change: pay === "cash" && received > total ? received - total : 0 });
      clear();
      setSearch("");
      void loadProducts();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const newSale = () => {
    setDone(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  return (
    <div className="pos">
      {/* Productos */}
      <section className="pos-catalog">
        <div className="input-group pos-search">
          <ScanBarcode size={18} />
          <input
            ref={searchRef}
            className="input"
            autoFocus
            placeholder="Buscar producto o escanear código de barras…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const exact = findByCode(products ?? [], search);
              if (exact) {
                add(exact);
                setSearch("");
              } else if (visible.length === 1) {
                add(visible[0]);
                setSearch("");
              } else if (search.trim() && visible.length === 0) toast(`No hay ningún producto con «${search.trim()}»`, "error");
            }}
          />
          {search && (
            <IconButton label="Limpiar" onClick={() => setSearch("")}>
              <X size={16} />
            </IconButton>
          )}
        </div>
        {categories.length > 0 && (
          <div className="chip-row">
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
        <div className="pos-grid-wrap">
          {products === null ? (
            <div className="subtle" style={{ padding: 24 }}>
              Cargando productos…
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              icon={<Package size={24} />}
              title="Tu catálogo está vacío"
              text="Crea tus productos para venderlos aquí."
              action={<Button variant="primary" onClick={() => navigate({ page: "catalog" })}>Ir al catálogo</Button>}
            />
          ) : visible.length === 0 ? (
            <EmptyState icon={<Package size={24} />} title="Sin resultados" text="Prueba con otro nombre o código." />
          ) : (
            <div className="pick-grid pos-grid">
              {visible.map((p) => {
                const count = inCart.get(p.id) ?? 0;
                const out = showStock && p.trackStock && p.stockQty <= 0;
                return (
                  <button key={p.id} className={`pick-card ${count > 0 ? "is-in" : ""} ${flash === p.id ? "is-flash" : ""}`} onClick={() => add(p)}>
                    <div className="pick-media">
                      {p.imageDataUrl ? <img src={p.imageDataUrl} alt="" /> : <span className="pos-initial">{p.name.slice(0, 1).toUpperCase()}</span>}
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
        </div>
      </section>

      {/* Venta actual */}
      <aside className="pos-ticket">
        <div className="pos-ticket-head">
          <div>
            <div className="pos-ticket-title">Venta actual</div>
            <div className="cell-sub">{lines.length === 0 ? "Sin productos" : `${qty(units)} ${units === 1 ? "unidad" : "unidades"}`}</div>
          </div>
          {lines.length > 0 && (
            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={clear}>
              Vaciar
            </Button>
          )}
        </div>

        {useCustomers && (
          <button className="pos-customer" onClick={() => setPickingCustomer(true)}>
            <UserRound size={16} />
            <span className="pos-customer-name">{customer ? customer.name : "Consumidor final"}</span>
            {customer && customer.balanceDue > 0 && <span className="badge badge-warning no-dot">Debe {money(customer.balanceDue)}</span>}
            <span className="pos-customer-change">Cambiar</span>
          </button>
        )}

        <div className="pos-lines">
          {computed.length === 0 ? (
            <div className="pos-empty">
              <ShoppingCart size={28} />
              <div>Toca un producto o escanea su código para empezar.</div>
            </div>
          ) : (
            computed.map((l) => {
              const prod = productById.get(l.productId);
              const short = showStock && prod?.trackStock && l.quantity > prod.stockQty;
              return (
                <div key={l.productId} className="pos-line">
                  <div className="pos-line-info">
                    <div className="pos-line-name">{l.name}</div>
                    <div className="cell-sub">
                      {money(l.unitPrice)}
                      {short && <span className="item-warn">Quedan {qty(prod!.stockQty)}</span>}
                    </div>
                  </div>
                  <div className="qty-stepper is-sm">
                    <button aria-label="Menos" onClick={() => step(l.productId, -1)}>
                      <Minus size={13} />
                    </button>
                    <input inputMode="decimal" value={l.quantityText} onChange={(e) => update(l.productId, { quantityText: e.target.value })} onFocus={(e) => e.currentTarget.select()} aria-label="Cantidad" />
                    <button aria-label="Más" onClick={() => step(l.productId, 1)}>
                      <Plus size={13} />
                    </button>
                  </div>
                  <div className="pos-line-total money">{money(l.total)}</div>
                  <IconButton label="Quitar" danger onClick={() => remove(l.productId)}>
                    <X size={15} />
                  </IconButton>
                </div>
              );
            })
          )}
        </div>

        <div className="pos-pay">
          <div className="pos-total">
            <span>Total</span>
            <span className="money">{money(total)}</span>
          </div>

          <div className="pos-methods">
            {PAY_OPTIONS.filter((o) => o.id !== "credit" || useCustomers).map((o) => (
              <button key={o.id} className={`pos-method ${pay === o.id ? "is-active" : ""}`} onClick={() => setPay(o.id)}>
                <o.icon size={16} />
                {o.label}
              </button>
            ))}
          </div>

          {pay === "cash" && (
            <div className="pos-cash">
              <div className="pos-cash-row">
                <label className="pos-cash-label" htmlFor="pos-received">
                  Recibido
                </label>
                <MoneyInput
                  id="pos-received"
                  value={received}
                  onChange={setReceived}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) {
                      e.preventDefault();
                      void charge();
                    }
                  }}
                />
              </div>
              {total > 0 && (
                <div className="chip-row">
                  <button className={`chip ${received === total ? "is-active" : ""}`} onClick={() => setReceived(total)}>
                    Exacto
                  </button>
                  {quickAmounts(total).map((v) => (
                    <button key={v} className={`chip ${received === v ? "is-active" : ""}`} onClick={() => setReceived(v)}>
                      {money(v)}
                    </button>
                  ))}
                </div>
              )}
              <div className={`pos-change ${change < 0 ? "is-short" : ""}`}>
                <span>{change < 0 ? "Falta" : "Cambio"}</span>
                <span className="money">{money(Math.abs(change))}</span>
              </div>
            </div>
          )}
          {pay === "credit" && (
            <div className="subtle" style={{ fontSize: 12.5 }}>
              {customer ? `Queda como saldo pendiente de ${customer.name}.` : "Elige el cliente al que le vas a fiar."}
            </div>
          )}

          {error && <Alert tone="danger">{error}</Alert>}

          <Button variant="primary" size="lg" block loading={busy} disabled={lines.length === 0} onClick={() => void charge()}>
            {pay === "credit" ? "Registrar venta fiada" : `Cobrar ${money(total)}`}
          </Button>
        </div>
      </aside>

      {pickingCustomer && (
        <CustomerPicker
          customers={customers}
          selected={customerId}
          onPick={(id) => {
            setCustomerId(id);
            setPickingCustomer(false);
          }}
          onClose={() => setPickingCustomer(false)}
        />
      )}

      {done && (
        <Modal
          onClose={newSale}
          footer={
            <>
              <Button variant="ghost" onClick={() => navigate({ page: "invoice", id: done.invoice.id })}>
                Ver factura
              </Button>
              <Button icon={<Printer size={16} />} onClick={() => setPrinting(done.invoice)} disabled={!settings || !overview.company}>
                Imprimir
              </Button>
              <Button variant="primary" autoFocus onClick={newSale}>
                Nueva venta
              </Button>
            </>
          }
        >
          <div className="pos-done">
            <div className="pos-done-icon">
              <Check size={28} />
            </div>
            <div className="modal-title">Venta registrada</div>
            <div className="subtle">
              Factura {done.invoice.number} · {money(done.invoice.total)}
              {done.invoice.balance > 0 ? " · fiada" : ""}
            </div>
            {done.change > 0 && (
              <div className="pos-done-change">
                <span>Cambio</span>
                <strong className="money">{money(done.change)}</strong>
              </div>
            )}
          </div>
        </Modal>
      )}

      {printing && settings && overview.company && (
        <PrintDialog doc={invoiceToPrintable(printing)} company={overview.company} settings={settings} onClose={() => setPrinting(null)} />
      )}
    </div>
  );
}

function CustomerPicker({ customers, selected, onPick, onClose }: { customers: Customer[]; selected: number | null; onPick: (id: number | null) => void; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.documentId ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q)).slice(0, 50);
  return (
    <Modal onClose={onClose}>
      <div className="modal-title mb-16">Cliente de la venta</div>
      <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nombre, cédula o teléfono…" autoFocus />
      <div className="pos-customer-list">
        <button className={`pos-customer-opt ${selected === null ? "is-active" : ""}`} onClick={() => onPick(null)}>
          <span className="cell-main">Consumidor final</span>
          <span className="cell-sub">Venta sin datos del cliente</span>
        </button>
        {list.map((c) => (
          <button key={c.id} className={`pos-customer-opt ${selected === c.id ? "is-active" : ""}`} onClick={() => onPick(c.id)}>
            <span className="cell-main">{c.name}</span>
            <span className="cell-sub">{[c.documentId, c.phone].filter(Boolean).join(" · ") || "Cliente guardado"}</span>
          </button>
        ))}
        {list.length === 0 && <div className="subtle" style={{ padding: 12 }}>No hay clientes con ese nombre.</div>}
      </div>
    </Modal>
  );
}
