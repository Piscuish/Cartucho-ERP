# Requisitos Técnicos y Compatibilidad Multiplataforma

## 1. Requisitos Funcionales de la Fase 0

1. **Monorepo configurado con `pnpm workspaces`:**
   - Aplicación de escritorio en `apps/desktop`.
   - Paquete de contratos compartidos en `packages/shared` (`@cartucho/shared`).
2. **Persistencia Local en SQLite:**
   - Creación automática de la base de datos en el directorio de datos de usuario del sistema operativo.
   - Ejecución automática de migraciones iniciales al abrir la aplicación.
   - Persistencia comprobable de datos entre cierres y aperturas del programa.
3. **Interfaz de Diagnóstico Inicial:**
   - Pantalla limpia y profesional en React + TypeScript que muestre el estado de la aplicación, el entorno de ejecución, la ruta de la base de datos SQLite, las migraciones aplicadas y una herramienta para probar la persistencia de registros locales.

---

## 2. Requisitos No Funcionales

- **Operación 100% Sin Internet:** Ninguna pantalla ni operación local debe fallar si el equipo no tiene conexión de red.
- **Acceso a Datos Centralizado:** Toda lectura y escritura en SQLite se realiza en la capa Rust (`apps/desktop/src-tauri/src/db.rs`), nunca dispersando SQL en componentes React.
- **Compatibilidad Multiplataforma:** El código fuente debe mantenerse compatible con **Windows 10/11**, **Linux** y **macOS**:
  - Uso de `std::path::PathBuf` y `directories::ProjectDirs` en Rust para rutas nativas de cada sistema operativo.
  - Normalización de saltos de línea mediante `.gitattributes` y `.editorconfig`.
