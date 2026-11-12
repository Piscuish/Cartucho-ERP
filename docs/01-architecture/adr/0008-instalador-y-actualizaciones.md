# ADR 0008 — Instalador, primera ejecución y actualizaciones

## Contexto

Se necesita un instalador liviano para Windows que deje el programa listo para usar: elegir dónde
guardar los datos, configurar la impresión y recibir actualizaciones. El servidor de licencias aún
no está publicado.

## Decisión

1. **Instalador NSIS** (`bundle.targets = ["nsis"]`, `installMode = currentUser`, compresión LZMA,
   WebView2 por *bootstrapper*). Se compila en GitHub Actions (`windows-latest`) y se publica en
   *Releases* con `tauri-action`.
2. **Asistente inicial** con pasos nuevos:
   - *Base de datos*: comando `setup_data_location(mode, dir)` (`default` | `folder` | `existing`),
     permitido solo mientras no exista un administrador. Reutiliza la lógica verificada de mover
     datos y usar una carpeta existente (copia con la API de backup y puntero de ubicación).
   - *Impresión*: `CompleteInitialSetupInput.paperSize` (opcional, validado en Rust) se guarda en la
     misma transacción que la empresa y el administrador. Página de prueba con la vista de impresión.
3. **Actualizaciones**: `tauri-plugin-updater` + `tauri-plugin-process`. Endpoint
   `releases/latest/download/latest.json` (GitHub, sin costo). Firma minisign: la clave pública va en
   `tauri.conf.json`; la privada solo en secretos de GitHub y en poder del propietario. Antes de
   instalar se crea una copia manual; al abrir la nueva versión, las migraciones crean su respaldo
   verificado. En Windows se instala en modo *passive* y el programa se reinicia solo.
4. **Licencia que se reconoce sola**: el token (`v: 1`, campo opcional `company`) trae nombre
   comercial, razón social, NIT, teléfono, correo y dirección; el asistente se llena con ellos. El
   servidor guarda esos datos (migración D1 `0002_company_profile.sql`, aditiva). Tokens antiguos sin
   `company` siguen siendo válidos.
5. **Sin clave pública incluida**, la copia no usa licencias (todos los módulos), también en
   versión de producción, para poder distribuir el instalador mientras no haya servidor. Al definir
   `LICENSE_PUBLIC_KEY` en GitHub, los instaladores siguientes exigen licencia.

## Consecuencias

- Base de datos local: sin migraciones nuevas (esquema 7). IPC: nuevo `setup_data_location`;
  `complete_initial_setup` acepta `paperSize`; `LicenseStatus` agrega `company` y `licensingEnabled`.
- Pruebas: `setup_data_location_only_before_admin_exists`, `setup_saves_default_paper_size`,
  `token_brings_company_data_and_old_tokens_still_work`.
- Riesgo: perder la clave privada de actualizaciones impide actualizar las copias instaladas.

## Adenda — Servidor de licencias listo para publicar

- Migración D1 `0003_menu_and_payments.sql` (aditiva): columna `licenses.ui` y tabla `payments`.
- El token agrega `ui` opcional `{hide, labels, features}` (normalizado en el servidor y recortado en
  Rust). La app oculta/renombra opciones del menú y expone `hasFeature()`; no cambia permisos.
- Pagos con «paga hasta» extienden `expires_at`; eliminar un pago no lo reduce.
- Aviso en la app: vencimiento en ≤ 7 días o validación pendiente en ≤ 5 días.
- Publicación con GitHub Actions (`license-server.yml`), sin credenciales en el repositorio.
- Prueba de punta a punta (`npm run test:e2e`, wrangler local) cubre empresa, menú, versión del
  equipo, pagos y vencimiento.
