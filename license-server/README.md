# Servidor de licencias de Cartucho ERP

Controla quién usa Cartucho ERP: entregas una **clave** (`CE-XXXX-XXXX-XXXX-XXXX`) a cada cliente, decides
**qué módulos** tiene y en **cuántos equipos (1 a 5)** puede activarse, ves **quién está conectado** y
puedes **desactivar** una licencia completa o un equipo duplicado.

Corre en **Cloudflare Workers + D1**. El plan gratuito alcanza de sobra: cada equipo hace una
validación por hora (≈ 720 al mes por equipo; el plan gratis permite 100 000 solicitudes **por día**).

> **Nada de esto está conectado a tu cuenta todavía.** Todo lo de abajo lo haces tú cuando quieras publicar.
> Mientras tanto se puede probar 100 % en tu PC (sección «Probar sin Cloudflare»).

## Cómo funciona

1. El cliente instala Cartucho ERP y al abrirlo ve **«Activa tu copia»**.
2. Escribe la clave → el programa la envía al servidor con el **código del equipo** (una huella de esa PC).
3. El servidor revisa el cupo de equipos y devuelve un **token firmado** con tu clave privada.
   El programa lo verifica con la clave pública que lleva dentro: nadie puede fabricar uno.
4. El programa valida **cada hora** cuando hay Internet. Sin Internet sigue funcionando **30 días**.
5. Si desactivas la licencia o el equipo, en la siguiente validación el programa queda en
   **solo ver facturas** y el inicio muestra **«Contacta a soporte»**. Los datos del cliente no se borran.

Sin Internet en la instalación: el cliente te dicta el **código del equipo** (aparece en la opción
«Sin Internet»), tú pulsas «Generar» en el panel y le envías el **código de activación**.

## Planes

| Plan | Módulos |
|---|---|
| Básico | Facturas, Clientes |
| Tienda | Facturas, Cotizaciones, Clientes, Catálogo, Inventario |
| Completo | Todos |
| Personalizado | Los que marques (Facturas siempre) |

Se cambian en `PLANS` dentro de `src/index.ts`. Reglas: Cotizaciones y Resumen requieren Facturas;
Inventario requiere Catálogo.

## Probar sin Cloudflare (no gasta nada)

```bash
cd license-server
npm install
npm run test:e2e      # genera claves temporales, levanta el servidor local y prueba la app contra él
```

Para abrir el panel en tu PC:

```bash
npm run keys -- --out ../.claves-prueba     # claves solo de prueba
copy ..\.claves-prueba\.dev.vars .dev.vars  # (Windows) — en Mac/Linux: cp
npm run db:local
npm run dev                                  # abre http://localhost:8787 y entra con el ADMIN_TOKEN de .dev.vars
```

## Panel: menú por cliente, pagos y vencimientos

- **Menú personalizado** (en el detalle de cada licencia): ocultar opciones del menú, darles un nombre
  propio («Pedidos» en vez de «Cotizaciones») y activar **funciones exclusivas** (`pedidos-domicilio`…)
  para menús hechos a la medida. Viaja firmado en el token; el cliente lo recibe en su próxima
  validación. Es solo visual: los permisos los siguen dando los módulos del plan.
- **Pagos:** valor, forma de pago, fecha y «paga hasta». Si «paga hasta» es posterior al vencimiento,
  la licencia se extiende sola. El inicio muestra lo cobrado en el mes y las licencias que vencen en 15 días.
- **Vencimiento:** el programa avisa al cliente 7 días antes; también avisa si lleva días sin Internet.
- **Equipos:** última validación, versión instalada, IP y país de cada equipo.

## Publicar desde GitHub (recomendado)

El flujo `.github/workflows/license-server.yml` crea la base D1 (la primera vez), aplica las
migraciones, publica el Worker y carga los secretos. Solo necesita estos secretos del repositorio:
`CLOUDFLARE_API_TOKEN` (plantilla «Edit Cloudflare Workers» + permiso «D1: Edit»),
`CLOUDFLARE_ACCOUNT_ID`, `LICENSE_PRIVATE_KEY` y `ADMIN_TOKEN`. Se ejecuta al cambiar `license-server/`
en `main` o a mano desde la pestaña Actions. Sin `CLOUDFLARE_API_TOKEN` no hace nada.

## Publicar (cuando decidas conectar tu cuenta)

1. **Claves definitivas** (una sola vez; guárdalas en un lugar seguro):
   ```bash
   cd license-server
   npm install
   npm run keys
   ```
   Escribe la clave pública en `apps/desktop/src-tauri/license_public_key.txt` y muestra la clave privada.
   ⚠️ Si pierdes la privada no podrás renovar licencias; si generas otras, las licencias entregadas dejan de servir.

2. **Base de datos y secretos:**
   ```bash
   npx wrangler login
   npx wrangler d1 create cartucho-licencias      # copia el database_id en wrangler.toml
   npm run db:remote
   npx wrangler secret put LICENSE_PRIVATE_KEY    # pega la clave privada
   npx wrangler secret put ADMIN_TOKEN            # contraseña del panel (mínimo 12 caracteres)
   ```
   Cambia `SUPPORT_TEXT` en `wrangler.toml` por tu WhatsApp o correo.

3. **Publicar:** `npm run deploy` → te da una dirección como `https://cartucho-licencias.TUUSUARIO.workers.dev`.

4. **Conectar el programa:** pega esa dirección en `apps/desktop/src-tauri/license_server_url.txt`
   y compila el instalador (`pnpm tauri build`). A partir de ahí, ese instalador exige licencia.

5. **Panel:** abre la dirección del paso 3 en el navegador y entra con tu `ADMIN_TOKEN`.

## Notas de seguridad

- La clave privada y el `ADMIN_TOKEN` **nunca** van a Git (`.dev.vars` está ignorado).
- Las compilaciones de desarrollo (`pnpm tauri dev`) sin clave pública abren en **modo desarrollo** con todo habilitado.
  Un instalador de producción sin clave pública **no abre** (pide activar y no puede): configura las claves antes de compilar para clientes.
- Ningún sistema anticopia es perfecto: protege los instaladores que entregas. Si el código fuente es
  público, cualquiera podría compilar su propia copia sin licencia; conviene que el repositorio sea **privado**.
