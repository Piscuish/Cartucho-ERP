# Documentación Técnica — Cartucho ERP

Bienvenido a la documentación oficial de **Cartucho ERP**. Esta guía describe exactamente lo que está implementado en la **Fase 0**, así como los lineamientos de diseño y la hoja de ruta para las siguientes etapas.

---

## Índice de Contenidos

### 1. Arquitectura (`01-architecture/`)
- [Arquitectura Técnica, Monorepo, Tauri/Rust e Integración IPC](./01-architecture/system-overview.md)
- [Arquitectura Futura Opcional (Respaldos, Sincronización y Servidor Central)](./01-architecture/future-evolution.md)
- [ADR-0001: Arquitectura de Escritorio Local-First con Tauri 2, Rust y SQLite](./01-architecture/adr/0001-local-first-tauri-sqlite.md)
- [ADR-0002: Enfoque Pragmático y Exclusión de Complejidad Fiscal/Bancaria Prematura](./01-architecture/adr/0002-pragmatic-scope.md)

### 2. Base de Datos Local (`02-database/`)
- [Administración de SQLite Local, Directorios de SO y Sistema de Migraciones](./02-database/sqlite-local-strategy.md)

### 3. Requisitos, Alcance e Identidad Visual (`03-requirements/`)
- [Visión del Producto, Documentos de Venta Internos y Registro Manual de Pagos](./03-requirements/product-vision-and-scope.md)
- [Identidad Visual (Business Minimalist) y Sistema de Temas](./03-requirements/visual-identity-and-themes.md)
- [Requisitos Técnicos y Compatibilidad Multiplataforma](./03-requirements/system-requirements.md)

### 4. Estándares de Código y Flujo de Trabajo (`04-coding-standards/`)
- [Estándares de Ingeniería (Rust, React, TypeScript y SQLite)](./04-coding-standards/coding-standards.md)
- [Flujo de Trabajo en Git, Ramas, Commits y Pull Requests](./04-coding-standards/git-workflow.md)

### 5. Hoja de Ruta (`05-roadmap/`)
- [Roadmap de Desarrollo por Etapas](./05-roadmap/roadmap.md)

### 6. Guías de Instalación y Compilación (`06-setup/`)
- [Guía de Instalación y Compilación en Windows 10/11, Linux y macOS](./06-setup/installation-guide.md)
