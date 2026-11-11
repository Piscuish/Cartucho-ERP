#!/usr/bin/env node
/**
 * Prueba de punta a punta 100 % local (sin cuenta de Cloudflare):
 * 1. genera claves temporales, 2. crea la base D1 local, 3. arranca `wrangler dev --local`,
 * 4. ejecuta la prueba Rust de la aplicación contra ese servidor.
 * No modifica la clave pública del programa ni tu `.dev.vars`.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauri = resolve(root, "../apps/desktop/src-tauri");
const tmp = mkdtempSync(join(tmpdir(), "cartucho-lic-"));
const port = 8799;
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} falló`);
};

run("node", ["scripts/generate-keys.mjs", "--out", tmp], { stdio: "ignore" });
const pub = readFileSync(join(tmp, "license_public_key.txt"), "utf8").trim();
const vars = readFileSync(join(tmp, ".dev.vars"), "utf8");
const admin = /ADMIN_TOKEN="([^"]+)"/.exec(vars)[1];
const persist = join(tmp, "state");
const config = join(tmp, "wrangler.e2e.toml");
writeFileSync(config, readFileSync(join(root, "wrangler.toml"), "utf8").replace('main = "src/index.ts"', `main = "${join(root, "src/index.ts")}"`).replace('directory = "./public"', `directory = "${join(root, "public")}"`).replace('migrations_dir = "migrations"', `migrations_dir = "${join(root, "migrations")}"`));
copyFileSync(join(tmp, ".dev.vars"), join(tmp, ".dev.vars.e2e"));

run("npx", ["wrangler", "d1", "migrations", "apply", "cartucho-licencias", "--local", "--persist-to", persist, "-c", config]);
const server = spawn("npx", ["wrangler", "dev", "--local", "--port", String(port), "--persist-to", persist, "-c", config, "--env-file", join(tmp, ".dev.vars.e2e")], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const url = `http://127.0.0.1:${port}`;
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    ready = (await fetch(`${url}/v1/health`)).ok;
  } catch {}
}
let code = 1;
try {
  if (!ready) throw new Error("El servidor local no arrancó:\n" + log);
  const r = spawnSync("cargo", ["test", "--lib", "e2e_local_server", "--", "--ignored", "--nocapture"], {
    cwd: tauri,
    stdio: "inherit",
    env: { ...process.env, CARTUCHO_E2E_SERVER: url, CARTUCHO_E2E_PUBKEY: pub, CARTUCHO_E2E_ADMIN: admin, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
  });
  code = r.status ?? 1;
} catch (e) {
  console.error(e.message);
} finally {
  server.kill("SIGINT");
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
