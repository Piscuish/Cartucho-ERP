/**
 * Servidor de licencias de Cartucho ERP (Cloudflare Workers + D1).
 *
 * Público (lo usa la aplicación de escritorio):
 *   POST /v1/activate   { licenseKey, deviceCode, deviceName, os, appVersion }
 *   POST /v1/checkin    { licenseKey, deviceCode, deviceName, os, appVersion }
 *   → { ok: true, token } | { ok: false, error, message }
 *
 * Administración (Authorization: Bearer ADMIN_TOKEN):
 *   GET    /api/summary
 *   GET    /api/licenses
 *   POST   /api/licenses
 *   GET    /api/licenses/:key
 *   PATCH  /api/licenses/:key
 *   POST   /api/licenses/:key/offline-code   { deviceCode, deviceName? }
 *   POST   /api/devices/:id/revoke
 *   POST   /api/devices/:id/restore
 *   GET    /api/online
 *
 * El token que recibe la aplicación es `base64url(json).base64url(firma Ed25519)`; la firma
 * cubre el texto base64url del contenido. La aplicación lo verifica con la clave pública
 * incrustada, así que funciona sin Internet hasta `exp` (30 días después de la última validación).
 */

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  LICENSE_PRIVATE_KEY: string;
  ADMIN_TOKEN: string;
  SUPPORT_TEXT?: string;
}

// ------------------------------------------------------------------ Constantes

const OFFLINE_GRACE_SECS = 30 * 86400;
/** Un equipo se considera conectado si validó en los últimos 90 minutos (valida cada hora). */
const ONLINE_WINDOW_SECS = 90 * 60;
const ALL_MODULES = ["invoices", "quotes", "customers", "catalog", "inventory", "expenses", "finance"] as const;
type ModuleKey = (typeof ALL_MODULES)[number];

/** Planes predefinidos. «personalizado» usa la lista de módulos que se envíe. */
export const PLANS: Record<string, ModuleKey[]> = {
  basico: ["invoices", "customers"],
  tienda: ["invoices", "quotes", "customers", "catalog", "inventory"],
  completo: [...ALL_MODULES],
};

const REQUIRES: Partial<Record<ModuleKey, ModuleKey>> = { quotes: "invoices", inventory: "catalog", finance: "invoices" };

/** Mismo alfabeto que la aplicación: sin 0/O ni 1/I para evitar confusiones al dictar. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const KEY_RE = /^CE-[23456789A-HJ-NP-Z]{4}(-[23456789A-HJ-NP-Z]{4}){3}$/;
const DEVICE_RE = /^[23456789A-HJ-NP-Z]{4}(-[23456789A-HJ-NP-Z]{4}){3}$/;

// ------------------------------------------------------------------ Utilidades

const now = () => Math.floor(Date.now() / 1000);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const fail = (error: string, message: string, status = 200) => json({ ok: false, error, message }, status);

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function normalizeKey(raw: unknown): string | null {
  const clean = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = clean.startsWith("CE") ? clean.slice(2) : clean;
  if (body.length !== 16) return null;
  const key = `CE-${body.match(/.{4}/g)!.join("-")}`;
  return KEY_RE.test(key) ? key : null;
}

function normalizeDevice(raw: unknown): string | null {
  const clean = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 16) return null;
  const code = clean.match(/.{4}/g)!.join("-");
  return DEVICE_RE.test(code) ? code : null;
}

export function normalizeModules(list: unknown): ModuleKey[] {
  const set = new Set<ModuleKey>(
    (Array.isArray(list) ? list : []).filter((m): m is ModuleKey => (ALL_MODULES as readonly string[]).includes(m)),
  );
  // Quita módulos cuya dependencia no esté incluida (igual que la aplicación).
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of [...set]) {
      const req = REQUIRES[m];
      if (req && !set.has(req)) {
        set.delete(m);
        changed = true;
      }
    }
  }
  return ALL_MODULES.filter((m) => set.has(m));
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => ALPHABET[b % 32]).join("");
  return `CE-${chars.match(/.{4}/g)!.join("-")}`;
}

const clip = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n) || null);

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ------------------------------------------------------------------ Firma

let cachedKey: { pem: string; key: CryptoKey } | null = null;

async function signingKey(env: Env): Promise<CryptoKey> {
  const pem = (env.LICENSE_PRIVATE_KEY ?? "").trim();
  if (!pem) throw new Error("Falta el secreto LICENSE_PRIVATE_KEY.");
  if (cachedKey?.pem === pem) return cachedKey.key;
  const der = b64decode(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
  cachedKey = { pem, key };
  return key;
}

interface LicenseRow {
  key: string;
  customer: string;
  contact: string | null;
  plan: string;
  modules: string;
  max_devices: number;
  status: "active" | "revoked";
  expires_at: number | null;
  support: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

interface DeviceRow {
  id: number;
  license_key: string;
  device_code: string;
  device_name: string | null;
  os: string | null;
  app_version: string | null;
  status: "active" | "revoked";
  first_seen: number;
  last_seen: number;
  last_ip: string | null;
  last_country: string | null;
}

type TokenStatus = "active" | "revoked" | "device_revoked";

async function issueToken(env: Env, lic: LicenseRow, deviceCode: string, status: TokenStatus): Promise<string> {
  const t = now();
  const payload = {
    v: 1,
    lic: lic.key,
    customer: lic.customer,
    plan: lic.plan,
    modules: normalizeModules(JSON.parse(lic.modules)),
    maxDevices: lic.max_devices,
    device: deviceCode,
    status,
    iat: t,
    exp: t + OFFLINE_GRACE_SECS,
    licExp: lic.expires_at ?? null,
    support: lic.support || env.SUPPORT_TEXT || null,
  };
  const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, await signingKey(env), new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${b64url(new Uint8Array(sig))}`;
}

// ------------------------------------------------------------------ Datos

const getLicense = (env: Env, key: string) => env.DB.prepare("SELECT * FROM licenses WHERE key = ?").bind(key).first<LicenseRow>();

const getDevice = (env: Env, key: string, code: string) =>
  env.DB.prepare("SELECT * FROM devices WHERE license_key = ? AND device_code = ?").bind(key, code).first<DeviceRow>();

async function activeDeviceCount(env: Env, key: string): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM devices WHERE license_key = ? AND status = 'active'").bind(key).first<{ n: number }>();
  return r?.n ?? 0;
}

async function logEvent(env: Env, kind: string, licenseKey: string | null, deviceCode: string | null, detail: string | null, ip: string | null) {
  await env.DB.prepare("INSERT INTO events (license_key, device_code, kind, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(licenseKey, deviceCode, kind, detail, ip, now())
    .run();
}

interface ClientInfo {
  deviceName: string | null;
  os: string | null;
  appVersion: string | null;
  ip: string | null;
  country: string | null;
}

function clientInfo(req: Request, body: Record<string, unknown>): ClientInfo {
  const cf = (req as unknown as { cf?: { country?: string } }).cf;
  return {
    deviceName: clip(body.deviceName, 80),
    os: clip(body.os, 20),
    appVersion: clip(body.appVersion, 20),
    ip: req.headers.get("cf-connecting-ip"),
    country: cf?.country ?? null,
  };
}

async function registerDevice(env: Env, key: string, code: string, info: ClientInfo) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO devices (license_key, device_code, device_name, os, app_version, status, first_seen, last_seen, last_ip, last_country)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  )
    .bind(key, code, info.deviceName, info.os, info.appVersion, t, t, info.ip, info.country)
    .run();
}

async function touchDevice(env: Env, id: number, info: ClientInfo) {
  await env.DB.prepare(
    `UPDATE devices SET last_seen = ?, device_name = COALESCE(?, device_name), os = COALESCE(?, os),
       app_version = COALESCE(?, app_version), last_ip = COALESCE(?, last_ip), last_country = COALESCE(?, last_country)
     WHERE id = ?`,
  )
    .bind(now(), info.deviceName, info.os, info.appVersion, info.ip, info.country, id)
    .run();
}

const limitMessage = (max: number) =>
  `Esta licencia ya está activa en ${max} ${max === 1 ? "equipo" : "equipos"}, el máximo permitido. Contacta a soporte para liberar un equipo.`;

// ------------------------------------------------------------------ API pública

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function handleActivate(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const key = normalizeKey(body.licenseKey);
  const code = normalizeDevice(body.deviceCode);
  const info = clientInfo(req, body);
  if (!key) return fail("bad_key", "La clave de licencia no es válida. Debe verse así: CE-XXXX-XXXX-XXXX-XXXX.");
  if (!code) return fail("bad_device", "El código del equipo no es válido. Actualiza Cartucho ERP.");

  const lic = await getLicense(env, key);
  if (!lic) {
    await logEvent(env, "rejected", null, code, `clave inexistente ${key}`, info.ip);
    return fail("not_found", "Esa clave de licencia no existe. Revisa que esté bien escrita.");
  }
  if (lic.status === "revoked") {
    await logEvent(env, "rejected", key, code, "licencia desactivada", info.ip);
    return fail("revoked", "Esta licencia está desactivada. Contacta a soporte.");
  }
  if (lic.expires_at && now() > lic.expires_at) {
    return fail("expired", "Esta licencia venció. Contacta a soporte para renovarla.");
  }

  const dev = await getDevice(env, key, code);
  if (dev) {
    if (dev.status === "revoked") {
      await logEvent(env, "rejected", key, code, "equipo desactivado", info.ip);
      return fail("device_revoked", "Este equipo fue desactivado para esta licencia. Contacta a soporte.");
    }
    await touchDevice(env, dev.id, info);
  } else {
    if ((await activeDeviceCount(env, key)) >= lic.max_devices) {
      await logEvent(env, "rejected", key, code, `límite de equipos (${lic.max_devices})`, info.ip);
      return fail("device_limit", limitMessage(lic.max_devices));
    }
    await registerDevice(env, key, code, info);
  }
  await logEvent(env, "activate", key, code, info.deviceName, info.ip);
  return json({ ok: true, token: await issueToken(env, lic, code, "active") });
}

async function handleCheckin(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const key = normalizeKey(body.licenseKey);
  const code = normalizeDevice(body.deviceCode);
  const info = clientInfo(req, body);
  if (!key || !code) return fail("bad_request", "Solicitud de validación incompleta.");

  const lic = await getLicense(env, key);
  // Sin licencia en el servidor (no debería pasar: nunca se borran) → la app conserva su token.
  if (!lic) return fail("not_found", "La licencia no existe en el servidor. Contacta a soporte.");

  let dev = await getDevice(env, key, code);
  if (!dev) {
    // Equipo activado sin Internet o una copia nueva: se registra si hay cupo.
    if (lic.status === "active" && (await activeDeviceCount(env, key)) < lic.max_devices) {
      await registerDevice(env, key, code, info);
      await logEvent(env, "activate", key, code, `registrado en validación · ${info.deviceName ?? ""}`, info.ip);
      dev = await getDevice(env, key, code);
    } else {
      await logEvent(env, "rejected", key, code, "equipo no registrado sin cupo", info.ip);
      return json({ ok: true, token: await issueToken(env, lic, code, lic.status === "revoked" ? "revoked" : "device_revoked") });
    }
  } else {
    await touchDevice(env, dev.id, info);
  }

  const status: TokenStatus = lic.status === "revoked" ? "revoked" : dev?.status === "revoked" ? "device_revoked" : "active";
  return json({ ok: true, token: await issueToken(env, lic, code, status) });
}

// ------------------------------------------------------------------ API de administración

function isAdmin(req: Request, env: Env): boolean {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return !!env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 12 && !!token && timingSafeEqual(token, env.ADMIN_TOKEN);
}

function licenseView(l: LicenseRow, devices: { active: number; online: number; total: number }) {
  return {
    key: l.key,
    customer: l.customer,
    contact: l.contact,
    plan: l.plan,
    modules: normalizeModules(JSON.parse(l.modules)),
    maxDevices: l.max_devices,
    status: l.status,
    expiresAt: l.expires_at,
    support: l.support,
    notes: l.notes,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
    devices,
  };
}

function deviceView(d: DeviceRow, t = now()) {
  return {
    id: d.id,
    licenseKey: d.license_key,
    deviceCode: d.device_code,
    deviceName: d.device_name,
    os: d.os,
    appVersion: d.app_version,
    status: d.status,
    firstSeen: d.first_seen,
    lastSeen: d.last_seen,
    lastIp: d.last_ip,
    lastCountry: d.last_country,
    online: d.status === "active" && t - d.last_seen <= ONLINE_WINDOW_SECS,
  };
}

interface LicenseInput {
  customer?: unknown;
  contact?: unknown;
  plan?: unknown;
  modules?: unknown;
  maxDevices?: unknown;
  expiresAt?: unknown;
  support?: unknown;
  notes?: unknown;
  status?: unknown;
}

function resolvePlan(plan: unknown, modules: unknown): { plan: string; modules: ModuleKey[] } | string {
  const p = String(plan ?? "").toLowerCase();
  if (PLANS[p]) return { plan: p, modules: PLANS[p] };
  if (p === "personalizado") {
    const m = normalizeModules(modules);
    if (!m.includes("invoices")) return "Un plan personalizado debe incluir Facturas.";
    return { plan: p, modules: m };
  }
  return "Plan no válido. Usa basico, tienda, completo o personalizado.";
}

function parseMaxDevices(v: unknown): number | string {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : "Los equipos por licencia deben ser de 1 a 5.";
}

function parseExpires(v: unknown): number | null | string {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Math.floor(new Date(String(v)).getTime() / 1000);
  return Number.isFinite(n) && n > 0 ? n : "Fecha de vencimiento no válida.";
}

async function deviceCounts(env: Env): Promise<Map<string, { active: number; online: number; total: number }>> {
  const t = now();
  const rows = await env.DB.prepare(
    `SELECT license_key,
            SUM(status = 'active') AS active,
            SUM(status = 'active' AND last_seen >= ?) AS online,
            COUNT(*) AS total
       FROM devices GROUP BY license_key`,
  )
    .bind(t - ONLINE_WINDOW_SECS)
    .all<{ license_key: string; active: number; online: number; total: number }>();
  return new Map(rows.results.map((r) => [r.license_key, { active: r.active ?? 0, online: r.online ?? 0, total: r.total }]));
}

async function handleAdmin(req: Request, env: Env, path: string): Promise<Response> {
  if (!isAdmin(req, env)) return json({ ok: false, message: "No autorizado." }, 401);
  const method = req.method;
  const ip = req.headers.get("cf-connecting-ip");
  const parts = path.split("/").filter(Boolean); // ["api", ...]

  // GET /api/summary
  if (method === "GET" && parts[1] === "summary") {
    const t = now();
    const r = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM licenses) AS licenses,
              (SELECT COUNT(*) FROM licenses WHERE status = 'active') AS activeLicenses,
              (SELECT COUNT(*) FROM devices WHERE status = 'active') AS devices,
              (SELECT COUNT(*) FROM devices WHERE status = 'active' AND last_seen >= ?) AS online`,
    )
      .bind(t - ONLINE_WINDOW_SECS)
      .first();
    const events = await env.DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 30").all();
    return json({ ok: true, summary: r, events: events.results, plans: PLANS });
  }

  // GET /api/online
  if (method === "GET" && parts[1] === "online") {
    const t = now();
    const rows = await env.DB.prepare(
      `SELECT d.*, l.customer FROM devices d JOIN licenses l ON l.key = d.license_key
        WHERE d.status = 'active' AND d.last_seen >= ? ORDER BY d.last_seen DESC`,
    )
      .bind(t - ONLINE_WINDOW_SECS)
      .all<DeviceRow & { customer: string }>();
    return json({ ok: true, devices: rows.results.map((d) => ({ ...deviceView(d, t), customer: d.customer })) });
  }

  // /api/licenses
  if (parts[1] === "licenses" && parts.length === 2) {
    if (method === "GET") {
      const rows = await env.DB.prepare("SELECT * FROM licenses ORDER BY created_at DESC").all<LicenseRow>();
      const counts = await deviceCounts(env);
      return json({ ok: true, licenses: rows.results.map((l) => licenseView(l, counts.get(l.key) ?? { active: 0, online: 0, total: 0 })) });
    }
    if (method === "POST") {
      const b = (await readBody(req)) as LicenseInput;
      const customer = clip(b.customer, 120);
      if (!customer) return json({ ok: false, message: "Escribe el nombre del cliente." }, 400);
      const plan = resolvePlan(b.plan, b.modules);
      if (typeof plan === "string") return json({ ok: false, message: plan }, 400);
      const max = parseMaxDevices(b.maxDevices ?? 1);
      if (typeof max === "string") return json({ ok: false, message: max }, 400);
      const exp = parseExpires(b.expiresAt);
      if (typeof exp === "string") return json({ ok: false, message: exp }, 400);
      const t = now();
      let key = randomKey();
      for (let i = 0; i < 5 && (await getLicense(env, key)); i++) key = randomKey();
      await env.DB.prepare(
        `INSERT INTO licenses (key, customer, contact, plan, modules, max_devices, status, expires_at, support, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      )
        .bind(key, customer, clip(b.contact, 120), plan.plan, JSON.stringify(plan.modules), max, exp, clip(b.support, 160), clip(b.notes, 1000), t, t)
        .run();
      await logEvent(env, "admin_create", key, null, `${customer} · ${plan.plan} · ${max} equipos`, ip);
      const lic = (await getLicense(env, key))!;
      return json({ ok: true, license: licenseView(lic, { active: 0, online: 0, total: 0 }) });
    }
  }

  // /api/licenses/:key[/offline-code]
  if (parts[1] === "licenses" && parts[2]) {
    const key = normalizeKey(decodeURIComponent(parts[2]));
    const lic = key ? await getLicense(env, key) : null;
    if (!key || !lic) return json({ ok: false, message: "Licencia no encontrada." }, 404);

    if (method === "GET" && parts.length === 3) {
      const devs = await env.DB.prepare("SELECT * FROM devices WHERE license_key = ? ORDER BY status, last_seen DESC").bind(key).all<DeviceRow>();
      const events = await env.DB.prepare("SELECT * FROM events WHERE license_key = ? ORDER BY id DESC LIMIT 50").bind(key).all();
      const t = now();
      const views = devs.results.map((d) => deviceView(d, t));
      return json({
        ok: true,
        license: licenseView(lic, {
          active: views.filter((d) => d.status === "active").length,
          online: views.filter((d) => d.online).length,
          total: views.length,
        }),
        devices: views,
        events: events.results,
      });
    }

    if (method === "PATCH" && parts.length === 3) {
      const b = (await readBody(req)) as LicenseInput;
      const next = { ...lic };
      const changes: string[] = [];
      if (b.customer !== undefined) {
        const c = clip(b.customer, 120);
        if (!c) return json({ ok: false, message: "Escribe el nombre del cliente." }, 400);
        next.customer = c;
      }
      if (b.contact !== undefined) next.contact = clip(b.contact, 120);
      if (b.notes !== undefined) next.notes = clip(b.notes, 1000);
      if (b.support !== undefined) next.support = clip(b.support, 160);
      if (b.plan !== undefined || b.modules !== undefined) {
        const plan = resolvePlan(b.plan ?? lic.plan, b.modules ?? JSON.parse(lic.modules));
        if (typeof plan === "string") return json({ ok: false, message: plan }, 400);
        next.plan = plan.plan;
        next.modules = JSON.stringify(plan.modules);
        changes.push(`plan ${plan.plan}: ${plan.modules.join(", ")}`);
      }
      if (b.maxDevices !== undefined) {
        const max = parseMaxDevices(b.maxDevices);
        if (typeof max === "string") return json({ ok: false, message: max }, 400);
        next.max_devices = max;
        changes.push(`${max} equipos`);
      }
      if (b.expiresAt !== undefined) {
        const exp = parseExpires(b.expiresAt);
        if (typeof exp === "string") return json({ ok: false, message: exp }, 400);
        next.expires_at = exp;
        changes.push(exp ? `vence ${new Date(exp * 1000).toISOString().slice(0, 10)}` : "sin vencimiento");
      }
      if (b.status !== undefined) {
        if (b.status !== "active" && b.status !== "revoked") return json({ ok: false, message: "Estado no válido." }, 400);
        next.status = b.status;
        changes.push(b.status === "revoked" ? "licencia desactivada" : "licencia reactivada");
      }
      next.updated_at = now();
      await env.DB.prepare(
        `UPDATE licenses SET customer = ?, contact = ?, plan = ?, modules = ?, max_devices = ?, status = ?, expires_at = ?,
           support = ?, notes = ?, updated_at = ? WHERE key = ?`,
      )
        .bind(next.customer, next.contact, next.plan, next.modules, next.max_devices, next.status, next.expires_at, next.support, next.notes, next.updated_at, key)
        .run();
      await logEvent(env, "admin_update", key, null, changes.join(" · ") || "datos del cliente", ip);
      const counts = await deviceCounts(env);
      return json({ ok: true, license: licenseView(next, counts.get(key) ?? { active: 0, online: 0, total: 0 }) });
    }

    if (method === "POST" && parts[3] === "offline-code") {
      const b = await readBody(req);
      const code = normalizeDevice(b.deviceCode);
      if (!code) return json({ ok: false, message: "El código del equipo debe verse así: XXXX-XXXX-XXXX-XXXX." }, 400);
      if (lic.status === "revoked") return json({ ok: false, message: "La licencia está desactivada. Reactívala primero." }, 400);
      const dev = await getDevice(env, key, code);
      if (dev?.status === "revoked") return json({ ok: false, message: "Ese equipo está desactivado. Reactívalo primero." }, 400);
      if (!dev) {
        if ((await activeDeviceCount(env, key)) >= lic.max_devices) return json({ ok: false, message: limitMessage(lic.max_devices) }, 400);
        await registerDevice(env, key, code, { deviceName: clip(b.deviceName, 80) ?? "Activado sin Internet", os: null, appVersion: null, ip: null, country: null });
      }
      await logEvent(env, "admin_offline_code", key, code, null, ip);
      return json({ ok: true, token: await issueToken(env, lic, code, "active") });
    }
  }

  // /api/devices/:id/(revoke|restore)
  if (method === "POST" && parts[1] === "devices" && parts[2] && (parts[3] === "revoke" || parts[3] === "restore")) {
    const id = Number(parts[2]);
    const dev = Number.isInteger(id) ? await env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(id).first<DeviceRow>() : null;
    if (!dev) return json({ ok: false, message: "Equipo no encontrado." }, 404);
    if (parts[3] === "restore" && dev.status === "revoked") {
      const lic = await getLicense(env, dev.license_key);
      if (lic && (await activeDeviceCount(env, dev.license_key)) >= lic.max_devices) {
        return json({ ok: false, message: `${limitMessage(lic.max_devices)} Desactiva otro equipo primero.` }, 400);
      }
    }
    const status = parts[3] === "revoke" ? "revoked" : "active";
    await env.DB.prepare("UPDATE devices SET status = ? WHERE id = ?").bind(status, id).run();
    await logEvent(env, status === "revoked" ? "admin_device_revoke" : "admin_device_restore", dev.license_key, dev.device_code, dev.device_name, ip);
    return json({ ok: true, device: deviceView({ ...dev, status }) });
  }

  return json({ ok: false, message: "Ruta no encontrada." }, 404);
}

// ------------------------------------------------------------------ Entrada

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (req.method === "POST" && path === "/v1/activate") return await handleActivate(req, env);
      if (req.method === "POST" && path === "/v1/checkin") return await handleCheckin(req, env);
      if (path === "/v1/health") return json({ ok: true, service: "cartucho-licencias" });
      if (path.startsWith("/api/")) return await handleAdmin(req, env, path);
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return fail("server_error", "Error del servidor de licencias. Intenta de nuevo más tarde.", 500);
    }
  },
};
