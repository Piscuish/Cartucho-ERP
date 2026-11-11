/**
 * Backend de VISTA PREVIA para ejecutar la interfaz en un navegador (`pnpm dev`).
 *
 * - Imita los comandos de Rust para poder diseñar y probar pantallas sin Tauri.
 * - Guarda los datos en `localStorage` del navegador: NO es la base de datos real
 *   y no debe usarse para información de negocio.
 * - La contraseña de prueba se guarda como hash SHA-256 (nunca en texto plano).
 */
import type {
  BusinessSettings,
  Category,
  CompanyProfile,
  Customer,
  DashboardData,
  DataLocationInfo,
  Expense,
  FinanceSummary,
  InventoryMovement,
  InvoiceDetail,
  InvoiceSummary,
  Appearance,
  Role,
  UserAccount,
  LicenseMode,
  LicenseStatus,
  ModuleKey,
  Payment,
  Product,
  QuoteDetail,
  SearchHit,
  SystemOverview,
} from "@cartucho/shared";
import { ACCENTS, ALL_MODULES, DARK_BACKGROUNDS, DEFAULT_APPEARANCE, LAYOUTS, LIGHT_BACKGROUNDS } from "@cartucho/shared";

const KEY = "cartucho_erp_preview_v4";
const SESSION_KEY = "cartucho_erp_preview_session";

interface Store {
  startupCount: number;
  firstInitializedAt: string;
  theme: string;
  appearance?: Appearance;
  roles?: PreviewRole[];
  users?: PreviewUser[];
  company: CompanyProfile | null;
  admin: { id: number; fullName: string; username: string; passwordSha256: string; createdAt: string; lastLoginAt: string | null } | null;
  seq: Record<string, number>;
  categories: Category[];
  customers: Omit<Customer, "invoiceCount" | "totalInvoiced" | "balanceDue">[];
  products: (Omit<Product, "isLowStock" | "categoryName">)[];
  movements: InventoryMovement[];
  invoices: (InvoiceDetail & { lineCosts: number[] })[];
  quotes: QuoteDetail[];
  expenses: Expense[];
  settings: BusinessSettings;
  meta: Record<string, string>;
}

const now = () => new Date().toISOString();
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function fresh(): Store {
  const t = now();
  const expenseCats = [
    "Arriendo",
    "Servicios públicos (luz, agua, gas)",
    "Internet y teléfono",
    "Nómina y pagos a personal",
    "Transporte y envíos",
    "Mantenimiento y reparaciones",
    "Publicidad",
    "Impuestos y trámites",
    "Compras de inventario",
    "Otros gastos",
  ];
  return {
    startupCount: 0,
    firstInitializedAt: t,
    theme: "system",
    company: null,
    admin: null,
    seq: { category: expenseCats.length + 1, customer: 0, product: 0, movement: 0, invoice: 0, line: 0, payment: 0, quote: 0, expense: 0 },
    categories: [
      ...expenseCats.map((name, i) => ({ id: i + 1, kind: "expense" as const, name, usageCount: 0 })),
      { id: expenseCats.length + 1, kind: "product" as const, name: "General", usageCount: 0 },
    ],
    customers: [],
    products: [],
    movements: [],
    invoices: [],
    quotes: [],
    expenses: [],
    settings: {
      invoicePrefix: "FAC-",
      invoiceNextNumber: 1,
      quotePrefix: "COT-",
      quoteNextNumber: 1,
      defaultDueDays: 0,
      defaultQuoteValidDays: 15,
      defaultNotes: "",
      defaultTerms: "",
      defaultFooter: "Gracias por su compra.",
      paperSize: "letter",
      showLogoOnPrint: true,
    },
    meta: { auto_backup_enabled: "1", auto_backup_keep: "0" },
  };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...(JSON.parse(raw) as Store) };
  } catch {
    /* almacenamiento no disponible */
  }
  return fresh();
}

let db: Store = load();
let sessionActive = (() => {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
})();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* sin almacenamiento: los datos viven solo en memoria */
  }
}

// ------------------------------------------------------------------ Usuarios y roles (vista previa)

interface PreviewRole {
  id: number;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: Record<string, "read" | "write">;
}
interface PreviewUser {
  id: number;
  fullName: string;
  username: string;
  roleKey: string;
  passwordSha256: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

const DEFAULT_ROLES: PreviewRole[] = [
  { id: 1, key: "admin", name: "Administrador", description: "Acceso total: usuarios, roles, empresa, licencia y respaldos.", isSystem: true, permissions: {} },
  {
    id: 2,
    key: "vendedor",
    name: "Vendedor",
    description: "Factura, cotiza y atiende clientes. Consulta productos e inventario.",
    isSystem: false,
    permissions: { invoices: "write", quotes: "write", customers: "write", catalog: "read", inventory: "read" },
  },
  {
    id: 3,
    key: "consulta",
    name: "Solo consulta",
    description: "Ve facturas, clientes y productos sin modificarlos.",
    isSystem: false,
    permissions: { invoices: "read", quotes: "read", customers: "read", catalog: "read", inventory: "read" },
  },
];

const roles = () => (db.roles ??= DEFAULT_ROLES.map((r) => ({ ...r, permissions: { ...r.permissions } })));
const users = () => (db.users ??= []);

let sessionUserId = (() => {
  try {
    return Number(sessionStorage.getItem(SESSION_KEY + "_uid") ?? "1") || 1;
  } catch {
    return 1;
  }
})();
function setSessionUser(id: number) {
  sessionUserId = id;
  try {
    sessionStorage.setItem(SESSION_KEY + "_uid", String(id));
  } catch {
    /* ignorar */
  }
}

/** Usuario de la sesión: el administrador inicial (id 1) o uno creado desde Usuarios. */
function sessionUser() {
  if (!sessionActive || !db.admin) return null;
  if (sessionUserId === db.admin.id) {
    return { id: db.admin.id, fullName: db.admin.fullName, username: db.admin.username, roleKey: "admin", createdAt: db.admin.createdAt, lastLoginAt: db.admin.lastLoginAt };
  }
  const u = users().find((x) => x.id === sessionUserId && x.isActive);
  return u ?? null;
}

function requireAdmin() {
  requireAuth();
  if (sessionUser()?.roleKey !== "admin") fail("Solo un administrador puede hacer esto.");
}

function roleView(r: PreviewRole): Role {
  const count = users().filter((u) => u.roleKey === r.key).length + (r.key === "admin" ? 1 : 0);
  return { ...r, permissions: r.key === "admin" ? {} : (r.permissions as Role["permissions"]), userCount: count };
}

function accountView(u: PreviewUser): UserAccount {
  const r = roles().find((x) => x.key === u.roleKey);
  return { id: u.id, username: u.username, fullName: u.fullName, roleKey: u.roleKey, roleName: r?.name ?? u.roleKey, isActive: u.isActive, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt };
}

function setSession(v: boolean) {
  sessionActive = v;
  try {
    sessionStorage.setItem(SESSION_KEY, v ? "1" : "0");
  } catch {
    /* ignorar */
  }
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fail(msg: string): never {
  throw new Error(msg);
}

function requireAuth() {
  if (!sessionActive || !db.admin) fail("Acceso no autorizado: debes iniciar sesión con una cuenta válida para realizar esta operación.");
}

const nextId = (k: string) => (db.seq[k] = (db.seq[k] ?? 0) + 1);
const like = (v: string | null | undefined, q: string) => (v ?? "").toLowerCase().includes(q.toLowerCase().trim());
const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function overview(): SystemOverview {
  const authed = sessionActive && !!db.admin && !!sessionUser();
  return {
    appName: "Cartucho ERP",
    appVersion: "0.2.0",
    phase: "Fase 1 — Facturación y gestión local",
    architectureMode: "local-first",
    osPlatform: navigator.platform || "web",
    osArch: "—",
    runtimeMode: "browser-preview",
    preferences: {
      theme: db.theme as SystemOverview["preferences"]["theme"],
      appearance: db.appearance ?? { ...DEFAULT_APPEARANCE },
      updatedAt: now(),
    },
    database: {
      connected: true,
      engine: "SQLite",
      sqliteVersion: "Vista previa (navegador)",
      journalMode: "wal",
      foreignKeysEnabled: true,
      databasePath: "Vista previa: los datos viven en este navegador",
      appDataDir: "—",
      databaseSizeBytes: new Blob([JSON.stringify(db)]).size,
      schemaVersion: 4,
      appliedMigrations: [],
      startupCount: db.startupCount,
      firstInitializedAt: db.firstInitializedAt,
      lastOpenedAt: now(),
      recentPersistenceChecks: [],
    },
    company: db.company,
    license: licenseStatus(),
    hasAdminUser: !!db.admin,
    isAuthenticated: authed,
    currentUser: (() => {
      const u = authed ? sessionUser() : null;
      if (!u) return null;
      const r = roles().find((x) => x.key === u.roleKey);
      const isAdmin = u.roleKey === "admin";
      return {
        id: u.id,
        fullName: u.fullName,
        username: u.username,
        role: u.roleKey,
        roleName: r?.name ?? u.roleKey,
        isAdmin,
        permissions: isAdmin ? ["*"] : Object.entries(r?.permissions ?? {}).map(([m, l]) => `${m}:${l}`),
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      };
    })(),
  };
}

// ------------------------------------------------------------------ Licencia simulada

/**
 * La vista previa simula la licencia para poder diseñar cada modo sin servidor.
 * Desde la consola: `__cartuchoLicencia("restricted")`, `__cartuchoLicencia("licensed", ["invoices", "customers"])`,
 * `__cartuchoLicencia("unlicensed")` o `__cartuchoLicencia("dev")`.
 */
interface PreviewLicense {
  mode: LicenseMode;
  modules: ModuleKey[];
}
const LICENSE_KEY = "cartucho_preview_license";

function loadLicense(): PreviewLicense {
  try {
    const raw = localStorage.getItem(LICENSE_KEY);
    if (raw) return JSON.parse(raw) as PreviewLicense;
  } catch {
    /* ignorar */
  }
  return { mode: "dev", modules: [...ALL_MODULES] };
}

function saveLicense(l: PreviewLicense) {
  try {
    localStorage.setItem(LICENSE_KEY, JSON.stringify(l));
  } catch {
    /* ignorar */
  }
}

function licenseStatus(): LicenseStatus {
  const l = loadLicense();
  const base: LicenseStatus = {
    mode: l.mode,
    reason: null,
    message: null,
    customer: null,
    plan: null,
    modules: l.mode === "restricted" ? ["invoices"] : l.mode === "unlicensed" ? [] : l.modules,
    maxDevices: null,
    validUntil: null,
    daysLeft: null,
    licenseExpiresAt: null,
    lastCheckAt: null,
    lastCheckError: null,
    deviceCode: "PREV-IEW0-0000-0000",
    serverConfigured: false,
    licenseKeyMasked: null,
    support: "WhatsApp +57 300 000 0000",
  };
  if (l.mode === "licensed" || l.mode === "restricted") {
    const until = new Date(Date.now() + 30 * 86400000).toISOString();
    Object.assign(base, {
      customer: db.company?.tradeName ?? "Cliente de prueba",
      plan: l.modules.length === ALL_MODULES.length ? "completo" : "personalizado",
      maxDevices: 2,
      validUntil: until,
      daysLeft: 30,
      lastCheckAt: now(),
      licenseKeyMasked: "CE-••••-••••-••••-7K2M",
    });
  }
  if (l.mode === "restricted") {
    base.reason = "revoked";
    base.message = "Tu licencia fue desactivada. Solo puedes consultar tus facturas. Contacta a soporte para reactivarla.";
  }
  if (l.mode === "unlicensed") {
    base.reason = "not_activated";
    base.message = "Este equipo aún no tiene una licencia activa.";
  }
  if (l.mode === "dev") {
    base.message = "Modo desarrollo: todos los módulos habilitados.";
  }
  return base;
}

/** Comandos permitidos en modo restringido (como en Rust). */
const RESTRICTED_ALLOWED = new Set([
  "get_system_overview", "login_user", "logout_user", "change_user_password", "set_theme_preference", "set_appearance", "list_roles", "save_role", "delete_role", "list_users", "save_user",
  "list_invoices", "get_invoice", "list_payments", "get_dashboard", "global_search",
  "get_business_settings", "get_data_location", "export_backup", "create_manual_backup",
  "get_license_status", "activate_license_online", "activate_license_offline", "check_license_now",
  "retry_open_database", "reset_data_location", "list_categories",
]);

function applyCompany(input: Record<string, unknown>) {
  const tradeName = String(input.tradeName ?? "").trim();
  if (!tradeName) fail("El nombre comercial de la empresa es obligatorio.");
  const prev = db.company;
  let logoDataUrl = prev?.logoDataUrl ?? null;
  let logoMimeType = prev?.logoMimeType ?? null;
  if (input.removeLogo) {
    logoDataUrl = null;
    logoMimeType = null;
  } else if (typeof input.logoBase64 === "string" && input.logoBase64) {
    logoMimeType = String(input.logoMimeType);
    logoDataUrl = input.logoBase64.startsWith("data:") ? input.logoBase64 : `data:${logoMimeType};base64,${input.logoBase64}`;
  }
  db.company = {
    tradeName,
    legalName: opt(input.legalName),
    taxId: opt(input.taxId),
    address: opt(input.address),
    phone: opt(input.phone),
    email: opt(input.email),
    logoDataUrl,
    logoMimeType,
    businessProfileKey: "general",
    commercialPlanKey: "local-standard",
    enabledModuleKeys: [],
    enabledAddonKeys: [],
    createdAt: prev?.createdAt ?? now(),
    updatedAt: now(),
  };
}

function customerView(c: Store["customers"][number]): Customer {
  const inv = db.invoices.filter((i) => i.customerId === c.id && i.status !== "void");
  return {
    ...c,
    invoiceCount: inv.length,
    totalInvoiced: inv.reduce((s, i) => s + i.total, 0),
    balanceDue: inv.reduce((s, i) => s + (i.total - i.paidAmount), 0),
  };
}

function productView(p: Store["products"][number]): Product {
  return {
    ...p,
    categoryName: db.categories.find((c) => c.id === p.categoryId)?.name ?? null,
    isLowStock: p.trackStock && p.stockQty <= p.minStock,
  };
}

function stockChange(pid: number, delta: number, kind: InventoryMovement["kind"], unitCost: number | null, ref: [string, number] | null, note: string | null) {
  const p = db.products.find((x) => x.id === pid) ?? fail("El producto no existe.");
  if (!p.trackStock) return;
  p.stockQty = Math.round((p.stockQty + delta) * 1000) / 1000;
  p.updatedAt = now();
  db.movements.unshift({
    id: nextId("movement"),
    productId: pid,
    productName: p.name,
    kind,
    quantity: delta,
    unitCost,
    stockAfter: p.stockQty,
    referenceType: ref?.[0] ?? null,
    referenceId: ref?.[1] ?? null,
    referenceLabel: ref ? db.invoices.find((i) => i.id === ref[1])?.number ?? null : null,
    note,
    createdAt: now(),
  });
}

function statusFor(total: number, paid: number) {
  return paid >= total ? "paid" : paid > 0 ? "partial" : "pending";
}

function buildDoc(input: Record<string, unknown>) {
  const issueDate = String(input.issueDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) fail("La fecha de emisión no es válida.");
  const lines = (input.lines as Array<Record<string, unknown>>) ?? [];
  if (lines.length === 0) fail("Agrega al menos un producto o servicio.");
  let customer = { name: "Consumidor final", documentId: null as string | null, phone: null as string | null, email: null as string | null, address: null as string | null };
  const cid = (input.customerId as number | null) ?? null;
  if (cid) {
    const c = db.customers.find((x) => x.id === cid) ?? fail("El cliente seleccionado no existe.");
    customer = { name: c.name, documentId: c.documentId, phone: c.phone, email: c.email, address: c.address };
  } else if (input.customer) {
    const c = input.customer as Record<string, unknown>;
    customer = {
      name: opt(c.name) ?? "Consumidor final",
      documentId: opt(c.documentId),
      phone: opt(c.phone),
      email: opt(c.email),
      address: opt(c.address),
    };
  }
  let total = 0;
  const costs: number[] = [];
  const out = lines.map((l, i) => {
    const q = Number(l.quantity);
    const price = Number(l.unitPrice);
    if (!(q > 0)) fail(`La cantidad de la línea ${i + 1} debe ser mayor a cero.`);
    if (!(price >= 0)) fail(`El precio de la línea ${i + 1} no es válido.`);
    const pid = (l.productId as number | null) ?? null;
    const p = pid ? db.products.find((x) => x.id === pid) : null;
    if (pid && !p) fail(`El producto de la línea ${i + 1} no existe.`);
    const desc = String(l.description ?? "").trim() || p?.name || fail(`El campo 'Descripción de la línea ${i + 1}' es obligatorio.`);
    const lt = Math.round(q * price);
    total += lt;
    costs.push(p?.cost ?? 0);
    return { id: nextId("line"), position: i + 1, productId: pid, description: desc, quantity: q, unitPrice: price, lineTotal: lt };
  });
  return { customerId: cid, customer, issueDate, lines: out, total, costs };
}

function invoiceSummary(i: InvoiceDetail): InvoiceSummary {
  const { id, number, customerId, customerName, issueDate, dueDate, status, total, paidAmount, createdAt } = i;
  return { id, number, customerId, customerName, issueDate, dueDate, status, total, paidAmount, balance: status === "void" ? 0 : total - paidAmount, createdAt };
}

function payment(invoiceId: number, p: Record<string, unknown>) {
  const inv = db.invoices.find((i) => i.id === invoiceId) ?? fail("La factura no existe.");
  if (inv.status === "void") fail("No se pueden registrar pagos en una factura anulada.");
  const amount = Math.round(Number(p.amount));
  if (!(amount > 0)) fail("El valor del pago debe ser mayor a cero.");
  if (amount > inv.total - inv.paidAmount) fail("El pago supera el saldo pendiente de la factura.");
  inv.payments.push({
    id: nextId("payment"),
    invoiceId,
    invoiceNumber: inv.number,
    customerName: inv.customerName,
    amount,
    method: p.method as Payment["method"],
    paidAt: String(p.paidAt),
    note: opt(p.note),
    invoiceVoided: false,
    createdAt: now(),
  });
  inv.paidAmount += amount;
  inv.status = statusFor(inv.total, inv.paidAmount);
  inv.balance = inv.total - inv.paidAmount;
}

function createInvoice(input: Record<string, unknown>, quote: QuoteDetail | null = null): InvoiceDetail {
  const doc = buildDoc(input);
  const number = `${db.settings.invoicePrefix}${String(db.settings.invoiceNextNumber).padStart(5, "0")}`;
  db.settings.invoiceNextNumber += 1;
  const id = nextId("invoice");
  const inv: InvoiceDetail & { lineCosts: number[] } = {
    id,
    number,
    customerId: doc.customerId,
    customerName: doc.customer.name,
    issueDate: doc.issueDate,
    dueDate: opt(input.dueDate),
    status: doc.total === 0 ? "paid" : "pending",
    total: doc.total,
    paidAmount: 0,
    balance: doc.total,
    createdAt: now(),
    customer: doc.customer,
    notes: opt(input.notes),
    terms: opt(input.terms),
    footer: opt(input.footer),
    quoteId: quote?.id ?? null,
    quoteNumber: quote?.number ?? null,
    voidReason: null,
    voidedAt: null,
    lines: doc.lines,
    payments: [],
    lineCosts: doc.costs,
  };
  db.invoices.unshift(inv);
  doc.lines.forEach((l, idx) => {
    if (l.productId) stockChange(l.productId, -l.quantity, "sale", doc.costs[idx], ["invoice", id], `Venta ${number}`);
  });
  const ip = input.initialPayment as Record<string, unknown> | null;
  if (ip && Number(ip.amount) > 0) payment(id, ip);
  return inv;
}

function inRange(d: string, from: string | null, to: string | null) {
  return (!from || d >= from) && (!to || d <= to);
}

function summary(from: string, to: string): FinanceSummary {
  const inv = db.invoices.filter((i) => i.status !== "void" && inRange(i.issueDate, from, to));
  const pays = db.invoices.filter((i) => i.status !== "void").flatMap((i) => i.payments).filter((p) => inRange(p.paidAt, from, to));
  const exps = db.expenses.filter((e) => inRange(e.expenseDate, from, to));
  const invoicedTotal = inv.reduce((s, i) => s + i.total, 0);
  const cogs = inv.reduce((s, i) => s + i.lines.reduce((a, l, idx) => a + Math.round(l.quantity * (i.lineCosts[idx] ?? 0)), 0), 0);
  const op = exps.filter((e) => e.kind === "operating").reduce((s, e) => s + e.amount, 0);
  const invp = exps.filter((e) => e.kind === "inventory").reduce((s, e) => s + e.amount, 0);
  const collected = pays.reduce((s, p) => s + p.amount, 0);
  const group = <T,>(items: T[], key: (t: T) => string, val: (t: T) => number) => {
    const m = new Map<string, number>();
    items.forEach((t) => m.set(key(t), (m.get(key(t)) ?? 0) + val(t)));
    return [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  };
  const labels: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta", other: "Otro" };
  const [ty, tm] = to.split("-").map(Number);
  const monthly = Array.from({ length: 12 }, (_, k) => {
    const d = new Date(ty, tm - 1 - (11 - k), 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      month,
      invoiced: db.invoices.filter((i) => i.status !== "void" && i.issueDate.startsWith(month)).reduce((s, i) => s + i.total, 0),
      collected: db.invoices.filter((i) => i.status !== "void").flatMap((i) => i.payments).filter((p) => p.paidAt.startsWith(month)).reduce((s, p) => s + p.amount, 0),
      expenses: db.expenses.filter((e) => e.expenseDate.startsWith(month)).reduce((s, e) => s + e.amount, 0),
    };
  });
  const tp = new Map<string, { name: string; quantity: number; total: number }>();
  inv.flatMap((i) => i.lines).forEach((l) => {
    const k = l.productId ? `p${l.productId}` : l.description;
    const cur = tp.get(k) ?? { name: l.description, quantity: 0, total: 0 };
    cur.quantity += l.quantity;
    cur.total += l.lineTotal;
    tp.set(k, cur);
  });
  return {
    dateFrom: from,
    dateTo: to,
    invoiceCount: inv.length,
    invoicedTotal,
    collectedTotal: collected,
    receivableTotal: db.invoices.filter((i) => i.status === "pending" || i.status === "partial").reduce((s, i) => s + i.total - i.paidAmount, 0),
    operatingExpenses: op,
    inventoryPurchases: invp,
    costOfGoodsSold: cogs,
    grossProfit: invoicedTotal - cogs,
    netCashFlow: collected - op - invp,
    expensesByCategory: group(exps, (e) => db.categories.find((c) => c.id === e.categoryId)?.name ?? "Sin categoría", (e) => e.amount),
    paymentsByMethod: group(pays, (p) => labels[p.method], (p) => p.amount),
    monthly,
    topProducts: [...tp.values()].sort((a, b) => b.total - a.total).slice(0, 8),
  };
}

type Handler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

const handlers: Record<string, Handler> = {
  get_system_overview: () => {
    db.startupCount += 1;
    save();
    return overview();
  },
  retry_open_database: () => overview(),
  reset_data_location: () => overview(),
  complete_initial_setup: async ({ input }) => {
    if (db.admin) fail("Operación denegada: la configuración inicial ya fue completada.");
    const i = input as { company: Record<string, unknown>; admin: Record<string, string> };
    if ((i.admin.password ?? "").length < 8) fail("La contraseña debe tener al menos 8 caracteres.");
    if (i.admin.password !== i.admin.passwordConfirm) fail("La confirmación de la contraseña no coincide.");
    if ((i.admin.username ?? "").trim().length < 3) fail("El nombre de usuario debe tener al menos 3 caracteres.");
    applyCompany(i.company);
    db.admin = {
      id: 1,
      fullName: i.admin.fullName.trim(),
      username: i.admin.username.trim(),
      passwordSha256: await sha256(i.admin.password),
      createdAt: now(),
      lastLoginAt: now(),
    };
    setSession(true);
    save();
    return overview();
  },
  login_user: async ({ input }) => {
    const i = input as { username: string; password: string };
    const name = i.username.trim().toLowerCase();
    const hash = await sha256(i.password);
    if (db.admin && db.admin.username.toLowerCase() === name && db.admin.passwordSha256 === hash) {
      db.admin.lastLoginAt = now();
      setSessionUser(db.admin.id);
    } else {
      const u = users().find((x) => x.username.toLowerCase() === name && x.isActive && x.passwordSha256 === hash);
      if (!u) fail("Credenciales incorrectas. Verifica tu usuario y contraseña.");
      u.lastLoginAt = now();
      setSessionUser(u.id);
    }
    setSession(true);
    save();
    return overview();
  },
  logout_user: () => {
    setSession(false);
    return overview();
  },
  change_user_password: async ({ input }) => {
    requireAuth();
    const i = input as { currentPassword: string; newPassword: string; newPasswordConfirm: string };
    const target = sessionUserId === db.admin!.id ? db.admin! : users().find((u) => u.id === sessionUserId)!;
    if (target.passwordSha256 !== (await sha256(i.currentPassword))) fail("La contraseña actual introducida es incorrecta.");
    if (i.newPassword.length < 8) fail("La nueva contraseña debe tener al menos 8 caracteres.");
    if (i.newPassword !== i.newPasswordConfirm) fail("La confirmación de la nueva contraseña no coincide.");
    target.passwordSha256 = await sha256(i.newPassword);
    save();
    return overview();
  },
  list_roles: () => {
    requireAdmin();
    return [...roles()].sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name)).map(roleView);
  },
  save_role: ({ input }) => {
    requireAdmin();
    const i = input as { id: number | null; name: string; description: string | null; permissions: Record<string, string> };
    const name = String(i.name ?? "").trim();
    if (!name) fail("El nombre del rol es obligatorio (máximo 40 caracteres).");
    if (roles().some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== i.id)) fail(`Ya existe un rol llamado «${name}».`);
    const licensed = new Set(licenseStatus().modules);
    const perms: Record<string, "read" | "write"> = {};
    for (const [m, l] of Object.entries(i.permissions ?? {})) {
      if (l !== "read" && l !== "write") continue;
      if (!licensed.has(m as ModuleKey)) fail(`El módulo «${m}» no está incluido en tu licencia.`);
      perms[m] = l;
    }
    let r = i.id ? roles().find((x) => x.id === i.id) : undefined;
    if (r) {
      r.name = name;
      r.description = i.description?.trim() || null;
      if (!r.isSystem) r.permissions = perms;
    } else {
      const id = Math.max(0, ...roles().map((x) => x.id)) + 1;
      r = { id, key: `rol_${id}`, name, description: i.description?.trim() || null, isSystem: false, permissions: perms };
      roles().push(r);
    }
    save();
    return roleView(r);
  },
  delete_role: ({ id }) => {
    requireAdmin();
    const r = roles().find((x) => x.id === id);
    if (!r) fail("El rol no existe.");
    if (r.isSystem) fail("El rol Administrador no se puede eliminar.");
    const n = users().filter((u) => u.roleKey === r.key).length;
    if (n) fail(`Hay ${n} ${n === 1 ? "usuario" : "usuarios"} con este rol. Asígnales otro rol antes de eliminarlo.`);
    db.roles = roles().filter((x) => x.id !== id);
    save();
    return null;
  },
  list_users: () => {
    requireAdmin();
    const admin: UserAccount = {
      id: db.admin!.id,
      username: db.admin!.username,
      fullName: db.admin!.fullName,
      roleKey: "admin",
      roleName: roles().find((r) => r.key === "admin")?.name ?? "Administrador",
      isActive: true,
      createdAt: db.admin!.createdAt,
      lastLoginAt: db.admin!.lastLoginAt,
    };
    return [admin, ...users().map(accountView)];
  },
  save_user: async ({ input }) => {
    requireAdmin();
    const i = input as { id: number | null; fullName: string; username: string; roleKey: string; password: string | null; isActive: boolean };
    const fullName = String(i.fullName ?? "").trim();
    const username = String(i.username ?? "").trim();
    if (!fullName) fail("El nombre es obligatorio (máximo 120 caracteres).");
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) fail("El nombre de usuario debe tener entre 3 y 40 caracteres, sin espacios ni tildes.");
    if (!roles().some((r) => r.key === i.roleKey)) fail("Elige un rol válido.");
    const taken = username.toLowerCase() === db.admin!.username.toLowerCase() ? db.admin!.id : users().find((u) => u.username.toLowerCase() === username.toLowerCase())?.id;
    if (taken !== undefined && taken !== i.id) fail(`El usuario «${username}» ya existe.`);
    if (i.password && i.password.length < 8) fail("La contraseña debe tener al menos 8 caracteres.");
    if (i.id === db.admin!.id) {
      if (i.roleKey !== "admin" || !i.isActive) fail("No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.");
      db.admin!.fullName = fullName;
      db.admin!.username = username;
      if (i.password) db.admin!.passwordSha256 = await sha256(i.password);
      save();
      return (handlers.list_users({}) as UserAccount[])[0];
    }
    let u = i.id ? users().find((x) => x.id === i.id) : undefined;
    if (u) {
      Object.assign(u, { fullName, username, roleKey: i.roleKey, isActive: !!i.isActive });
      if (i.password) u.passwordSha256 = await sha256(i.password);
    } else {
      if (!i.password) fail("Escribe una contraseña para el nuevo usuario.");
      u = { id: Math.max(1, ...users().map((x) => x.id)) + 1, fullName, username, roleKey: i.roleKey, passwordSha256: await sha256(i.password), isActive: !!i.isActive, createdAt: now(), lastLoginAt: null };
      users().push(u);
    }
    save();
    return accountView(u);
  },
  set_appearance: ({ appearance, theme }) => {
    requireAdmin();
    const a = appearance as Appearance;
    const ok =
      LAYOUTS.some((x) => x.id === a?.layout) &&
      LIGHT_BACKGROUNDS.some((x) => x.id === a?.bgLight) &&
      DARK_BACKGROUNDS.some((x) => x.id === a?.bgDark) &&
      ACCENTS.some((x) => x.id === a?.accent);
    if (!ok) fail("Apariencia no válida.");
    db.appearance = { layout: a.layout, bgLight: a.bgLight, bgDark: a.bgDark, accent: a.accent, tintedBorders: !!a.tintedBorders };
    if (theme) db.theme = String(theme);
    save();
    return overview();
  },
  set_theme_preference: ({ theme }) => {
    requireAuth();
    db.theme = String(theme);
    save();
    return overview();
  },
  save_company_profile: ({ input }) => {
    requireAuth();
    applyCompany(input as Record<string, unknown>);
    save();
    return overview();
  },
  record_persistence_check: () => overview(),

  list_customers: ({ search, includeInactive }) => {
    requireAuth();
    return db.customers
      .filter((c) => (includeInactive || c.isActive) && (like(c.name, String(search ?? "")) || like(c.documentId, String(search ?? "")) || like(c.phone, String(search ?? ""))))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
      .map(customerView);
  },
  save_customer: ({ input }) => {
    requireAuth();
    const i = input as Record<string, unknown>;
    const name = opt(i.name) ?? fail("El campo 'Nombre' es obligatorio.");
    const email = opt(i.email);
    if (email && !email.includes("@")) fail("El correo electrónico no tiene un formato válido.");
    const data = { name, documentId: opt(i.documentId), phone: opt(i.phone), email, address: opt(i.address), notes: opt(i.notes) };
    let c = i.id ? db.customers.find((x) => x.id === i.id) : undefined;
    if (c) Object.assign(c, data, { updatedAt: now() });
    else {
      c = { id: nextId("customer"), ...data, isActive: true, createdAt: now(), updatedAt: now() };
      db.customers.push(c);
    }
    save();
    return customerView(c);
  },
  set_customer_active: ({ id, active }) => {
    requireAuth();
    const c = db.customers.find((x) => x.id === id) ?? fail("El cliente no existe.");
    c.isActive = Boolean(active);
    save();
    return customerView(c);
  },

  list_categories: ({ kind }) => {
    requireAuth();
    return db.categories
      .filter((c) => c.kind === kind)
      .map((c) => ({ ...c, usageCount: db.products.filter((p) => p.categoryId === c.id).length + db.expenses.filter((e) => e.categoryId === c.id).length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
  save_category: ({ id, kind, name }) => {
    requireAuth();
    const n = opt(name) ?? fail("El campo 'Nombre de categoría' es obligatorio.");
    if (db.categories.some((c) => c.kind === kind && c.name.toLowerCase() === n.toLowerCase() && c.id !== id)) fail("Ya existe una categoría con ese nombre.");
    let c = id ? db.categories.find((x) => x.id === id) : undefined;
    if (c) c.name = n;
    else {
      c = { id: nextId("category"), kind: kind as Category["kind"], name: n, usageCount: 0 };
      db.categories.push(c);
    }
    save();
    return c;
  },
  delete_category: ({ id }) => {
    requireAuth();
    if (db.products.some((p) => p.categoryId === id) || db.expenses.some((e) => e.categoryId === id)) fail("La categoría está en uso. Cambia primero los productos o gastos que la usan.");
    db.categories = db.categories.filter((c) => c.id !== id);
    save();
  },

  list_products: ({ search, categoryId, includeInactive, onlyLowStock }) => {
    requireAuth();
    const q = String(search ?? "");
    return db.products
      .map(productView)
      .filter((p) => (includeInactive || p.isActive) && (!categoryId || p.categoryId === categoryId) && (like(p.name, q) || like(p.sku, q) || like(p.description, q)) && (!onlyLowStock || (p.isLowStock && p.isActive)))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));
  },
  save_product: ({ input }) => {
    requireAuth();
    const i = input as Record<string, unknown>;
    const name = opt(i.name) ?? fail("El campo 'Nombre' es obligatorio.");
    const sku = opt(i.sku);
    if (sku && db.products.some((p) => p.sku?.toLowerCase() === sku.toLowerCase() && p.id !== i.id)) fail("Ya existe un producto con ese código (SKU).");
    const data = {
      sku,
      name,
      description: opt(i.description),
      categoryId: (i.categoryId as number | null) ?? null,
      unit: opt(i.unit) ?? "und",
      price: Math.max(0, Math.round(Number(i.price) || 0)),
      cost: Math.max(0, Math.round(Number(i.cost) || 0)),
      trackStock: Boolean(i.trackStock),
      minStock: Math.max(0, Number(i.minStock) || 0),
    };
    let p = i.id ? db.products.find((x) => x.id === i.id) : undefined;
    if (p) Object.assign(p, data, { updatedAt: now() });
    else {
      p = { id: nextId("product"), ...data, stockQty: 0, imageDataUrl: null, isActive: true, createdAt: now(), updatedAt: now() };
      db.products.push(p);
      const initial = Number(i.initialStock) || 0;
      if (data.trackStock && initial > 0) stockChange(p.id, initial, "initial", data.cost, null, "Existencia inicial");
    }
    if (i.removeImage) p.imageDataUrl = null;
    else if (typeof i.imageBase64 === "string" && i.imageBase64) p.imageDataUrl = `data:${i.imageMimeType};base64,${i.imageBase64}`;
    save();
    return productView(p);
  },
  set_product_active: ({ id, active }) => {
    requireAuth();
    const p = db.products.find((x) => x.id === id) ?? fail("El producto no existe.");
    p.isActive = Boolean(active);
    save();
    return productView(p);
  },
  adjust_stock: ({ input }) => {
    requireAuth();
    const i = input as Record<string, unknown>;
    const p = db.products.find((x) => x.id === i.productId) ?? fail("El producto no existe.");
    if (!p.trackStock) fail("Este producto no controla inventario.");
    const qty = Number(i.quantity);
    if (i.kind === "purchase") {
      if (!(qty > 0)) fail("La cantidad de la compra debe ser mayor a cero.");
      const cost = i.unitCost == null ? null : Math.round(Number(i.unitCost));
      stockChange(p.id, qty, "purchase", cost, null, opt(i.note));
      if (cost && cost > 0) p.cost = cost;
      if (i.recordExpense) {
        const amount = Math.round(qty * (cost ?? 0));
        if (amount <= 0) fail("Para registrar el gasto indica el costo unitario de la compra.");
        db.expenses.unshift({
          id: nextId("expense"),
          kind: "inventory",
          categoryId: db.categories.find((c) => c.name === "Compras de inventario")?.id ?? null,
          categoryName: "Compras de inventario",
          description: `Compra de inventario: ${p.name} × ${qty}`,
          amount,
          expenseDate: String(i.expenseDate ?? today()),
          method: (i.method as Expense["method"]) ?? "cash",
          supplier: opt(i.supplier),
          note: opt(i.note),
          productId: p.id,
          createdAt: now(),
        });
      }
    } else {
      if (!(qty >= 0)) fail("El conteo físico debe ser un número mayor o igual a cero.");
      const delta = qty - p.stockQty;
      if (Math.abs(delta) < 0.0005) fail("El conteo coincide con la existencia actual; no hay nada que ajustar.");
      stockChange(p.id, delta, "adjustment", null, null, opt(i.note) ?? "Ajuste por conteo físico");
    }
    save();
    return productView(p);
  },
  list_inventory_movements: ({ productId, limit }) => {
    requireAuth();
    return db.movements.filter((m) => !productId || m.productId === productId).slice(0, Number(limit) || 200);
  },

  create_invoice: ({ input }) => {
    requireAuth();
    const inv = createInvoice(input as Record<string, unknown>);
    save();
    return inv;
  },
  list_invoices: ({ filter }) => {
    requireAuth();
    const f = (filter ?? {}) as Record<string, string | number | null>;
    const q = String(f.search ?? "");
    return db.invoices
      .filter(
        (i) =>
          (like(i.number, q) || like(i.customerName, q)) &&
          (!f.status || (f.status === "open" ? i.status === "pending" || i.status === "partial" : i.status === f.status)) &&
          inRange(i.issueDate, (f.dateFrom as string) || null, (f.dateTo as string) || null) &&
          (!f.customerId || i.customerId === f.customerId),
      )
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id)
      .slice(0, Number(f.limit) || 500)
      .map(invoiceSummary);
  },
  get_invoice: ({ id }) => {
    requireAuth();
    const inv = db.invoices.find((i) => i.id === id) ?? fail("La factura no existe.");
    return { ...inv, payments: inv.payments.map((p) => ({ ...p, invoiceVoided: inv.status === "void" })) };
  },
  add_payment: ({ invoiceId, payment: p }) => {
    requireAuth();
    payment(Number(invoiceId), p as Record<string, unknown>);
    save();
    return handlers.get_invoice({ id: invoiceId });
  },
  void_invoice: ({ invoiceId, reason }) => {
    requireAuth();
    const inv = db.invoices.find((i) => i.id === invoiceId) ?? fail("La factura no existe.");
    if (inv.status === "void") fail("La factura ya está anulada.");
    if (!opt(reason)) fail("El campo 'Motivo de anulación' es obligatorio.");
    inv.lines.forEach((l, idx) => {
      if (l.productId) stockChange(l.productId, l.quantity, "void_return", inv.lineCosts[idx], ["invoice", inv.id], `Anulación ${inv.number}`);
    });
    inv.status = "void";
    inv.balance = 0;
    inv.voidReason = String(reason);
    inv.voidedAt = now();
    save();
    return handlers.get_invoice({ id: invoiceId });
  },
  list_payments: ({ dateFrom, dateTo }) => {
    requireAuth();
    return db.invoices
      .flatMap((i) => i.payments.map((p) => ({ ...p, invoiceVoided: i.status === "void" })))
      .filter((p) => inRange(p.paidAt, (dateFrom as string) || null, (dateTo as string) || null))
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt));
  },

  create_quote: ({ input }) => {
    requireAuth();
    const i = input as Record<string, unknown>;
    const doc = buildDoc(i);
    const q: QuoteDetail = {
      id: nextId("quote"),
      number: `${db.settings.quotePrefix}${String(db.settings.quoteNextNumber++).padStart(5, "0")}`,
      customerId: doc.customerId,
      customerName: doc.customer.name,
      issueDate: doc.issueDate,
      validUntil: opt(i.validUntil),
      status: "open",
      total: doc.total,
      convertedInvoiceId: null,
      convertedInvoiceNumber: null,
      createdAt: now(),
      customer: doc.customer,
      notes: opt(i.notes),
      terms: opt(i.terms),
      footer: opt(i.footer),
      lines: doc.lines,
    };
    db.quotes.unshift(q);
    save();
    return q;
  },
  list_quotes: ({ search, status }) => {
    requireAuth();
    return db.quotes.filter((q) => (like(q.number, String(search ?? "")) || like(q.customerName, String(search ?? ""))) && (!status || q.status === status));
  },
  get_quote: ({ id }) => {
    requireAuth();
    return db.quotes.find((q) => q.id === id) ?? fail("La cotización no existe.");
  },
  cancel_quote: ({ id }) => {
    requireAuth();
    const q = db.quotes.find((x) => x.id === id) ?? fail("La cotización no existe.");
    if (q.status !== "open") fail("Solo se pueden cancelar cotizaciones abiertas.");
    q.status = "cancelled";
    save();
    return q;
  },
  convert_quote_to_invoice: ({ quoteId, issueDate, dueDate }) => {
    requireAuth();
    const q = db.quotes.find((x) => x.id === quoteId) ?? fail("La cotización no existe.");
    if (q.status !== "open") fail("Solo se pueden facturar cotizaciones abiertas.");
    const inv = createInvoice(
      { customerId: q.customerId, customer: q.customer, issueDate, dueDate, lines: q.lines, notes: q.notes, terms: q.terms, footer: q.footer },
      q,
    );
    q.status = "converted";
    q.convertedInvoiceId = inv.id;
    q.convertedInvoiceNumber = inv.number;
    save();
    return inv;
  },

  list_expenses: ({ dateFrom, dateTo, categoryId, search }) => {
    requireAuth();
    return db.expenses
      .filter((e) => inRange(e.expenseDate, (dateFrom as string) || null, (dateTo as string) || null) && (!categoryId || e.categoryId === categoryId) && (like(e.description, String(search ?? "")) || like(e.supplier, String(search ?? ""))))
      .map((e) => ({ ...e, categoryName: db.categories.find((c) => c.id === e.categoryId)?.name ?? null }))
      .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id - a.id);
  },
  save_expense: ({ input }) => {
    requireAuth();
    const i = input as Record<string, unknown>;
    const description = opt(i.description) ?? fail("El campo 'Descripción' es obligatorio.");
    const amount = Math.round(Number(i.amount));
    if (!(amount > 0)) fail("El valor de 'Valor' debe ser mayor a cero.");
    const data = {
      categoryId: (i.categoryId as number | null) ?? null,
      description,
      amount,
      expenseDate: String(i.expenseDate),
      method: i.method as Expense["method"],
      supplier: opt(i.supplier),
      note: opt(i.note),
    };
    let e = i.id ? db.expenses.find((x) => x.id === i.id) : undefined;
    if (e) Object.assign(e, data);
    else {
      e = { id: nextId("expense"), kind: "operating", categoryName: null, productId: null, createdAt: now(), ...data };
      db.expenses.unshift(e);
    }
    save();
    return { ...e, categoryName: db.categories.find((c) => c.id === e!.categoryId)?.name ?? null };
  },
  delete_expense: ({ id }) => {
    requireAuth();
    db.expenses = db.expenses.filter((e) => e.id !== id);
    save();
  },
  finance_summary: ({ dateFrom, dateTo }) => {
    requireAuth();
    return summary(String(dateFrom), String(dateTo));
  },
  get_dashboard: ({ today: t }): DashboardData => {
    requireAuth();
    const td = String(t);
    const open = db.invoices.filter((i) => i.status === "pending" || i.status === "partial");
    const overdue = open.filter((i) => i.dueDate && i.dueDate < td);
    return {
      today: td,
      month: summary(`${td.slice(0, 7)}-01`, td),
      todayCollected: db.invoices.filter((i) => i.status !== "void").flatMap((i) => i.payments).filter((p) => p.paidAt === td).reduce((s, p) => s + p.amount, 0),
      openInvoiceCount: open.length,
      overdueCount: overdue.length,
      overdueTotal: overdue.reduce((s, i) => s + i.total - i.paidAmount, 0),
      openQuoteCount: db.quotes.filter((q) => q.status === "open").length,
      productCount: db.products.filter((p) => p.isActive).length,
      customerCount: db.customers.filter((c) => c.isActive).length,
      lowStock: db.products.map(productView).filter((p) => p.isLowStock && p.isActive).slice(0, 8),
      recentInvoices: [...db.invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.id - a.id).slice(0, 8).map(invoiceSummary),
    };
  },
  global_search: ({ query }): SearchHit[] => {
    requireAuth();
    const q = String(query ?? "").trim();
    if (!q) return [];
    return [
      ...db.invoices.filter((i) => like(i.number, q) || like(i.customerName, q)).slice(0, 6).map((i) => ({ kind: "invoice" as const, id: i.id, title: `${i.number} · ${i.customerName}`, subtitle: i.issueDate })),
      ...db.customers.filter((c) => c.isActive && (like(c.name, q) || like(c.documentId, q))).slice(0, 6).map((c) => ({ kind: "customer" as const, id: c.id, title: c.name, subtitle: c.documentId ?? c.phone ?? "" })),
      ...db.products.filter((p) => p.isActive && (like(p.name, q) || like(p.sku, q))).slice(0, 6).map((p) => ({ kind: "product" as const, id: p.id, title: p.name, subtitle: p.sku ?? "" })),
      ...db.quotes.filter((x) => like(x.number, q) || like(x.customerName, q)).slice(0, 4).map((x) => ({ kind: "quote" as const, id: x.id, title: `${x.number} · ${x.customerName}`, subtitle: x.issueDate })),
    ];
  },
  export_csv: () => {
    requireAuth();
    fail("La exportación a archivos solo está disponible en la aplicación de escritorio.");
  },

  get_business_settings: () => {
    requireAuth();
    return db.settings;
  },
  save_business_settings: ({ settings }) => {
    requireAuth();
    const s = settings as BusinessSettings;
    if (s.invoiceNextNumber < db.settings.invoiceNextNumber) fail(`El siguiente número de factura no puede ser menor que el actual (${db.settings.invoiceNextNumber}).`);
    if (s.quoteNextNumber < db.settings.quoteNextNumber) fail(`El siguiente número de cotización no puede ser menor que el actual (${db.settings.quoteNextNumber}).`);
    db.settings = { ...s };
    save();
    return db.settings;
  },
  get_data_location: (): DataLocationInfo => {
    requireAuth();
    return {
      dataDir: "Vista previa (navegador)",
      databasePath: "Vista previa (navegador)",
      backupsDir: "—",
      defaultDataDir: "C:\\Users\\<usuario>\\AppData\\Local\\cartucho\\cartucho-erp\\data",
      isCustomLocation: false,
      databaseSizeBytes: new Blob([JSON.stringify(db)]).size,
      backupsTotalBytes: 0,
      backups: [],
      autoBackupEnabled: db.meta.auto_backup_enabled !== "0",
      autoBackupKeep: Number(db.meta.auto_backup_keep ?? 0),
      lastAutoBackupDate: null,
    };
  },
  save_auto_backup_settings: ({ enabled, keep }) => {
    requireAuth();
    db.meta.auto_backup_enabled = enabled ? "1" : "0";
    db.meta.auto_backup_keep = String(keep);
    save();
    return handlers.get_data_location({});
  },
  create_manual_backup: () => fail("Los respaldos solo están disponibles en la aplicación de escritorio."),
  export_backup: () => fail("Exportar la base de datos solo está disponible en la aplicación de escritorio."),
  restore_backup: () => fail("Restaurar respaldos solo está disponible en la aplicación de escritorio."),
  move_data_location: () => fail("Mover la carpeta de datos solo está disponible en la aplicación de escritorio."),
  use_existing_data_location: () => fail("Esta opción solo está disponible en la aplicación de escritorio."),
};

const licenseHandlers: Record<string, Handler> = {
  get_license_status: () => licenseStatus(),
  check_license_now: () => licenseStatus(),
  activate_license_offline: () => fail("La activación sin conexión solo está disponible en la aplicación de escritorio."),
  activate_license_online: ({ licenseKey }) => {
    const key = String(licenseKey ?? "").trim().toUpperCase();
    if (!/^CE(-[A-Z0-9]{4}){4}$/.test(key)) fail("La clave debe tener el formato CE-XXXX-XXXX-XXXX-XXXX.");
    saveLicense({ mode: "licensed", modules: [...ALL_MODULES] });
    return licenseStatus();
  },
};

export async function handlePreviewCommand(command: string, args: Record<string, unknown>): Promise<unknown> {
  const mode = loadLicense().mode;
  if (mode === "restricted" && !RESTRICTED_ALLOWED.has(command)) {
    throw "Tu licencia está desactivada. Solo puedes consultar tus facturas. Contacta a soporte.";
  }
  const h = handlers[command] ?? licenseHandlers[command];
  if (!h) throw new Error(`Comando no disponible en vista previa: ${command}`);
  // Pequeña espera para simular la comunicación con el backend.
  await new Promise((r) => setTimeout(r, 60));
  try {
    return await h(args);
  } catch (e) {
    throw e instanceof Error ? e.message : String(e);
  }
}

/**
 * Carga datos de demostración en la vista previa del navegador.
 * Uso desde la consola: `__cartuchoDemo()`.
 */
export async function seedDemo(): Promise<void> {
  db = fresh();
  setSession(false);
  await handlers.complete_initial_setup({
    input: {
      company: { tradeName: "Papelería El Cartucho", legalName: "Papelería El Cartucho S.A.S.", taxId: "901.555.222-1", address: "Cra 7 # 45-12, Bogotá", phone: "+57 310 555 1234", email: "ventas@elcartucho.co" },
      admin: { fullName: "Laura Gómez", username: "admin", password: "demo1234", passwordConfirm: "demo1234" },
    },
  });
  const cat = (name: string) => (handlers.save_category({ id: null, kind: "product", name }) as Category).id;
  const papeleria = cat("Papelería");
  const tinta = cat("Tintas y tóner");
  const servicios = cat("Servicios");
  const mk = (name: string, sku: string, price: number, cost: number, stock: number, min: number, categoryId: number, track = true) =>
    (handlers.save_product({ input: { name, sku, price, cost, initialStock: stock, minStock: min, categoryId, trackStock: track, unit: track ? "und" : "serv" } }) as Product).id;
  const p1 = mk("Resma papel carta 75 g", "PAP-001", 22000, 16500, 380, 40, papeleria);
  const p2 = mk("Cartucho HP 664 negro", "TIN-664N", 68000, 49000, 9, 6, tinta);
  const p3 = mk("Cuaderno argollado 100 h", "PAP-014", 9500, 5800, 320, 30, papeleria);
  const p4 = mk("Tóner Brother TN-1060", "TIN-1060", 95000, 61000, 4, 3, tinta);
  const p5 = mk("Impresión láser B/N", "SRV-IMP", 300, 90, 0, 0, servicios, false);
  const p6 = mk("Recarga de cartucho", "SRV-REC", 25000, 9000, 0, 0, servicios, false);
  const cust = (name: string, documentId: string, phone: string) => (handlers.save_customer({ input: { name, documentId, phone } }) as Customer).id;
  const c1 = cust("Colegio San Martín", "860.123.456-7", "601 555 0101");
  const c2 = cust("Andrés Ramírez", "1.020.345.678", "312 444 5566");
  const c3 = cust("Oficinas Delta S.A.S.", "900.765.432-1", "601 555 0199");
  const td = today();
  const d = (offset: number) => {
    const x = new Date();
    x.setDate(x.getDate() - offset);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  };
  const inv = (customerId: number | null, date: string, lines: Array<[number, number, number]>, pay: number | "all" | 0, method = "cash", due: string | null = null) =>
    createInvoice({
      customerId,
      issueDate: date,
      dueDate: due,
      lines: lines.map(([productId, quantity, unitPrice]) => ({ productId, description: "", quantity, unitPrice })),
      initialPayment: pay === 0 ? null : { amount: pay === "all" ? lines.reduce((s, l) => s + l[1] * l[2], 0) : pay, method, paidAt: date },
    });
  const op = (categoryId: number, description: string, amount: number, date: string, supplier: string, method: Expense["method"] = "transfer") =>
    db.expenses.unshift({ id: nextId("expense"), kind: "operating", categoryId, categoryName: null, description, amount, expenseDate: date, method, supplier, note: null, productId: null, createdAt: now() });
  for (let m = 5; m >= 1; m--) {
    inv(c1, d(m * 30 + 3), [[p1, 30 + m * 2, 22000], [p3, 25, 9500]], "all", "transfer");
    inv(null, d(m * 30 + 9), [[p5, 1800 + m * 120, 300], [p6, 18 + m, 25000]], "all");
    inv(c2, d(m * 30 + 15), [[p6, 6, 25000], [p3, 4, 9500]], "all", "card");
    op(1, "Arriendo local", 1800000, d(m * 30 + 1), "Inmobiliaria Centro");
    op(2, "Energía eléctrica", 210000 + m * 9000, d(m * 30 + 6), "Enel", "cash");
    op(3, "Internet fibra", 95000, d(m * 30 + 7), "Claro");
  }
  inv(c3, d(12), [[p2, 4, 68000], [p4, 2, 95000]], 200000, "transfer", d(2));
  inv(c2, d(4), [[p6, 3, 25000], [p3, 3, 9500]], "all", "cash");
  inv(c1, d(2), [[p1, 25, 22000], [p3, 30, 9500]], 0, "cash", addDaysLocal(td, 15));
  inv(null, d(1), [[p5, 900, 300], [p6, 8, 25000]], "all", "cash");
  inv(null, td, [[p5, 450, 300], [p3, 2, 9500]], "all", "cash");
  handlers.adjust_stock({ input: { productId: p1, kind: "purchase", quantity: 60, unitCost: 16500, recordExpense: true, expenseDate: d(8), method: "transfer", supplier: "Distribuidora Andina" } });
  op(1, "Arriendo local", 1800000, `${td.slice(0, 7)}-01`, "Inmobiliaria Centro");
  handlers.create_quote({ input: { customerId: c3, issueDate: d(1), validUntil: addDaysLocal(td, 14), lines: [{ productId: p4, description: "", quantity: 6, unitPrice: 92000 }] } });
  save();
}

function addDaysLocal(iso: string, n: number) {
  const [y, m, dd] = iso.split("-").map(Number);
  const x = new Date(y, m - 1, dd + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

if (typeof window !== "undefined") {
  (window as unknown as { __cartuchoLicencia: (mode: LicenseMode, modules?: ModuleKey[]) => void }).__cartuchoLicencia = (
    mode,
    modules = [...ALL_MODULES],
  ) => {
    saveLicense({ mode, modules });
    window.location.reload();
  };
  (window as unknown as { __cartuchoDemo: () => Promise<void> }).__cartuchoDemo = async () => {
    await seedDemo();
    window.location.reload();
  };
}
