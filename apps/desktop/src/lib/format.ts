import type { InvoiceStatus, PaymentMethod, QuoteStatus } from "@cartucho/shared";

const moneyFmt = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const numberFmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });

/** Formatea pesos colombianos sin decimales: $ 1.250.000 */
export function money(value: number | null | undefined): string {
  return moneyFmt.format(Math.round(value ?? 0)).replace(/ /g, " ");
}

/** Formato compacto para tarjetas: $ 1,2 M */
export function moneyShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$ ${(abs / 1_000_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} mil M`;
  if (abs >= 1_000_000) return `${sign}$ ${(abs / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  return money(value);
}

export function qty(value: number): string {
  return numberFmt.format(value);
}

/** Convierte texto escrito por el usuario ("1.250.000", "$ 25 000") a pesos enteros. */
export function parseMoney(text: string): number {
  const digits = text.replace(/[^\d-]/g, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/** Convierte una cantidad escrita con coma o punto decimal. */
export function parseQty(text: string): number {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function todayISO(): string {
  const d = new Date();
  return toISODate(d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function monthStart(iso: string = todayISO()): string {
  return `${iso.slice(0, 7)}-01`;
}

export function monthEnd(iso: string = todayISO()): string {
  const [y, m] = iso.split("-").map(Number);
  return toISODate(new Date(y, m, 0));
}

const longDate = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" });
const monthName = new Intl.DateTimeFormat("es-CO", { month: "short" });
const monthLong = new Intl.DateTimeFormat("es-CO", { month: "long", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short" });

/** "10 nov 2026" a partir de AAAA-MM-DD */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return longDate.format(new Date(y, m - 1, d)).replace(".", "");
}

export function fmtDateTime(rfc: string | null | undefined): string {
  if (!rfc) return "—";
  const d = new Date(rfc);
  return Number.isNaN(d.getTime()) ? rfc : dateTime.format(d);
}

export function fmtMonthShort(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return monthName.format(new Date(y, m - 1, 1)).replace(".", "");
}

export function fmtMonthLong(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const s = monthLong.format(new Date(y, m - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  other: "Otro",
};

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: string }> = {
  pending: { label: "Pendiente", tone: "warning" },
  partial: { label: "Pago parcial", tone: "info" },
  paid: { label: "Pagada", tone: "success" },
  void: { label: "Anulada", tone: "neutral" },
};

export const QUOTE_STATUS: Record<QuoteStatus, { label: string; tone: string }> = {
  open: { label: "Abierta", tone: "accent" },
  converted: { label: "Facturada", tone: "success" },
  cancelled: { label: "Cancelada", tone: "neutral" },
};

export function isOverdue(dueDate: string | null, balance: number, status: string): boolean {
  return !!dueDate && balance > 0 && status !== "void" && dueDate < todayISO();
}

/** Mensaje de error legible a partir de lo que devuelva Tauri o el modo vista previa. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err.replace(/^STARTUP_ERROR:\s*/, "");
  if (err instanceof Error) return err.message;
  return "Ocurrió un error inesperado.";
}
