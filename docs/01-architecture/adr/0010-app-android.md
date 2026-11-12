# ADR 0010 — App de Android: base principal en el PC o en el teléfono

- **Estado:** Aceptada (etapa 1). Etapa 2 (trabajo sin conexión y sincronización) pendiente.
- **Fecha:** 2026-11-12
- **Relacionada con:** ADR 0003 (red local), ADR 0009 (acceso desde celulares).

## Contexto

El propietario pidió una app de Android con las mismas funciones del programa, donde se elija
«¿Dónde está la base principal? En el PC / Aquí en el teléfono», y que más adelante cada equipo
siga trabajando si se cae el WiFi y se sincronice al volver. Esto es una decisión explícita del
propietario que amplía AGENTS.md §11 (sincronización); se hace por etapas.

## Decisión (etapa 1)

1. **Una sola base de código.** La app de Android es el mismo programa (Tauri 2 móvil): misma
   interfaz React y mismo backend Rust/SQLite. La librería se compila como `cdylib` con
   `tauri::mobile_entry_point`; actualizador, reinicio e identificador de máquina quedan solo en
   escritorio. En Android la carpeta de datos la entrega el sistema (`app_data_dir`).
2. **«Aquí en el teléfono»:** la app usa su propia base SQLite local, con todas las reglas,
   migraciones y respaldos de siempre. No comparte datos con el PC.
3. **«En el PC»:** la app no guarda datos del negocio. Cada operación viaja al PC por la red local:
   - El PC expone `POST /api/rpc/{comando}` en el servidor del ADR 0009, con una lista cerrada de
     comandos del trabajo diario (`lan/rpc.rs`). Cada uno se ejecuta con `gated_as` (licencia + rol
     del usuario del teléfono) y la sesión del PC no cambia.
   - Configuración, usuarios, respaldos, licencia y ubicación de datos solo se manejan en el PC.
   - **Registrar** (ventas, cobros, clientes, productos, gastos) requiere que el administrador lo
     permita en Configuración › Celulares (`lan_access_writes`, apagado por defecto).
   - El teléfono hace las peticiones desde Rust (`remote.rs`), solo a direcciones de la red local,
     y puede buscar el PC en su subred (`GET /api/ping`).
   - La apariencia es propia de cada teléfono y no cambia la del PC.
4. **Compilación:** `.github/workflows/android.yml` arma el `.apk` (arm64 y armv7), lo firma
   (clave en secretos `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD`) y lo publica con
   cada versión; las ramas `claude/app-android*` publican una versión de prueba.

## Consecuencias

- Sin migraciones nuevas. Nuevos IPC: `set_lan_writes`, `remote_ping`, `remote_discover`,
  `remote_login`, `remote_logout`, `remote_rpc`.
- Pruebas: `app_rpc_reads_with_the_user_role_and_writes_only_when_allowed`,
  `ping_identifies_cartucho_without_login`, `only_local_addresses_are_accepted`.
- **Desinstalar la app borra la base del modo «teléfono»** (Android borra los datos de la app).
  Por eso la firma debe ser siempre la misma: así las versiones nuevas se instalan encima.
- Limitaciones: HTTP sin cifrar en la red local (igual que el ADR 0009); la impresión desde el
  WebView de Android no está disponible todavía.

## Etapa 2 (pendiente)

En modo PC, copia local en el teléfono y cola de operaciones sin conexión (ventas, cobros,
clientes, gastos) que se envían al volver la red; facturas con número provisional hasta
sincronizar; sin edición ni borrado sin conexión para evitar conflictos.
