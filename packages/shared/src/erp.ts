/**
 * Contratos de los módulos de negocio (facturación, catálogo, inventario, finanzas).
 * Deben coincidir con las estructuras Rust de `src-tauri/src/erp` y `data_admin.rs`.
 *
 * Convenciones: montos en pesos enteros, cantidades con decimales,
 * fechas de negocio en formato `AAAA-MM-DD`.
 */

export type PaymentMethod = "cash" | "transfer" | "card" | "other";
export type InvoiceStatus = "pending" | "partial" | "paid" | "void";
export type QuoteStatus = "open" | "converted" | "cancelled";
export type CategoryKind = "product" | "expense";
export type PaperSize = "letter" | "half-letter" | "a4" | "roll80" | "roll58";
export type CsvReportKind = "invoices" | "payments" | "expenses" | "products" | "customers";

export interface Customer {
  id: number;
  name: string;
  documentId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  invoiceCount: number;
  totalInvoiced: number;
  balanceDue: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerInput {
  id?: number | null;
  name: string;
  documentId?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

export interface Category {
  id: number;
  kind: CategoryKind;
  name: string;
  usageCount: number;
}

/** "product": se vende (con o sin control de existencias). "service": se presta, nunca tiene existencias. */
export type ItemKind = "product" | "service";

export interface Product {
  id: number;
  /** Ausente en versiones anteriores: servicio si no controla existencias. */
  kind?: ItemKind;
  sku: string | null;
  /** Código de barras (lo lee el lector en el punto de venta y en facturas). */
  barcode?: string | null;
  name: string;
  description: string | null;
  categoryId: number | null;
  categoryName: string | null;
  unit: string;
  price: number;
  cost: number;
  trackStock: boolean;
  stockQty: number;
  minStock: number;
  isLowStock: boolean;
  imageDataUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  id?: number | null;
  kind?: ItemKind;
  barcode?: string | null;
  sku?: string | null;
  name: string;
  description?: string | null;
  categoryId?: number | null;
  unit?: string | null;
  price: number;
  cost: number;
  trackStock: boolean;
  minStock: number;
  initialStock?: number | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  removeImage?: boolean;
}

export interface StockAdjustmentInput {
  productId: number;
  kind: "purchase" | "adjustment";
  quantity: number;
  unitCost?: number | null;
  note?: string | null;
  recordExpense?: boolean;
  expenseDate?: string | null;
  method?: PaymentMethod | null;
  supplier?: string | null;
}

export type MovementKind = "initial" | "purchase" | "adjustment" | "sale" | "void_return";

export interface InventoryMovement {
  id: number;
  productId: number;
  productName: string;
  kind: MovementKind;
  quantity: number;
  unitCost: number | null;
  stockAfter: number;
  referenceType: string | null;
  referenceId: number | null;
  referenceLabel: string | null;
  note: string | null;
  createdAt: string;
}

export interface DocumentLineInput {
  productId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  /** Descripción adicional (garantía, referencia, color…). */
  note?: string | null;
}

export interface CustomerSnapshot {
  name: string;
  documentId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface CustomerSnapshotInput {
  name: string;
  documentId?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface PaymentInput {
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  note?: string | null;
}

export interface InvoiceInput {
  customerId?: number | null;
  customer?: CustomerSnapshotInput | null;
  issueDate: string;
  dueDate?: string | null;
  lines: DocumentLineInput[];
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
  initialPayment?: PaymentInput | null;
}

export interface QuoteInput {
  customerId?: number | null;
  customer?: CustomerSnapshotInput | null;
  issueDate: string;
  validUntil?: string | null;
  lines: DocumentLineInput[];
  notes?: string | null;
  terms?: string | null;
  footer?: string | null;
}

export interface InvoiceFilter {
  search?: string | null;
  status?: InvoiceStatus | "open" | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  customerId?: number | null;
  limit?: number | null;
  /** Solo facturas creadas por este usuario. */
  createdBy?: number | null;
}

export interface InvoiceSummary {
  id: number;
  number: string;
  customerId: number | null;
  customerName: string;
  issueDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  total: number;
  paidAmount: number;
  balance: number;
  createdAt: string;
  /** Usuario que creó la factura. */
  createdById?: number | null;
  createdByName?: string | null;
}

export interface DocumentLine {
  id: number;
  position: number;
  productId: number | null;
  description: string;
  note?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Payment {
  id: number;
  invoiceId: number;
  invoiceNumber: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string;
  note: string | null;
  invoiceVoided: boolean;
  createdAt: string;
  /** Usuario que registró el pago. */
  createdByName?: string | null;
}

// ------------------------------------------------------------------ Cierre de caja y estado de cuenta

export interface CashClose {
  date: string;
  userId: number | null;
  userName: string | null;
  byMethod: { method: PaymentMethod; count: number; total: number }[];
  collectedTotal: number;
  cashCollected: number;
  invoicesCount: number;
  invoicesTotal: number;
  voidedCount: number;
  voidedTotal: number;
  /** Gastos en efectivo del día (solo en el cierre de todos los usuarios). */
  cashExpenses: number;
  expectedCash: number;
  byUser: { userId: number | null; userName: string; payments: number; collected: number; invoices: number; invoiced: number }[];
  payments: Payment[];
}

export interface CustomerStatement {
  customer: Customer;
  invoices: InvoiceSummary[];
  payments: Payment[];
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  overdueBalance: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  customer: CustomerSnapshot;
  notes: string | null;
  terms: string | null;
  footer: string | null;
  quoteId: number | null;
  quoteNumber: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  lines: DocumentLine[];
  payments: Payment[];
}

export interface QuoteSummary {
  id: number;
  number: string;
  customerId: number | null;
  customerName: string;
  issueDate: string;
  validUntil: string | null;
  status: QuoteStatus;
  total: number;
  convertedInvoiceId: number | null;
  convertedInvoiceNumber: string | null;
  createdAt: string;
}

export interface QuoteDetail extends QuoteSummary {
  customer: CustomerSnapshot;
  notes: string | null;
  terms: string | null;
  footer: string | null;
  lines: DocumentLine[];
}

export interface Expense {
  id: number;
  kind: "operating" | "inventory";
  categoryId: number | null;
  categoryName: string | null;
  description: string;
  amount: number;
  expenseDate: string;
  method: PaymentMethod;
  supplier: string | null;
  note: string | null;
  productId: number | null;
  createdAt: string;
}

export interface ExpenseInput {
  id?: number | null;
  categoryId?: number | null;
  description: string;
  amount: number;
  expenseDate: string;
  method: PaymentMethod;
  supplier?: string | null;
  note?: string | null;
}

export interface AmountByLabel {
  label: string;
  amount: number;
}

export interface MonthlyPoint {
  month: string;
  invoiced: number;
  collected: number;
  expenses: number;
}

export interface TopProduct {
  name: string;
  quantity: number;
  total: number;
}

export interface FinanceSummary {
  dateFrom: string;
  dateTo: string;
  invoiceCount: number;
  invoicedTotal: number;
  collectedTotal: number;
  receivableTotal: number;
  operatingExpenses: number;
  inventoryPurchases: number;
  costOfGoodsSold: number;
  grossProfit: number;
  netCashFlow: number;
  expensesByCategory: AmountByLabel[];
  paymentsByMethod: AmountByLabel[];
  monthly: MonthlyPoint[];
  topProducts: TopProduct[];
}

export interface DashboardData {
  today: string;
  month: FinanceSummary;
  todayCollected: number;
  openInvoiceCount: number;
  overdueCount: number;
  overdueTotal: number;
  openQuoteCount: number;
  productCount: number;
  customerCount: number;
  lowStock: Product[];
  recentInvoices: InvoiceSummary[];
  /** Totales del periodo anterior de igual duración (para la variación). */
  previous?: PeriodTotals | null;
  /** Serie del periodo: por día hasta 92 días; por mes en rangos más largos. */
  trend?: TrendPoint[];
  /** Fuentes incluidas según módulos activos y rol. Lo no incluido llega vacío: no es un cero real. */
  scope?: DashboardScope;
}

export interface PeriodTotals {
  dateFrom: string;
  dateTo: string;
  invoicedTotal: number;
  collectedTotal: number;
  expensesTotal: number;
  netCashFlow: number;
}

export interface TrendPoint {
  /** AAAA-MM-DD (diaria) o AAAA-MM (mensual). */
  period: string;
  invoiced: number;
  collected: number;
  expenses: number;
}

export interface DashboardScope {
  expenses: boolean;
  finance: boolean;
  inventory: boolean;
}

export type SearchHitKind = "invoice" | "customer" | "product" | "quote";

export interface SearchHit {
  kind: SearchHitKind;
  id: number;
  title: string;
  subtitle: string;
}

export interface BusinessSettings {
  invoicePrefix: string;
  invoiceNextNumber: number;
  quotePrefix: string;
  quoteNextNumber: number;
  defaultDueDays: number;
  defaultQuoteValidDays: number;
  defaultNotes: string;
  defaultTerms: string;
  defaultFooter: string;
  paperSize: PaperSize;
  showLogoOnPrint: boolean;
}

export interface BackupFileInfo {
  fileName: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  kind: "auto" | "manual" | "pre_migration" | "pre_restore" | "pre_move";
}

export interface DataLocationInfo {
  dataDir: string;
  databasePath: string;
  backupsDir: string;
  defaultDataDir: string;
  isCustomLocation: boolean;
  databaseSizeBytes: number;
  backupsTotalBytes: number;
  backups: BackupFileInfo[];
  autoBackupEnabled: boolean;
  autoBackupKeep: number;
  lastAutoBackupDate: string | null;
}

export interface RestoreResult {
  restoredFrom: string;
  safetyBackupPath: string;
  schemaVersionBefore: number;
}

export const ERP_COMMANDS = {
  LIST_CUSTOMERS: "list_customers",
  SAVE_CUSTOMER: "save_customer",
  SET_CUSTOMER_ACTIVE: "set_customer_active",
  LIST_CATEGORIES: "list_categories",
  SAVE_CATEGORY: "save_category",
  DELETE_CATEGORY: "delete_category",
  LIST_PRODUCTS: "list_products",
  SAVE_PRODUCT: "save_product",
  SET_PRODUCT_ACTIVE: "set_product_active",
  ADJUST_STOCK: "adjust_stock",
  LIST_INVENTORY_MOVEMENTS: "list_inventory_movements",
  CREATE_INVOICE: "create_invoice",
  LIST_INVOICES: "list_invoices",
  GET_INVOICE: "get_invoice",
  ADD_PAYMENT: "add_payment",
  VOID_INVOICE: "void_invoice",
  LIST_PAYMENTS: "list_payments",
  CREATE_QUOTE: "create_quote",
  LIST_QUOTES: "list_quotes",
  GET_QUOTE: "get_quote",
  CANCEL_QUOTE: "cancel_quote",
  CONVERT_QUOTE_TO_INVOICE: "convert_quote_to_invoice",
  LIST_EXPENSES: "list_expenses",
  SAVE_EXPENSE: "save_expense",
  DELETE_EXPENSE: "delete_expense",
  FINANCE_SUMMARY: "finance_summary",
  GET_DASHBOARD: "get_dashboard",
  GET_CASH_CLOSE: "get_cash_close",
  GET_CUSTOMER_STATEMENT: "get_customer_statement",
  SET_AUTO_LOCK: "set_auto_lock",
  GLOBAL_SEARCH: "global_search",
  EXPORT_CSV: "export_csv",
  GET_BUSINESS_SETTINGS: "get_business_settings",
  SAVE_BUSINESS_SETTINGS: "save_business_settings",
  GET_DATA_LOCATION: "get_data_location",
  SAVE_AUTO_BACKUP_SETTINGS: "save_auto_backup_settings",
  CREATE_MANUAL_BACKUP: "create_manual_backup",
  EXPORT_BACKUP: "export_backup",
  RESTORE_BACKUP: "restore_backup",
  MOVE_DATA_LOCATION: "move_data_location",
  USE_EXISTING_DATA_LOCATION: "use_existing_data_location",
  SETUP_DATA_LOCATION: "setup_data_location",
  RESET_DATA_LOCATION: "reset_data_location",
  RETRY_OPEN_DATABASE: "retry_open_database",
} as const;

/** Tipo efectivo de un ítem del catálogo (compatible con datos sin `kind`). */
export function itemKind(p: { kind?: ItemKind; trackStock: boolean }): ItemKind {
  return p.kind ?? (p.trackStock ? "product" : "service");
}
