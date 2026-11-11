# Informe del trabajo nocturno — 10/11 de noviembre de 2026

Versión de la aplicación: **0.1.0 → 0.2.0** · Esquema de base de datos: **v3 → v4**
Rama en GitHub: `claude/nocturno` · Copia local: `C:\Cartucho-ERP`

> He leído las instrucciones obligatorias de `AGENTS.md` y las seguí durante todo el trabajo.

---

## 1. Qué se hizo

| Pedido | Estado |
| :--- | :--- |
| Rediseño visual, menús suaves e intuitivos (estilo C «lateral oscuro») | Hecho |
| Instalador / primera ejecución: nombre de empresa, logo, usuario admin y contraseña | Hecho (asistente de 4 pasos; instalador de Windows en español) |
| Dos interfaces: login con logo, nombre, usuario y contraseña → programa | Hecho |
| Facturas: crear, imprimir en varios tamaños de hoja, agregar texto | Hecho (Carta, Media carta, A4, tirilla 80 y 58 mm; notas, condiciones y pie) |
| Historial de facturas | Hecho (filtros, búsqueda, saldos, reimpresión) |
| Catálogo: nombre, precio, descripción y foto de referencia | Hecho (más categorías, costo y margen) |
| Inventario | Hecho (compras, ajustes por conteo, movimientos, stock bajo) |
| Clientes | Hecho |
| Ingresos y gastos (luz, arriendo, compras de inventario…) | Hecho (Finanzas + Gastos) |
| Base de datos exportable y carpeta movible | Hecho |
| Preparado para red local y nube | Preparado (ADR 0003); el modo servidor queda para después |
| Ideas extra 1, 2, 3, 4, 5, 7, 8, 9 y 10 | Hechas (panel, abonos, anulación, cotizaciones, stock bajo, categorías, CSV, respaldo diario, Ctrl+K) |
| Idea 6 (IVA y descuentos) | Excluida, como pediste |

Extras: lista de «Primeros pasos», duplicar facturas y cotizaciones, Ctrl+Enter para guardar, Ctrl+B para contraer el menú y tema oscuro completo.

## 2. Archivos modificados y motivo

**Backend (Rust)**
- `src-tauri/src/db.rs`: migración v4, `busy_timeout`, bloqueo de inicio de sesión tras 5 intentos fallidos, apertura según la carpeta configurada, decodificación de imágenes reutilizable. Se ajustaron 4 aserciones de pruebas que fijaban «versión 3».
- `src-tauri/src/data_admin.rs` (nuevo): exportar, restaurar, mover carpeta, usar carpeta existente y respaldo diario.
- `src-tauri/src/erp/` (nuevo): `customers.rs`, `catalog.rs` (productos, categorías, inventario), `sales.rs` (facturas, pagos, anulación, cotizaciones), `finance.rs` (gastos, resumen, panel, búsqueda, CSV), `settings.rs`, `tests.rs`.
- `src-tauri/src/lib.rs`: 48 comandos IPC; la app ya no se cierra si la base no abre (muestra pantalla de error).
- `src-tauri/src/main.rs`: se eliminó el modo de línea de comandos que aceptaba contraseñas como argumentos.
- `Cargo.toml` / `Cargo.lock`: `tauri-plugin-dialog`; versión 0.2.0.
- `tauri.conf.json`: CSP restrictiva (antes `null`), ventana de 1280×820, instalador en español y metadatos.
- `capabilities/default.json`: permiso `dialog:default`.

**Frontend (React)**: reescritos `App.tsx`, `main.tsx`, `components/*`, `config/moduleRegistry.ts`, `services/systemClient.ts`, `styles/theme.css`; nuevos `pages/*`, `lib/*`, `components/print.tsx`, `charts.tsx`, `categories.tsx` y `services/previewBackend.ts`.

**Contratos**: `packages/shared/src/erp.ts` (nuevo), `system.ts` e `index.ts`.

**Otros**: `package.json` (dependencias `@fontsource-variable/inter` y `@tauri-apps/plugin-dialog`), `pnpm-lock.yaml`, `.gitignore` (esquemas generados por Tauri) y documentación (`README.md`, `docs/02-database`, `docs/03-requirements`, `docs/05-roadmap`, ADR 0003).

## 3. Base de datos, migraciones e IPC

- **¿Se afectó?** Sí: esquema, migraciones, IPC y autenticación (bloqueo por intentos).
- **Migración añadida:** `0004_create_business_modules_catalog_sales_finance`. Solo crea tablas nuevas e inserta categorías base y consecutivos con `INSERT OR IGNORE`. No modifica ni borra ninguna tabla existente. Las migraciones v1 a v3 no se tocaron.
- **Respaldo:** al actualizar una base existente se crea y verifica automáticamente `backups/cartucho_erp_pre_migration_v3_to_v4_<fecha>.sqlite3` antes de migrar.

## 4. Pruebas ejecutadas y resultados reales

| Comando / prueba | Resultado |
| :--- | :--- |
| `cargo test` | **25 pruebas, 25 correctas** (7 anteriores + 18 nuevas) |
| `cargo clippy --features desktop-tauri` | 0 advertencias |
| `pnpm typecheck` | Sin errores |
| `pnpm build` | Correcto |
| `pnpm tauri build --debug --no-bundle --features desktop-tauri` (Linux) | Compila y abre la ventana real |
| Verificación de contrato React ↔ Rust | 48 comandos; nombres y argumentos coinciden |

**Pruebas nuevas en Rust:** autenticación obligatoria; semillas de v4; clientes; productos con foto, SKU único y rechazo de imágenes disfrazadas; flujo completo de factura (consecutivo, inventario, abonos, sobrepago rechazado, anulación con devolución de stock); rollback total ante error en una línea; cotización a factura (una sola vez); compra con gasto y ajuste; gastos y categorías en uso; numeración que no retrocede; panel, búsqueda con comodines y CSV con caracteres especiales; actualización v3 → v4; exportar sin sobrescribir; restaurar con copia previa; mover carpeta conservando la original; usar carpeta existente; respaldo diario y retención; bloqueo por intentos. Todas usan bases temporales aisladas.

**Prueba de actualización real (AGENTS §9):** se compiló la versión anterior (commit `3d91281`) y con ella se creó una base v3 con empresa, administrador, tema oscuro y registros. Luego se abrió con la versión nueva:
- Esquema v4, `integrity_check = ok` y `foreign_key_check` sin errores.
- Empresa, usuario (hash Argon2id intacto), tema y registros previos conservados.
- Respaldo `pre_migration_v3_to_v4` íntegro y en versión 3.
- Inicio de sesión con la contraseña anterior en la app de escritorio real: correcto.

**Pruebas en la app de escritorio real (Linux, pantalla virtual):** asistente inicial, creación de producto, factura con pago, finanzas, configuración y creación de respaldo manual. Todo verificado contra el archivo SQLite.

**Pruebas visuales en navegador:** asistente, login, inicio, facturas, editor, impresión (carta, media carta, tirilla), pago, inventario, catálogo, finanzas, configuración, tema oscuro, menú colapsado y Ctrl+K.

## 5. Riesgos y limitaciones pendientes

1. **No se probó en Windows.** Todo se verificó en Linux. Hay que confirmar en tu equipo la ventana, la impresión real (WebView2) y los diálogos de carpetas.
2. **Impresión térmica:** la tirilla ajusta el alto al contenido; según el controlador de la impresora puede requerir configurar el papel «80 mm» o «58 mm» en Windows.
3. **Existencias negativas permitidas:** se puede vender sin stock (se avisa en el editor). Decide si prefieres bloquearlo.
4. **Un solo usuario administrador.** Faltan roles (vendedor/administrador).
5. **Respaldos automáticos:** por defecto se conservan todos (ninguno se borra). Configura cuántos conservar si ocupan mucho espacio.
6. **Las fotos se guardan dentro de la base** (reducidas a 800 px), así que los respaldos las incluyen.
7. **Modo red local:** no implementado; solo preparado. No compartas el archivo por carpeta de red.
8. **Git local:** `C:\Cartucho-ERP` no es un repositorio Git. No hice `git init` allí porque el entorno no permite borrar archivos de bloqueo de Git en esa carpeta. El historial está en GitHub, en la rama `claude/nocturno`.

## 6. Cómo probarlo

```bash
cd C:\Cartucho-ERP
pnpm install          # obligatorio: hay dependencias nuevas
pnpm tauri:dev        # abre la aplicación
```
Al abrirla con tu base actual se actualizará a v4 creando antes un respaldo verificado.

## 7. Estado de Git

Rama `claude/nocturno` en `github.com/Piscuish/cartucho-erp` con commits separados por etapa. El primer commit es una copia exacta de tu carpeta antes del trabajo, por si necesitas comparar o volver atrás. Hay un pull request abierto hacia `main` para que lo revises.
