/**
 * Cliente tipado de los comandos IPC de Tauri.
 *
 * Dentro de la aplicación de escritorio todas las operaciones se ejecutan en Rust + SQLite.
 * Al abrir la interfaz en un navegador (`pnpm dev`) se usa un backend de vista previa en
 * memoria del navegador, útil solo para diseño y demostraciones: no guarda datos reales.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  BusinessSettings,
  CashClose,
  CustomerStatement,
  Category,
  CategoryKind,
  ChangePasswordInput,
  CompleteInitialSetupInput,
  SetupDataMode,
  CsvReportKind,
  Customer,
  CustomerInput,
  DashboardData,
  DataLocationInfo,
  ERP_COMMANDS,
  Expense,
  ExpenseInput,
  FinanceSummary,
  InventoryMovement,
  InvoiceDetail,
  InvoiceFilter,
  InvoiceInput,
  InvoiceSummary,
  LICENSE_CHANGED_EVENT,
  LICENSE_COMMANDS,
  USER_COMMANDS,
  Role,
  RoleInput,
  UserAccount,
  UserInput,
  LicenseStatus,
  LoginInput,
  Payment,
  PaymentInput,
  Product,
  ProductInput,
  QuoteDetail,
  QuoteInput,
  QuoteSummary,
  RestoreResult,
  SaveCompanyProfileInput,
  SearchHit,
  StockAdjustmentInput,
  SystemOverview,
  TAURI_COMMANDS,
  ThemePreference,
  Appearance,
} from "@cartucho/shared";

export const isDesktop = (): boolean => {
  try {
    return isTauri();
  } catch {
    return false;
  }
};

let previewModule: Promise<typeof import("./previewBackend")> | null = null;

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isDesktop()) {
    return invoke<T>(command, args);
  }
  previewModule ??= import("./previewBackend");
  const mod = await previewModule;
  return mod.handlePreviewCommand(command, args) as Promise<T>;
}

const C = { ...TAURI_COMMANDS, ...ERP_COMMANDS, ...LICENSE_COMMANDS, ...USER_COMMANDS };

export const api = {
  // Sistema y sesión
  overview: () => call<SystemOverview>(C.GET_SYSTEM_OVERVIEW),
  completeSetup: (input: CompleteInitialSetupInput) => call<SystemOverview>(C.COMPLETE_INITIAL_SETUP, { input }),
  login: (input: LoginInput) => call<SystemOverview>(C.LOGIN_USER, { input }),
  logout: () => call<SystemOverview>(C.LOGOUT_USER),
  changePassword: (input: ChangePasswordInput) => call<SystemOverview>(C.CHANGE_USER_PASSWORD, { input }),
  setTheme: (theme: ThemePreference) => call<SystemOverview>(C.SET_THEME_PREFERENCE, { theme }),
  setAppearance: (appearance: Appearance, theme?: ThemePreference) =>
    call<SystemOverview>(C.SET_APPEARANCE, { appearance, theme: theme ?? null }),
  saveCompany: (input: SaveCompanyProfileInput) => call<SystemOverview>(C.SAVE_COMPANY_PROFILE, { input }),
  resetDataLocation: () => call<SystemOverview>(C.RESET_DATA_LOCATION),
  retryOpenDatabase: () => call<SystemOverview>(C.RETRY_OPEN_DATABASE),

  // Usuarios y roles (solo administrador)
  listRoles: () => call<Role[]>(C.LIST_ROLES),
  saveRole: (input: RoleInput) => call<Role>(C.SAVE_ROLE, { input }),
  deleteRole: (id: number) => call<void>(C.DELETE_ROLE, { id }),
  listUsers: () => call<UserAccount[]>(C.LIST_USERS),
  saveUser: (input: UserInput) => call<UserAccount>(C.SAVE_USER, { input }),

  // Licencia
  licenseStatus: () => call<LicenseStatus>(C.GET_LICENSE_STATUS),
  activateOnline: (licenseKey: string) => call<LicenseStatus>(C.ACTIVATE_LICENSE_ONLINE, { licenseKey }),
  activateOffline: (activationCode: string) => call<LicenseStatus>(C.ACTIVATE_LICENSE_OFFLINE, { activationCode }),
  checkLicense: () => call<LicenseStatus>(C.CHECK_LICENSE_NOW),

  // Clientes
  listCustomers: (search = "", includeInactive = false) =>
    call<Customer[]>(C.LIST_CUSTOMERS, { search, includeInactive }),
  saveCustomer: (input: CustomerInput) => call<Customer>(C.SAVE_CUSTOMER, { input }),
  setCustomerActive: (id: number, active: boolean) => call<Customer>(C.SET_CUSTOMER_ACTIVE, { id, active }),

  // Categorías
  listCategories: (kind: CategoryKind) => call<Category[]>(C.LIST_CATEGORIES, { kind }),
  saveCategory: (kind: CategoryKind, name: string, id: number | null = null) =>
    call<Category>(C.SAVE_CATEGORY, { id, kind, name }),
  deleteCategory: (id: number) => call<void>(C.DELETE_CATEGORY, { id }),

  // Productos e inventario
  listProducts: (opts: { search?: string; categoryId?: number | null; includeInactive?: boolean; onlyLowStock?: boolean } = {}) =>
    call<Product[]>(C.LIST_PRODUCTS, {
      search: opts.search ?? "",
      categoryId: opts.categoryId ?? null,
      includeInactive: opts.includeInactive ?? false,
      onlyLowStock: opts.onlyLowStock ?? false,
    }),
  saveProduct: (input: ProductInput) => call<Product>(C.SAVE_PRODUCT, { input }),
  setProductActive: (id: number, active: boolean) => call<Product>(C.SET_PRODUCT_ACTIVE, { id, active }),
  adjustStock: (input: StockAdjustmentInput) => call<Product>(C.ADJUST_STOCK, { input }),
  listMovements: (productId: number | null = null, limit = 200) =>
    call<InventoryMovement[]>(C.LIST_INVENTORY_MOVEMENTS, { productId, limit }),

  // Facturas
  createInvoice: (input: InvoiceInput) => call<InvoiceDetail>(C.CREATE_INVOICE, { input }),
  listInvoices: (filter: InvoiceFilter = {}) => call<InvoiceSummary[]>(C.LIST_INVOICES, { filter }),
  getInvoice: (id: number) => call<InvoiceDetail>(C.GET_INVOICE, { id }),
  addPayment: (invoiceId: number, payment: PaymentInput) => call<InvoiceDetail>(C.ADD_PAYMENT, { invoiceId, payment }),
  voidInvoice: (invoiceId: number, reason: string) => call<InvoiceDetail>(C.VOID_INVOICE, { invoiceId, reason }),
  listPayments: (dateFrom: string | null, dateTo: string | null) =>
    call<Payment[]>(C.LIST_PAYMENTS, { dateFrom, dateTo }),

  // Cotizaciones
  createQuote: (input: QuoteInput) => call<QuoteDetail>(C.CREATE_QUOTE, { input }),
  listQuotes: (search = "", status: string | null = null) => call<QuoteSummary[]>(C.LIST_QUOTES, { search, status }),
  getQuote: (id: number) => call<QuoteDetail>(C.GET_QUOTE, { id }),
  cancelQuote: (id: number) => call<QuoteDetail>(C.CANCEL_QUOTE, { id }),
  convertQuote: (quoteId: number, issueDate: string, dueDate: string | null) =>
    call<InvoiceDetail>(C.CONVERT_QUOTE_TO_INVOICE, { quoteId, issueDate, dueDate }),

  // Finanzas
  listExpenses: (dateFrom: string | null, dateTo: string | null, categoryId: number | null = null, search = "") =>
    call<Expense[]>(C.LIST_EXPENSES, { dateFrom, dateTo, categoryId, search }),
  saveExpense: (input: ExpenseInput) => call<Expense>(C.SAVE_EXPENSE, { input }),
  deleteExpense: (id: number) => call<void>(C.DELETE_EXPENSE, { id }),
  financeSummary: (dateFrom: string, dateTo: string) => call<FinanceSummary>(C.FINANCE_SUMMARY, { dateFrom, dateTo }),
  dashboard: (today: string) => call<DashboardData>(C.GET_DASHBOARD, { today }),
  cashClose: (date: string, userId: number | null) => call<CashClose>(C.GET_CASH_CLOSE, { date, userId }),
  customerStatement: (customerId: number, today: string) => call<CustomerStatement>(C.GET_CUSTOMER_STATEMENT, { customerId, today }),
  setAutoLock: (minutes: number) => call<SystemOverview>(C.SET_AUTO_LOCK, { minutes }),
  search: (query: string) => call<SearchHit[]>(C.GLOBAL_SEARCH, { query }),
  exportCsv: (kind: CsvReportKind, dateFrom: string | null, dateTo: string | null, destination: string) =>
    call<string>(C.EXPORT_CSV, { kind, dateFrom, dateTo, destination }),

  // Configuración y datos
  getBusinessSettings: () => call<BusinessSettings>(C.GET_BUSINESS_SETTINGS),
  saveBusinessSettings: (settings: BusinessSettings) => call<BusinessSettings>(C.SAVE_BUSINESS_SETTINGS, { settings }),
  getDataLocation: () => call<DataLocationInfo>(C.GET_DATA_LOCATION),
  saveAutoBackup: (enabled: boolean, keep: number) => call<DataLocationInfo>(C.SAVE_AUTO_BACKUP_SETTINGS, { enabled, keep }),
  createManualBackup: () => call<string>(C.CREATE_MANUAL_BACKUP),
  exportBackup: (destination: string) => call<string>(C.EXPORT_BACKUP, { destination }),
  restoreBackup: (source: string) => call<RestoreResult>(C.RESTORE_BACKUP, { source }),
  moveDataLocation: (newDir: string) => call<DataLocationInfo>(C.MOVE_DATA_LOCATION, { newDir }),
  useExistingDataLocation: (dir: string) => call<SystemOverview>(C.USE_EXISTING_DATA_LOCATION, { dir }),
  /** Primera ejecución: dónde guardar los datos. */
  setupDataLocation: (mode: SetupDataMode, dir: string | null) => call<SystemOverview>(C.SETUP_DATA_LOCATION, { mode, dir }),
};

// ------------------------------------------------------------------ Diálogos nativos

/** Abre el selector nativo de carpetas. En vista previa usa una ruta escrita a mano. */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isDesktop()) {
    return window.prompt(`${title}\n(Vista previa: escribe una ruta de ejemplo)`, "C:\\Respaldos") || null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === "string" ? result : null;
}

export async function pickBackupFile(title: string): Promise<string | null> {
  if (!isDesktop()) {
    return window.prompt(`${title}\n(Vista previa: escribe una ruta de ejemplo)`, "C:\\Respaldos\\copia.sqlite3") || null;
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    multiple: false,
    directory: false,
    title,
    filters: [{ name: "Respaldo de Cartucho ERP", extensions: ["sqlite3", "sqlite", "db"] }],
  });
  return typeof result === "string" ? result : null;
}

export async function pickSavePath(title: string, defaultName: string, ext: string, label: string): Promise<string | null> {
  if (!isDesktop()) {
    return window.prompt(`${title}\n(Vista previa: escribe una ruta de ejemplo)`, `C:\\Documentos\\${defaultName}`) || null;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const result = await save({ title, defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] });
  return result ?? null;
}

/** Avisa cuando la verificación periódica cambia la licencia (modo o módulos). */
export function onLicenseChanged(handler: () => void): () => void {
  if (!isDesktop()) {
    const h = () => handler();
    window.addEventListener("cartucho-license-changed", h);
    return () => window.removeEventListener("cartucho-license-changed", h);
  }
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen(LICENSE_CHANGED_EVENT, () => handler()).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    }),
  );
  return () => {
    cancelled = true;
    unlisten?.();
  };
}
