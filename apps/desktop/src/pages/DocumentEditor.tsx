/**
 * Editor de facturas y cotizaciones.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Package, Plus, Printer, Save, Trash2, UserRound, X } from "lucide-react";
import type { BusinessSettings, Customer, PaymentMethod, Product } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api } from "../services/systemClient";
import { addDays, errorMessage, METHOD_LABELS, money, parseQty, qty, todayISO } from "../lib/format";
import { Alert, Button, Field, IconButton, MoneyInput, PageHeader, Segmented, Switch, useToast } from "../components/ui";

interface DraftLine {
  key: number;
  productId: number | null;
  description: string;
  quantityText: string;
  unitPrice: number;
}

let lineSeq = 1;
const emptyLine = (): DraftLine => ({ key: lineSeq++, productId: null, description: "", quantityText: "1", unitPrice: 0 });

export function DocumentEditorPage({ navigate, goBack, kind, customerId }: PageProps & { kind: "invoice" | "quote"; customerId?: number }) {
  const toast = useToast();
  const isInvoice = kind === "invoice";
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [manualCustomer, setManualCustomer] = useState({ name: "", documentId: "", phone: "" });
  const [issueDate, setIssueDate] = useState(todayISO());
  const [secondDate, setSecondDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [footer, setFooter] = useState("");
  const [payNow, setPayNow] = useState(true);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState<"save" | "print" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [s, p, c] = await Promise.all([api.getBusinessSettings(), api.listProducts(), api.listCustomers()]);
        setSettings(s);
        setProducts(p);
        setCustomers(c);
        setNotes(s.defaultNotes);
        setTerms(s.defaultTerms);
        setFooter(s.defaultFooter);
        const days = isInvoice ? s.defaultDueDays : s.defaultQuoteValidDays;
        if (days > 0) setSecondDate(addDays(todayISO(), days));
        if (customerId) setCustomer(c.find((x) => x.id === customerId) ?? null);
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [customerId, isInvoice]);

  const computed = useMemo(
    () =>
      lines.map((l) => {
        const q = parseQty(l.quantityText);
        return { ...l, quantity: q, total: Math.round(q * l.unitPrice) };
      }),
    [lines],
  );
  const total = computed.reduce((s, l) => s + (l.description.trim() || l.productId ? l.total : 0), 0);
  const effectivePay = payAmount ?? total;

  const updateLine = (key: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async (andPrint: boolean) => {
    setError(null);
    const valid = computed.filter((l) => l.description.trim() || l.productId);
    if (valid.length === 0) {
      setError("Agrega al menos un producto o servicio.");
      return;
    }
    const bad = valid.find((l) => !(l.quantity > 0));
    if (bad) {
      setError("Revisa las cantidades: deben ser mayores a cero.");
      return;
    }
    const payload = {
      customerId: customer?.id ?? null,
      customer: customer ? null : { name: manualCustomer.name, documentId: manualCustomer.documentId, phone: manualCustomer.phone },
      issueDate,
      lines: valid.map((l) => ({ productId: l.productId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice })),
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
          initialPayment: payNow && effectivePay > 0 ? { amount: Math.min(effectivePay, total), method: payMethod, paidAt: issueDate } : null,
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

  const title = isInvoice ? "Nueva factura" : "Nueva cotización";
  const nextNumber = settings
    ? `${isInvoice ? settings.invoicePrefix : settings.quotePrefix}${String(isInvoice ? settings.invoiceNextNumber : settings.quoteNextNumber).padStart(5, "0")}`
    : "";

  return (
    <div className="page is-wide" style={{ maxWidth: 1400 }}>
      <PageHeader
        title={title}
        subtitle={nextNumber ? `Se guardará como ${nextNumber}` : undefined}
        back={{ label: "Volver", onClick: goBack }}
      />

      <div className="editor">
        <div className="stack-lg">
          <div className="card">
            <div className="card-header">
              <div className="card-title">Cliente</div>
              {!customer && (
                <span className="subtle" style={{ fontSize: 12.5 }}>
                  Si lo dejas vacío se usa «Consumidor final»
                </span>
              )}
            </div>
            <div className="card-body">
              {customer ? (
                <div className="customer-chip">
                  <div className="sb-avatar" style={{ background: "var(--accent-soft)", color: "var(--accent-text)" }}>
                    <UserRound size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="cell-main">{customer.name}</div>
                    <div className="cell-sub">{[customer.documentId, customer.phone, customer.email].filter(Boolean).join(" · ") || "Sin datos de contacto"}</div>
                  </div>
                  {customer.balanceDue > 0 && <span className="badge badge-warning">Saldo {money(customer.balanceDue)}</span>}
                  <IconButton label="Quitar cliente" onClick={() => setCustomer(null)}>
                    <X size={16} />
                  </IconButton>
                </div>
              ) : (
                <div className="stack">
                  <CustomerPicker customers={customers} onPick={setCustomer} />
                  <div className="form-grid cols-3">
                    <Field label="O escribe el nombre" optional>
                      <input className="input" value={manualCustomer.name} onChange={(e) => setManualCustomer({ ...manualCustomer, name: e.target.value })} placeholder="Consumidor final" />
                    </Field>
                    <Field label="Documento" optional>
                      <input className="input" value={manualCustomer.documentId} onChange={(e) => setManualCustomer({ ...manualCustomer, documentId: e.target.value })} />
                    </Field>
                    <Field label="Teléfono" optional>
                      <input className="input" value={manualCustomer.phone} onChange={(e) => setManualCustomer({ ...manualCustomer, phone: e.target.value })} />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Productos y servicios</div>
              <span className="subtle" style={{ fontSize: 12.5 }}>
                Busca en tu catálogo o escribe una descripción libre
              </span>
            </div>
            <div className="table-wrap">
              <table className="table lines-table">
                <thead>
                  <tr>
                    <th style={{ width: "48%" }}>Descripción</th>
                    <th style={{ width: 110 }}>Cantidad</th>
                    <th style={{ width: 160 }}>Precio unitario</th>
                    <th className="t-right" style={{ width: 130 }}>
                      Total
                    </th>
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {computed.map((l, idx) => {
                    const prod = products.find((p) => p.id === l.productId);
                    const short = prod && prod.trackStock && prod.stockQty < l.quantity;
                    return (
                      <tr key={l.key}>
                        <td>
                          <ProductPicker
                            products={products}
                            value={l.description}
                            linked={prod ?? null}
                            autoFocus={idx === lines.length - 1 && idx > 0}
                            onText={(text) => updateLine(l.key, { description: text, productId: prod && text === prod.name ? prod.id : null })}
                            onPick={(p) => updateLine(l.key, { productId: p.id, description: p.name, unitPrice: p.price })}
                          />
                          {short && (
                            <div className="field-hint" style={{ color: "var(--warning)", marginTop: 4 }}>
                              Solo hay {qty(prod.stockQty)} {prod.unit} en inventario
                            </div>
                          )}
                        </td>
                        <td>
                          <input className="input num" style={{ textAlign: "right" }} inputMode="decimal" value={l.quantityText} onChange={(e) => updateLine(l.key, { quantityText: e.target.value })} onFocus={(e) => e.currentTarget.select()} />
                        </td>
                        <td>
                          <MoneyInput value={l.unitPrice} onChange={(v) => updateLine(l.key, { unitPrice: v })} />
                        </td>
                        <td className="t-right money" style={{ paddingTop: 16, fontWeight: 600 }}>
                          {money(l.total)}
                        </td>
                        <td style={{ paddingTop: 10 }}>
                          <IconButton label="Quitar línea" danger onClick={() => setLines((ls) => (ls.length === 1 ? [emptyLine()] : ls.filter((x) => x.key !== l.key)))}>
                            <Trash2 size={16} />
                          </IconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 16 }}>
              <button className="add-line" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
                <Plus size={16} /> Agregar línea
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">Textos del documento</div>
              <span className="subtle" style={{ fontSize: 12.5 }}>
                Los valores por defecto se cambian en Configuración
              </span>
            </div>
            <div className="card-body form-grid">
              <Field label="Notas" optional hint="Ej.: entrega, referencia del pedido, observaciones." className="span-all">
                <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <Field label="Condiciones" optional hint="Ej.: garantía, formas de pago, cuenta bancaria.">
                <textarea className="textarea" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
              </Field>
              <Field label="Pie de página" optional>
                <textarea className="textarea" rows={3} value={footer} onChange={(e) => setFooter(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        <div className="editor-side">
          <div className="card card-pad stack">
            <Field label="Fecha de emisión">
              <input type="date" className="input" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </Field>
            <Field label={isInvoice ? "Fecha de vencimiento" : "Válida hasta"} optional>
              <input type="date" className="input" value={secondDate} min={issueDate} onChange={(e) => setSecondDate(e.target.value)} />
            </Field>
          </div>

          <div className="card card-pad">
            <div className="totals">
              <div className="totals-row muted">
                <span>{computed.filter((l) => l.description.trim() || l.productId).length} líneas</span>
                <span />
              </div>
              <div className="totals-row is-grand">
                <span>Total</span>
                <span>{money(total)}</span>
              </div>
            </div>

            {isInvoice && (
              <>
                <div className="divider" />
                <Switch checked={payNow} onChange={setPayNow} label="Registrar pago ahora" description="Desactívalo si el cliente paga después." />
                {payNow && (
                  <div className="stack mt-16">
                    <Field label="Valor recibido" hint={effectivePay < total ? `Quedará un saldo de ${money(total - effectivePay)}` : undefined}>
                      <MoneyInput value={effectivePay} onChange={(v) => setPayAmount(v)} />
                    </Field>
                    <Segmented<PaymentMethod>
                      value={payMethod}
                      onChange={setPayMethod}
                      options={(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({ value: m, label: METHOD_LABELS[m] }))}
                    />
                    {payAmount !== null && payAmount !== total && (
                      <button className="back-link" onClick={() => setPayAmount(null)}>
                        Usar el total ({money(total)})
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {error && <Alert tone="danger">{error}</Alert>}

          <div className="stack" style={{ gap: 8 }}>
            <Button variant="primary" size="lg" block icon={<Printer size={18} />} loading={busy === "print"} disabled={!!busy} onClick={() => save(true)}>
              Guardar e imprimir
            </Button>
            <Button block icon={<Save size={16} />} loading={busy === "save"} disabled={!!busy} onClick={() => save(false)}>
              Solo guardar
            </Button>
          </div>
          <p className="subtle" style={{ fontSize: 12, textAlign: "center" }}>
            {isInvoice ? "Factura interna, sin validez fiscal ante la DIAN." : "La cotización no descuenta inventario."}
          </p>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Selectores

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOut();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut]);
}

function ProductPicker({
  products,
  value,
  linked,
  onText,
  onPick,
  autoFocus,
}: {
  products: Product[];
  value: string;
  linked: Product | null;
  onText: (t: string) => void;
  onPick: (p: Product) => void;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const q = value.trim().toLowerCase();
  const matches = products.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q)).slice(0, 8);

  return (
    <div className="product-picker" ref={ref}>
      <div className="input-group">
        <Package size={16} color={linked ? "var(--accent)" : undefined} />
        <input
          className="input"
          value={value}
          autoFocus={autoFocus}
          placeholder="Buscar producto o escribir descripción…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onText(e.target.value);
            setOpen(true);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (!open || matches.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(matches.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              onPick(matches[sel]);
              setOpen(false);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {open && matches.length > 0 && !(linked && linked.name === value) && (
        <div className="picker-menu">
          {matches.map((p, i) => (
            <button
              key={p.id}
              className={`picker-option ${i === sel ? "is-selected" : ""}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(p);
                setOpen(false);
              }}
            >
              <span className="thumb">{p.imageDataUrl ? <img src={p.imageDataUrl} alt="" /> : <Package size={14} />}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div className="cell-main">{p.name}</div>
                <div className="cell-sub">
                  {p.sku ? `${p.sku} · ` : ""}
                  {p.trackStock ? `${qty(p.stockQty)} ${p.unit} disponibles` : "Servicio"}
                </div>
              </span>
              <span className="money" style={{ fontWeight: 600 }}>
                {money(p.price)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomerPicker({ customers, onPick }: { customers: Customer[]; onPick: (c: Customer) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const q = text.trim().toLowerCase();
  const matches = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.documentId ?? "").toLowerCase().includes(q) || (c.phone ?? "").includes(q)).slice(0, 8);
  return (
    <div className="product-picker" ref={ref}>
      <div className="input-group">
        <UserRound size={16} />
        <input className="input" value={text} placeholder={customers.length ? "Buscar cliente guardado…" : "Aún no tienes clientes guardados"} onFocus={() => setOpen(true)} onChange={(e) => { setText(e.target.value); setOpen(true); }} />
      </div>
      {open && matches.length > 0 && (
        <div className="picker-menu">
          {matches.map((c) => (
            <button key={c.id} className="picker-option" onMouseDown={(e) => { e.preventDefault(); onPick(c); setOpen(false); }}>
              <span className="sb-avatar" style={{ width: 30, height: 30, background: "var(--accent-soft)", color: "var(--accent-text)" }}>
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
