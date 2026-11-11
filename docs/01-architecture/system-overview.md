# Arquitectura Técnica, Monorepo, Tauri/Rust, Sesión e Integración IPC

## 1. Arquitectura Local-First de Escritorio (Una Empresa por Instalación)

**Cartucho ERP** se construye como una aplicación de escritorio autónoma (*Local-First*). Cada instalación corresponde a **una única empresa** y cuenta con su propia base de datos **SQLite** almacenada localmente en el equipo, funcionando al 100% sin necesidad de conexión a Internet ni servidores externos.

Al mismo tiempo, el núcleo del ERP está desacoplado de los módulos comerciales mediante `installation_entitlements` y `moduleRegistry.ts`, manteniendo separados cinco conceptos independientes:
1. **Perfil o giro de negocio (`business_profile_key`):** Ej. `general`, `imprenta`, `restaurante`, `tienda`.
2. **Módulos habilitados (`enabled_modules_json`):** Lista explícita de módulos activos en la instalación (inicialmente `[]` hasta que cada módulo esté desarrollado y habilitado).
3. **Plan o edición comercial (`commercial_plan_key`):** Nivel o edición de la instalación (`local-standard`, etc.).
4. **Complementos adicionales (`enabled_addons_json`):** Extensiones opcionales independientes (`[]`).
5. **Roles y permisos de usuario (`role_key`, `permissions_json` en `app_users`):** Atributos exclusivos de cada usuario autenticado.

---

## 2. Estructura del Monorepo (`pnpm workspaces`)

1. **`packages/shared` (`@cartucho/shared`):**
   - Contiene los contratos TypeScript compartidos (`SystemOverview`, `CompanyProfile`, `SaveCompanyProfileInput`, `CompleteInitialSetupInput`, `LoginInput`, `ChangePasswordInput`, `AuthenticatedUserSummary`, `ErpModuleDescriptor`) y el diccionario `TAURI_COMMANDS`.
2. **`apps/desktop` (`@cartucho/desktop`):**
   - Contiene el frontend en `src/` (React 19 + TypeScript + Vite) y el núcleo nativo de escritorio en `src-tauri/` (Tauri 2 + Rust + SQLite).

---

## 3. Funcionamiento de Tauri 2, el Núcleo Rust y el Control de Sesión (`src-tauri/`)

1. **`db.rs` (`LocalDatabase`):**
   - Resuelve el directorio de datos de aplicación del sistema operativo mediante `directories::ProjectDirs::from("com", "cartucho", "cartucho-erp")`.
   - Abre y administra la conexión con SQLite mediante `rusqlite` (`bundled` + `backup`), activando en cada conexión `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON` y `PRAGMA synchronous = NORMAL`.
   - Ejecuta respaldos verificados (`create_verified_backup` + `PRAGMA integrity_check`) antes de aplicar nuevas migraciones sobre una base existente.
   - Gestiona el hashing y verificación de contraseñas mediante **Argon2id** (`argon2` + `OsRng`).
   - Mantiene en memoria del proceso el estado de sesión activa (`active_user_id: Option<i64>`). Al cerrar la aplicación, la memoria del proceso termina y al volver a abrirla se exige iniciar sesión nuevamente.
   - Valida obligatoriamente la sesión en el backend Rust (`require_authenticated_user`) antes de ejecutar cualquier operación protegida.
2. **`lib.rs` (`AppState` y comandos `#[tauri::command]`):**
   - Envuelve `LocalDatabase` dentro de `AppState { db: Mutex<LocalDatabase> }` y expone los comandos IPC a React.

---

## 4. Comandos IPC Implementados

| Comando Tauri (`TAURI_COMMANDS`) | Requiere Sesión | Argumentos | Retorno | Función |
| :--- | :---: | :--- | :--- | :--- |
| `get_system_overview` | No (oculta registros internos si no hay sesión) | Ninguno | `SystemOverview` | Obtiene el estado de inicialización (`hasAdminUser`, `isAuthenticated`), preferencias de tema, datos de la empresa y estado de SQLite. |
| `complete_initial_setup` | Solo si `hasAdminUser == false` | `{ input: CompleteInitialSetupInput }` | `SystemOverview` | Registra de forma **atómica** en una sola transacción SQLite la empresa y el primer administrador (Argon2id), e inicia sesión. Bloqueado permanentemente una vez que existe un administrador. |
| `login_user` | No | `{ input: LoginInput }` | `SystemOverview` | Verifica usuario y contraseña con Argon2id y activa la sesión en memoria del proceso. |
| `logout_user` | No | Ninguno | `SystemOverview` | Cierra la sesión activa en memoria del proceso. |
| `change_user_password` | **Sí** | `{ input: ChangePasswordInput }` | `SystemOverview` | Verifica la contraseña actual mediante Argon2id y actualiza el hash con la nueva contraseña. |
| `save_company_profile` | **Sí** | `{ input: SaveCompanyProfileInput }` | `SystemOverview` | Actualiza los datos de la empresa y su logotipo (`BLOB` binario PNG/JPEG/WEBP validado por firma mágica). |
| `set_theme_preference` | **Sí** | `{ theme: "light" \| "dark" \| "system" }` | `SystemOverview` | Guarda la preferencia de tema en `_app_metadata`. |
| `record_persistence_check` | **Sí** | `{ note: string }` | `SystemOverview` | Inserta un registro de verificación de persistencia en `_persistence_checks`. |
