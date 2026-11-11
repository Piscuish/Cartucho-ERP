#!/usr/bin/env node
/**
 * Genera el par de claves Ed25519 de las licencias.
 *
 * - Clave PÚBLICA → apps/desktop/src-tauri/license_public_key.txt (va dentro del programa).
 * - Clave PRIVADA → license-server/.dev.vars (solo para pruebas locales, no se sube a Git)
 *   y se muestra en pantalla para guardarla en Cloudflare con `npx wrangler secret put LICENSE_PRIVATE_KEY`.
 *
 * ¡Guarda la clave privada en un lugar seguro! Si la pierdes no podrás emitir licencias
 * para los programas ya instalados; si la cambias, todas las licencias anteriores dejan de validar.
 *
 * Uso: npm run keys            (se niega si ya hay una clave pública)
 *      npm run keys -- --force (reemplaza las claves: invalida todas las licencias emitidas)
 *      npm run keys -- --out <carpeta>  (escribe en otra carpeta, para pruebas)
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const force = args.includes("--force");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : null;

const publicPath = outDir ? join(outDir, "license_public_key.txt") : resolve(here, "../../apps/desktop/src-tauri/license_public_key.txt");
const devVarsPath = outDir ? join(outDir, ".dev.vars") : resolve(here, "../.dev.vars");

if (!force && existsSync(publicPath) && readFileSync(publicPath, "utf8").trim()) {
  console.error(`Ya existe una clave pública en ${publicPath}.`);
  console.error("Si generas otra, TODAS las licencias ya entregadas dejarán de funcionar.");
  console.error("Si de verdad quieres reemplazarla: npm run keys -- --force");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const spki = publicKey.export({ type: "spki", format: "der" });
const rawPublic = spki.subarray(spki.length - 32); // los últimos 32 bytes son la clave
const privatePkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const adminToken = randomBytes(24).toString("base64url");

if (outDir) mkdirSync(outDir, { recursive: true });
writeFileSync(publicPath, rawPublic.toString("base64") + "\n");
writeFileSync(devVarsPath, `LICENSE_PRIVATE_KEY="${privatePkcs8}"\nADMIN_TOKEN="${adminToken}"\n`);

console.log("Claves generadas.\n");
console.log(`Clave pública  → ${publicPath}`);
console.log(`Pruebas locales → ${devVarsPath} (no se sube a Git)\n`);
console.log("CLAVE PRIVADA (guárdala en un lugar seguro; súbela a Cloudflare con");
console.log("  npx wrangler secret put LICENSE_PRIVATE_KEY):\n");
console.log(privatePkcs8 + "\n");
console.log("Contraseña sugerida para el panel (npx wrangler secret put ADMIN_TOKEN):\n");
console.log(adminToken);
