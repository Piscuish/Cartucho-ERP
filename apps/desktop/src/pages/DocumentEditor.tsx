/**
 * Editor de facturas y cotizaciones (diseño en tarjetas, minimalista).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Minus, Package, PencilLine, Plus, Printer, Save, UserRound, UserPlus, X } from "lucide-react";
import type { BusinessSettings, Customer, PaymentMethod, Product } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { useAccess } from "../lib/access";
import { useHotkey } from "../lib/hooks";
import { addDays, errorMessage, METHOD_LABELS, money, parseQty, qty, todayISO } from "../lib/format";
import { Alert, Button, IconButton, MoneyInput, useToast } from "../components/ui";
import { ProductPickerModal } from "../components/productPicker";

interface DraftLine {
  key: number;
  productId: number | null;
  description: string;
  quantityText: string;
  unitPrice: number;
  /** Descripción adicional de la línea (garantía, referencia…). */
  note: string;
  noteOpen: boolean;
}

let lineSeq = 1;

const fmtQtyText = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");

export function DocumentEditorPage({
  navigate,
  goBack,
  kind,
  customerId,
  source,
}: PageProps & { kind: "invoice" | "quote"; customerId?: number; source?: { kind: "invoice" | "quote"; id: number } }) {
  const toast = useToast();
  const access = useAccess();
  const useCatalog = access.can("catalog");
  const useCustomers = access.can("customers");
  const useStock = access.can("inventory");
  const isInvoice = kind === "invoice";
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [manualCustomer, setManualCustomer] = useState({ name: "", documentId: "", phone: "" });
  const [issueDate, setIssueDate] = useState(todayISO());
  const [secondDate, setSecondDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [footer, setFooter] = useState("");
  const [showTexts, setShowTexts] = useState(false);
  const [payNow, setPayNow] = useState(true);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<"save" | "print" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // Los módulos no incluidos en la licencia no se consultan.
        const [s, p, c] = await Promise.all([
          api.getBusinessSettings(),
          useCatalog ? api.listProducts() : Promise.resolve([] as Product[]),
          useCustomers ? api.listCustomers() : Promise.resolve([] as Customer[]),
        ]);
        setSettings(s);
        setProducts(p);
        setCustomers(c);
        setNotes(s.defaultNotes);
        setTerms(s.defaultTerms);
        setFooter(s.defaultFooter);
        const days = isInvoice ? s.defaultDueDays : s.defaultQuoteValidDays;
        if (days > 0) setSecondDate(addDays(todayISO(), days));
        if (customerId) setCustomer(c.find((x) => x.id === customerId) ?? null);
        if (source) {
          // Duplicar: usa un documento anterior como plantilla (fechas y pagos nuevos).
          const doc = source.kind === "invoice" ? await api.getInvoice(source.id) : await api.getQuote(source.id);
          const linked = doc.customerId ? c.find((x) => x.id === doc.customerId && x.isActive) : undefined;
          if (linked) setCustomer(linked);
          else if (doc.customer.name !== "Consumidor final") {
            setWalkIn(true);
            setManualCustomer({ name: doc.customer.name, documentId: doc.customer.documentId ?? "", phone: doc.customer.phone ?? "" });
          }
          const active = new Set(p.map((x) => x.id));
          setLines(
            doc.lines.map((l) => ({
              key: lineSeq++,
              productId: l.productId && active.has(l.productId) ? l.productId : null,
              description: l.description,
              quantityText: fmtQtyText(l.quantity),
              unitPrice: l.unitPrice,
              note: l.note ?? "",
              noteOpen: !!l.note,
            })),
          );
          setNotes(doc.notes ?? "");
          setTerms(doc.terms ?? "");
          setFooter(doc.footer ?? "");
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, isInvoice]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const computed = useMemo(
    () =>
      lines.map((l) => {
        const q = parseQty(l.quantityText);
        return { ...l, quantity: q, total: Math.round(q * l.unitPrice) };
      }),
    [lines],
  );
  const total = computed.reduce((s, l) => s + l.total, 0);
  const effectivePay = Math.min(payAmount ?? total, total);
  const inCart = useMemo(() => {
    const m = new Map<number, number>();
    computed.forEach((l) => l.productId && m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity));
    return m;
  }, [computed]);

  const updateLine = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: number) => setLines((ls) => ls.filter((l) => l.key !== key));
  const stepQty = (key: number, delta: number) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, quantityText: fmtQtyText(Math.max(1, parseQty(l.quantityText) + delta)) } : l)));

  const addProduct = (p: Product) =>
    setLines((ls) => {
      const existing = ls.find((l) => l.productId === p.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, quantityText: fmtQtyText(parseQty(l.quantityText) + 1) } : l));
      return [...ls, { key: lineSeq++, productId: p.id, description: p.name, quantityText: "1", unitPrice: p.price, note: "", noteOpen: false }];
    });

  const saveRef = useRef<(andPrint: boolean) => Promise<void>>(async () => undefined);
  const save = async (andPrint: boolean) => {
    setError(null);
    if (computed.length === 0) {
      setError("Agrega al menos un producto o servicio.");
      return;
    }
    if (computed.some((l) => !l.description.trim())) {
      setError("Hay un ítem sin nombre.");
      return;
    }
    if (computed.some((l) => !(l.quantity > 0))) {
      setError("Revisa las cantidades: deben ser mayores a cero.");
      return;
    }
    const payload = {
      customerId: customer?.id ?? null,
      customer: customer ? null : { name: walkIn ? manualCustomer.name : "", documentId: walkIn ? manualCustomer.documentId : "", phone: walkIn ? manualCustomer.phone : "" },
      issueDate,
      lines: computed.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, note: l.note.trim() || null })),
      notes,
      terms,
      footer,
    };
    setBusy(andPrint ? "print" : "save");
    try {
      if (isInvoice) {
        const inv = await api.createInvoice({
          ...payload,
          dueDate: secondDate || null,
          initialPayment: payNow && effectivePay > 0 ? { amount: effectivePay, method: payMethod, paidAt: issueDate } : null,
        });
        toast(`Factura ${inv.number} guardada`);
        navigate({ page: "invoice", id: inv.id, print: andPrint });
      } else {
        const q = await api.createQuote({ ...payload, validUntil: secondDate || null });
        toast(`Cotización ${q.number} guardada`);
        navigate({ page: "quote", id: q.id, print: andPrint });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  saveRef.current = save;
  useHotkey((e) => (e.ctrlKey || e.metaKey) && e.key === "Enter", () => {
    if (!busy) void saveRef.current(false);
  });

  const title = isInvoice ? "Nueva factura" : "Nueva cotización";
  const nextNumber = settings
    ? `${isInvoice ? settings.invoicePrefix : settings.quotePrefix}${String(isInvoice ? settings.invoiceNextNumber : settings.quoteNextNumber).padStart(5, "0")}`
    : "";
  const textsCount = [notes, terms, footer].filter((t) => t.trim()).length;

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="ed-header">
        <button className="back-link" onClick={goBack}>
          ← Volver
        </button>
        <div className="row" style={{ gap: 10 }}>
          <h1 style={{ fontSize: 24 }}>{title}</h1>
          {nextNumber && <span className="badge badge-accent no-dot">{nextNumber}</span>}
          {source && <span className="badge no-dot">Copia</span>}
        </div>
      </div>

      <div className="editor">
        <div className="stack-lg">
          {/* Cliente */}
          <section className="ed-card">
            <div className="ed-label">Cliente</div>
            {customer ? (
              <div className="customer-chip">
                <div className="ed-avatar">
                  <UserRound size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-main">{customer.name}</div>
                  <div className="cell-sub">{[customer.documentId, customer.phone].filter(Boolean).join(" · ") || "Cliente guardado"}</div>
                </div>
                {customer.balanceDue > 0 && <span className="badge badge-warning">Debe {money(customer.balanceDue)}</span>}
                <IconButton label="Cambiar cliente" onClick={() => setCustomer(null)}>
                  <X size={16} />
                </IconButton>
              </div>
            ) : walkIn ? (
              <div className="walkin">
                <input className="input" autoFocus placeholder="Nombre" value={manualCustomer.name} onChange={(e) => setManualCustomer({ ...manualCustomer, name: e.target.value })} />
                <input className="input" placeholder="Cédula / NIT" value={manualCustomer.documentId} onChange={(e) => setManualCustomer({ ...manualCustomer, documentId: e.target.value })} />
                <input className="input" placeholder="Teléfono" value={manualCustomer.phone} onChange={(e) => setManualCustomer({ ...manualCustomer, phone: e.target.value })} />
                <IconButton label="Cancelar" onClick={() => setWalkIn(false)}>
                  <X size={16} />
                </IconButton>
              </div>
            ) : (
              <div className="row" style={{ gap: 10 }}>
                <div style={{ flex: 1 }}>
                  {useCustomers ? (
                    <CustomerPicker customers={customers} onPick={setCustomer} />
                  ) : (
                    <div className="cell-main" style={{ padding: "8px 2px" }}>Consumidor final</div>
                  )}
                </div>
                <Button variant="ghost" icon={<UserPlus size={16} />} onClick={() => setWalkIn(true)}>
                  Ocasional
                </Button>
              </div>
            )}
          </section>

          {/* Productos */}
          <section className="ed-card">
            <div className="row-between">
              <div className="ed-label" style={{ margin: 0 }}>
                Productos y servicios
              </div>
              {computed.length > 0 && <span className="subtle" style={{ fontSize: 12.5 }}>{computed.length} {computed.length === 1 ? "ítem" : "ítems"}</span>}
            </div>

            {computed.length === 0 ? (
              <button className="add-item is-empty" onClick={() => setPicking(true)}>
                <span className="add-item-icon">
                  <Plus size={22} />
                </span>
                <span className="add-item-text">Agregar producto/servicio</span>
              </button>
            ) : (
              <>
                <div className="items">
                  {computed.map((l) => {
                    const prod = l.productId ? productById.get(l.productId) : undefined;
                    const short = useStock && prod && prod.trackStock && prod.stockQty < l.quantity;
                    return (
                      <div className="item-row" key={l.key}>
                        <div className="item-thumb">
                          {prod?.imageDataUrl ? <img src={prod.imageDataUrl} alt="" /> : prod ? <Package size={18} /> : <PencilLine size={16} />}
                        </div>
                        <div className="item-main">
                          {prod ? (
                            <div className="item-name">{l.description}</div>
                          ) : (
                            <input className="input-ghost item-name" value={l.description} placeholder="Nombre del ítem" onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                          )}
                          <div className="item-price">
                            <MoneyInput value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: v })} className="input-ghost" aria-label="Precio unitario" />
                            {short ? <span className="item-warn">Quedan {qty(prod.stockQty)}</span> : !prod ? <span className="item-tag">Personalizado</span> : null}
                            {!l.noteOpen && (
                              <button type="button" className="item-note-btn" onClick={() => updateLine(l.key, { noteOpen: true })}>
                                <Plus size={12} /> Agregar descripción
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="qty-stepper">
                          <button aria-label="Menos" onClick={() => stepQty(l.key, -1)}>
                            <Minus size={14} />
                          </button>
                          <input inputMode="decimal" value={l.quantityText} onChange={(e) => updateLine(l.key, { quantityText: e.target.value })} onFocus={(e) => e.currentTarget.select()} aria-label="Cantidad" />
                          <button aria-label="Más" onClick={() => stepQty(l.key, 1)}>
                            <Plus size={14} />
                          </button>
                        </div>
                        <div className="item-total money">{money(l.total)}</div>
                        <IconButton label="Quitar" danger onClick={() => removeLine(l.key)}>
                          <X size={16} />
                        </IconButton>
                        {l.noteOpen && (
                          <div className="item-note">
                            <textarea
                              className="input"
                              rows={2}
                              maxLength={500}
                              autoFocus={!l.note}
                              value={l.note}
                              placeholder="Ej.: Garantía de 6 meses · Serial 12345 · Color negro"
                              aria-label="Descripción adicional"
                              onChange={(e) => updateLine(l.key, { note: e.target.value })}
                            />
                            <IconButton label="Quitar descripción" onClick={() => updateLine(l.key, { note: "", noteOpen: false })}>
                              <X size={14} />
                            </IconButton>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button className="add-item" onClick={() => setPicking(true)}>
                  <Plus size={16} /> Agregar producto/servicio
                </button>
              </>
            )}
          </section>

          {/* Textos opcionales */}
          <section className={`ed-card ed-collapsible ${showTexts ? "is-open" : ""}`}>
            <button className="ed-collapse-head" onClick={() => setShowTexts((v) => !v)}>
              <span className="ed-label" style={{ margin: 0 }}>
                Notas y condiciones
              </span>
              {textsCount > 0 && <span className="subtle" style={{ fontSize: 12.5 }}>{textsCount} con texto</span>}
              <ChevronDown size={16} className="ed-chevron" />
            </button>
            {showTexts && (
              <div className="ed-texts">
                <textarea className="textarea" rows={2} placeholder="Notas (entrega, referencia del pedido…)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <textarea className="textarea" rows={2} placeholder="Condiciones (garantía, formas de pago, cuenta bancaria…)" value={terms} onChange={(e) => setTerms(e.target.value)} />
                <textarea className="textarea" rows={2} placeholder="Pie de página" value={footer} onChange={(e) => setFooter(e.target.value)} />
              </div>
            )}
          </section>
        </div>

        <aside className="editor-side">
          <section className="ed-card">
            <div className="date-tiles">
              <label className="date-tile">
                <span>Fecha</span>
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </label>
              <label className="date-tile">
                <span>{isInvoice ? "Vence" : "Válida hasta"}</span>
                <input type="date" value={secondDate} min={issueDate} onChange={(e) => setSecondDate(e.target.value)} />
              </label>
            </div>
          </section>

          <section className="ed-card total-card">
            <div className="ed-label">Total</div>
            <div className="total-amount money">{money(total)}</div>

            {isInvoice && (
              <>
                <div className="pay-toggle">
                  <button className={payNow ? "is-active" : ""} onClick={() => setPayNow(true)}>
                    Pagado ahora
                  </button>
                  <button className={!payNow ? "is-active" : ""} onClick={() => setPayNow(false)}>
                    Paga después
                  </button>
                </div>
                {payNow && total > 0 && (
                  <div className="stack" style={{ gap: 10 }}>
                    <div className="chip-row">
                      {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => (
                        <button key={m} className={`chip ${payMethod === m ? "is-active" : ""}`} onClick={() => setPayMethod(m)}>
                          {METHOD_LABELS[m]}
                        </button>
                      ))}
                    </div>
                    <MoneyInput value={effectivePay} onChange={(v) => setPayAmount(v)} aria-label="Valor recibido" />
                    {effectivePay < total && (
                      <div className="row-between" style={{ fontSize: 12.5 }}>
                        <span className="subtle">Saldo pendiente {money(total - effectivePay)}</span>
                        <button className="back-link" style={{ margin: 0, fontSize: 12.5 }} onClick={() => setPayAmount(null)}>
                          Pagar todo
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {error && <Alert tone="danger">{error}</Alert>}

          <div className="stack" style={{ gap: 8 }}>
            <Button variant="primary" size="lg" block icon={<Printer size={18} />} loading={busy === "print"} disabled={!!busy} onClick={() => save(true)}>
              Guardar e imprimir
            </Button>
            <Button block icon={<Save size={16} />} loading={busy === "save"} disabled={!!busy} onClick={() => save(false)}>
              Solo guardar
            </Button>
          </div>
        </aside>
      </div>

      {picking && (
        <ProductPickerModal
          products={products}
          catalogEnabled={useCatalog}
          showStock={useStock}
          inCart={inCart}
          onAddProduct={addProduct}
          onAddCustom={(item) => setLines((ls) => [...ls, { key: lineSeq++, productId: null, description: item.description, quantityText: fmtQtyText(item.quantity), unitPrice: item.unitPrice, note: "", noteOpen: false }])}
          onClose={() => setPicking(false)}
          onGoToCatalog={() => navigate({ page: "catalog" })}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Selector de cliente

function CustomerPicker({ customers, onPick }: { customers: Customer[]; onPick: (c: Customer) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const q = text.trim().toLowerCase();
  const matches = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.documentId ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q)).slice(0, 8);
  return (
    <div className="product-picker" ref={ref}>
      <div className="input-group">
        <UserRound size={16} />
        <input
          className="input"
          value={text}
          placeholder={customers.length ? "Consumidor final · buscar cliente…" : "Consumidor final"}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <div className="picker-menu">
          {matches.map((c) => (
            <button
              key={c.id}
              className="picker-option"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(c);
                setOpen(false);
              }}
            >
              <span className="ed-avatar" style={{ width: 30, height: 30 }}>
                {c.name.slice(0, 1).toUpperCase()}
              </span>
              <span style={{ flex: 1 }}>
                <div className="cell-main">{c.name}</div>
                <div className="cell-sub">{[c.documentId, c.phone].filter(Boolean).join(" · ")}</div>
              </span>
              {c.balanceDue > 0 && <span className="badge badge-warning">Debe {money(c.balanceDue)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
