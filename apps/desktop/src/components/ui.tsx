import React, { useEffect } from "react";
import { AlertCircle, CheckCircle2, Inbox, Loader2, X } from "lucide-react";

/* ==========================================================================
   Button
   ========================================================================== */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  icon?: React.ReactNode;
}

export function Button({
  variant = "primary",
  icon,
  children,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`ui-btn ui-btn-${variant} ${className}`.trim()}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/* ==========================================================================
   Input
   ========================================================================== */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
}

export function Input({ label, helperText, id, ...props }: InputProps) {
  return (
    <div className="ui-field">
      {label && (
        <label className="ui-label" htmlFor={id}>
          {label}
        </label>
      )}
      <input id={id} className="ui-input" {...props} />
      {helperText && <span className="ui-helper">{helperText}</span>}
    </div>
  );
}

/* ==========================================================================
   Select
   ========================================================================== */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  options: SelectOption[];
}

export function Select({
  label,
  helperText,
  options,
  id,
  ...props
}: SelectProps) {
  return (
    <div className="ui-field">
      {label && (
        <label className="ui-label" htmlFor={id}>
          {label}
        </label>
      )}
      <select id={id} className="ui-select" {...props}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {helperText && <span className="ui-helper">{helperText}</span>}
    </div>
  );
}

/* ==========================================================================
   Badge
   ========================================================================== */

export interface BadgeProps {
  variant?: "success" | "warning" | "error" | "neutral";
  children: React.ReactNode;
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return <span className={`ui-badge ui-badge-${variant}`}>{children}</span>;
}

/* ==========================================================================
   Card
   ========================================================================== */

export interface CardProps {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export function Card({ title, subtitle, icon, action, children }: CardProps) {
  return (
    <section className="ui-card">
      {(title || subtitle || action) && (
        <header className="ui-card-header">
          <div>
            {title && (
              <h2 className="ui-card-title">
                {icon}
                <span>{title}</span>
              </h2>
            )}
            {subtitle && <p className="ui-card-subtitle">{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ==========================================================================
   Table
   ========================================================================== */

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string | number;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = "Sin registros disponibles.",
}: DataTableProps<T>) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="Sin registros"
        description={emptyMessage}
      />
    );
  }

  return (
    <div className="ui-table-container">
      <table className="ui-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ==========================================================================
   Dialog / Modal
   ========================================================================== */

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Dialog({ open, title, onClose, children, footer }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      onClick={onClose}
    >
      <div className="ui-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="ui-dialog-header">
          <h3 id="dialog-title" className="ui-dialog-title">
            {title}
          </h3>
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="Cerrar diálogo"
            icon={<X size={16} />}
          />
        </header>
        <div>{children}</div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}

/* ==========================================================================
   Toast Notification
   ========================================================================== */

export interface ToastMessage {
  id: number;
  type: "success" | "error";
  text: string;
}

export interface ToastRegionProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="ui-toast-region" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="ui-toast">
          {t.type === "success" ? (
            <CheckCircle2 size={16} color="var(--status-success-text)" />
          ) : (
            <AlertCircle size={16} color="var(--status-error-text)" />
          )}
          <span style={{ flex: 1 }}>{t.text}</span>
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            style={{ padding: "2px 4px" }}
            onClick={() => onDismiss(t.id)}
            aria-label="Cerrar notificación"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
   Empty, Loading & Error States
   ========================================================================== */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="ui-state-box">
      <Inbox size={22} color="var(--text-secondary)" />
      <h3 className="ui-state-title">{title}</h3>
      <p className="ui-state-description">{description}</p>
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

export function LoadingState({ message = "Cargando información del sistema..." }: { message?: string }) {
  return (
    <div className="ui-state-box" style={{ margin: "48px auto", maxWidth: 460 }}>
      <Loader2 size={22} color="var(--text-secondary)" />
      <h3 className="ui-state-title">Inicializando Cartucho ERP</h3>
      <p className="ui-state-description">{message}</p>
    </div>
  );
}

export function ErrorState({
  title = "Error de inicialización",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="ui-state-box" style={{ margin: "48px auto", maxWidth: 520 }}>
      <AlertCircle size={22} color="var(--status-error-text)" />
      <h3 className="ui-state-title">{title}</h3>
      <p className="ui-state-description">{message}</p>
      {onRetry && (
        <div style={{ marginTop: 8 }}>
          <Button variant="secondary" onClick={onRetry}>
            Reintentar conexión
          </Button>
        </div>
      )}
    </div>
  );
}
