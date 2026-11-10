# Estándares de Ingeniería (Rust, React, TypeScript y SQLite)

## 1. Capa Nativa y Acceso a Datos (Rust + Tauri 2)

- **Centralización de SQLite:** Todas las consultas SQL y migraciones deben vivir dentro de módulos dedicados en `apps/desktop/src-tauri/src/` (iniciando con `db.rs`). Los comandos expuestos con `#[tauri::command]` deben ser delgados y delegar en la capa de datos.
- **Manejo de Errores:** Evitar `unwrap()` o `expect()` dentro de comandos IPC invocables desde la interfaz; devolver siempre `Result<T, String>` con mensajes descriptivos en español para que el frontend pueda presentarlos adecuadamente.
- **Consultas Parametrizadas:** Utilizar siempre `rusqlite::params![]` para prevenir cualquier inyección SQL y garantizar el correcto tipado de datos.
- **Pruebas Automatizadas:** Cada operación de base de datos debe contar con pruebas unitarias/integración en Rust usando directorios temporales (`tempfile::TempDir`) para no contaminar la base de datos real del usuario.

---

## 2. Frontend (React + TypeScript + Vite)

- **TypeScript Estricto:** Mantener `"strict": true` en todos los archivos `tsconfig.json`. Evitar el uso de `any`.
- **Contratos Compartidos:** Cuando un tipo represente la respuesta o los argumentos de un comando Tauri, definirlo en `@cartucho/shared` (`packages/shared/src/`) con nomenclatura `camelCase` sincronizada con `#[serde(rename_all = "camelCase")]` en Rust.
- **Capa de Servicios:** Los componentes React no deben llamar a `invoke(...)` directamente con cadenas mágicas; deben utilizar funciones encapsuladas en `apps/desktop/src/services/`.

---

## 3. Reglas Multiplataforma (Windows, Linux, macOS)

- **Rutas de Archivos:** Nunca concatenar rutas manualmente con `/` o `\`. Utilizar `Path::join` en Rust.
- **Ubicación de Datos:** Nunca escribir archivos temporales ni bases de datos en el directorio de trabajo actual (`current_dir`), ya que en aplicaciones instaladas dicho directorio suele ser de solo lectura. Utilizar siempre el directorio resuelto por `resolve_os_app_data_dir()`.
