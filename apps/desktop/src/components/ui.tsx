/**
 * Componentes de interfaz reutilizables del estilo "Lateral oscuro".
 */
import { portalTarget } from "./titleBar";
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  InputHTMLAttributes,
  ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, ImagePlus, Info, Loader2, Search, Trash2, X } from "lucide-react";
import type { InvoiceStatus, QuoteStatus } from "@cartucho/shared";
import { INVOICE_STATUS, QUOTE_STATUS, errorMessage, money, parseMoney } from "../lib/format";
import { readImageFile } from "../lib/image";

// ------------------------------------------------------------------ Botones

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, loading, block, className = "", children, disabled, ...rest }: ButtonProps) {
  const cls = [
    "btn",
    variant === "primary" && "btn-primary",
    variant === "ghost" && "btn-ghost",
    variant === "danger" && "btn-danger",
    variant === "danger-solid" && "btn-danger-solid",
    size === "sm" && "btn-sm",
    size === "lg" && "btn-lg",
    block && "btn-block",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={16} className="spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, danger, children, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; danger?: boolean }) {
  return (
    <button type="button" className={`icon-btn ${danger ? "is-danger" : ""} ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Formularios

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className = "",
}: {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      {label && (
        <span className="field-label">
          {label} {optional && <span className="opt">(opcional)</span>}
        </span>
      )}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Campo de dinero que muestra separadores de miles mientras se escribe. */
export function MoneyInput({
  value,
  onChange,
  className = "",
  ...rest
}: { value: number; onChange: (v: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value ? value.toLocaleString("es-CO") : "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value ? value.toLocaleString("es-CO") : "");
  }, [value]);
  return (
    <div className="input-group">
      <span style={{ position: "absolute", left: 12, color: "var(--text-3)", pointerEvents: "none" }}>$</span>
      <input
        className={`input input-money ${className}`}
        style={{ paddingLeft: 24 }}
        inputMode="numeric"
        value={text}
        placeholder="0"
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(value ? value.toLocaleString("es-CO") : "");
        }}
        onChange={(e) => {
          const n = parseMoney(e.target.value);
          setText(e.target.value === "" ? "" : n.toLocaleString("es-CO"));
          onChange(n);
        }}
        {...rest}
      />
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = "Buscar…", autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div className="input-group">
      <Search size={16} />
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      {value && (
        <span className="input-suffix">
          <IconButton label="Limpiar búsqueda" onClick={() => onChange("")} style={{ width: 26, height: 26 }}>
            <X size={14} />
          </IconButton>
        </span>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: string; description?: string }) {
  return (
    <label className="row-between" style={{ cursor: "pointer", gap: 16 }}>
      {(label || description) && (
        <span>
          {label && <span style={{ fontWeight: 500, display: "block" }}>{label}</span>}
          {description && <span className="muted" style={{ fontSize: 13 }}>{description}</span>}
        </span>
      )}
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? "is-active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Selector de imagen con vista previa; reduce la foto antes de guardarla. */
export function ImagePicker({
  value,
  onChange,
  onRemove,
  maxSide = 800,
  label = "Subir imagen",
  preferPng = false,
  size = 96,
}: {
  value: string | null;
  onChange: (img: { base64: string; mime: string; dataUrl: string }) => void;
  onRemove: () => void;
  maxSide?: number;
  label?: string;
  preferPng?: boolean;
  size?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="logo-picker">
      <div className="logo-drop" style={{ width: size, height: size }} onClick={() => ref.current?.click()} role="button" tabIndex={0} aria-label={label}>
        {value ? <img src={value} alt="" /> : <ImagePlus size={26} />}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row">
          <Button size="sm" onClick={() => ref.current?.click()}>
            {value ? "Cambiar" : label}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={onRemove}>
              Quitar
            </Button>
          )}
        </div>
        <span className="field-hint">PNG, JPG o WEBP. Se ajusta automáticamente.</span>
        {error && <span className="field-error">{error}</span>}
      </div>
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            setError(null);
            onChange(await readImageFile(f, maxSide, preferPng ? "image/png" : "image/webp"));
          } catch (err) {
            setError(errorMessage(err));
          }
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ Presentación

export function Badge({ tone = "neutral", children, dot = true }: { tone?: string; children: ReactNode; dot?: boolean }) {
  return <span className={`badge ${tone !== "neutral" ? `badge-${tone}` : ""} ${dot ? "" : "no-dot"}`}>{children}</span>;
}

export function InvoiceStatusBadge({ status, overdue }: { status: InvoiceStatus; overdue?: boolean }) {
  if (overdue) return <Badge tone="danger">Vencida</Badge>;
  const s = INVOICE_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const s = QUOTE_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`money ${className}`}>{money(value)}</span>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { label: string; onClick: () => void } }) {
  return (
    <div className="page-header">
      <div>
        {back && (
          <button className="back-link" onClick={back.onClick}>
            ← {back.label}
          </button>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon, tone = "accent", foot }: { label: string; value: ReactNode; icon: ReactNode; tone?: "accent" | "success" | "warning" | "danger" | "info"; foot?: ReactNode }) {
  return (
    <div className={`card stat stat-${tone}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${tone !== "accent" ? `is-${tone}` : ""}`}>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

/** Botón «Mostrar N más» para listas largas (ver useShowMore). */
export function ShowMore({ remaining, onMore, step = 100 }: { remaining: number; onMore: () => void; step?: number }) {
  if (remaining <= 0) return null;
  return (
    <div className="show-more">
      <Button size="sm" variant="ghost" onClick={onMore}>
        Mostrar {Math.min(step, remaining)} más ({remaining} restantes)
      </Button>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {text && <p className="empty-text">{text}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 16 }} className="stack">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 36, opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function Alert({ tone = "info", children, title }: { tone?: "info" | "warning" | "danger" | "success"; children?: ReactNode; title?: ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  return (
    <div className={`alert alert-${tone}`}>
      <Icon size={18} />
      <div className="alert-body">
        {title && <div style={{ fontWeight: 600 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Capas flotantes

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  readOnly,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Sin permiso de edición: campos deshabilitados y solo el botón «Cerrar». */
  readOnly?: boolean;
}) {
  useEscape(onClose);
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <aside className={`drawer ${wide ? "is-wide" : ""}`} role="dialog" aria-modal="true">
        <div className="drawer-header">
          <div>
            <div className="drawer-title">{title}</div>
            {subtitle && <div className="drawer-subtitle">{subtitle}</div>}
          </div>
          <IconButton label="Cerrar" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="drawer-body">
          {readOnly ? (
            <fieldset className="readonly-fieldset" disabled>
              <div className="readonly-note">Solo lectura: tu rol no permite modificar esto.</div>
              {children}
            </fieldset>
          ) : (
            children
          )}
        </div>
        {readOnly ? (
          <div className="drawer-footer">
            <Button variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        ) : (
          footer && <div className="drawer-footer">{footer}</div>
        )}
      </aside>
    </>,
    portalTarget(),
  );
}

export function Modal({ onClose, children, footer, large }: { onClose: () => void; children: ReactNode; footer?: ReactNode; large?: boolean }) {
  useEscape(onClose);
  return createPortal(
    <div className="modal-wrap">
      <div className="overlay" onClick={onClose} />
      <div className={`modal ${large ? "is-large" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    portalTarget(),
  );
}

/** Confirmación con texto opcional (por ejemplo, el motivo de anulación). */
export function ConfirmDialog({
  title,
  text,
  confirmLabel = "Confirmar",
  danger,
  requireReason,
  reasonLabel = "Motivo",
  onConfirm,
  onClose,
}: {
  title: string;
  text?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (requireReason && !reason.trim()) {
      setError("Escribe el motivo para continuar.");
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={danger ? "danger-solid" : "primary"} loading={busy} onClick={submit}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="modal-title">{title}</div>
      {text && <div className="modal-text">{text}</div>}
      {requireReason && (
        <div className="mt-16">
          <Field label={reasonLabel} error={error}>
            <textarea className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus rows={3} />
          </Field>
        </div>
      )}
      {!requireReason && error && (
        <div className="mt-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ Avisos

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toast-stack" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast is-${t.kind}`}>
              {t.kind === "success" ? <CheckCircle2 size={18} /> : t.kind === "error" ? <AlertCircle size={18} /> : <Info size={18} />}
              <span>{t.text}</span>
            </div>
          ))}
        </div>,
        portalTarget(),
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
