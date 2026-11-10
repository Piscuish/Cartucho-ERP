# Hoja de Ruta (Roadmap) — Cartucho ERP

La evolución de **Cartucho ERP** está estructurada en fases incrementales, priorizando la simplicidad, la estabilidad local y la validación práctica antes de introducir cualquier complejidad adicional.

---

## Fase 0: Fundación Local-First (Fase Actual — Completada)
- Configuración del monorepo con `pnpm workspaces`.
- Creación del paquete `@cartucho/shared` para tipos esenciales.
- Integración de **React + TypeScript + Vite** con **Tauri 2 + Rust**.
- Configuración de **SQLite local** en el directorio de datos de aplicación del sistema operativo, mecanismo de migraciones y pruebas de persistencia.
- Interfaz inicial de estado de la aplicación y diagnóstico de base de datos.
- Documentación fundacional y guías de compilación multiplataforma.

---

## Fase 1: Estructura Base de la Aplicación y Configuración Local
- Diseño del *App Shell* de escritorio con navegación lateral modular.
- Configuración de los datos básicos de la empresa/negocio local (nombre comercial, moneda de visualización, datos de contacto e impresión).
- Sistema de copias de seguridad locales (exportar e importar respaldo del archivo SQLite desde la propia aplicación).

---

## Fase 2: Catálogos Básicos (Clientes y Productos/Servicios)
- **Módulo de Clientes:** Registro sencillo de clientes (nombre/razón social, identificación opcional, teléfono, correo, dirección y notas).
- **Módulo de Productos / Servicios:** Catálogo básico con código/SKU, nombre, precio de referencia, unidad y control sencillo de existencias locales.

---

## Fase 3: Documentos de Venta Internos y Registro Manual de Pagos
- **Emisión de Documentos de Venta / Facturas Internas:**
  - Creación de documentos de venta internos con líneas de productos/servicios y cálculo de totales.
  - Claramente identificados como **documentos administrativos internos** (sin facturación electrónica DIAN ni validez fiscal tributaria).
  - Gestión de estados del documento: **Pendiente**, **Parcialmente pagada** y **Pagada**.
- **Registro Manual de Pagos Recibidos:**
  - Registro informativo de cada abono o pago total recibido por la empresa.
  - Selección del método de pago: **Efectivo**, **Transferencia**, **Tarjeta** u **Otro**.
  - Registro de importe, fecha del pago y observación opcional.
  - **Sin pasarelas de pago, sin conexiones bancarias ni datáfonos.**

---

## Fase 4: Compras, Gastos y Reportes Operativos Locales
- Registro básico de proveedores y compras/entradas de mercancía.
- Resumen de ingresos y pagos registrados por período y por método de pago.

---

## Fase 5 (Futura y Opcional): Servicios Complementarios
- Solo cuando las fases locales estén maduras y probadas, se evaluará la incorporación opcional de:
  - Respaldos automáticos en la nube.
  - Sincronización entre múltiples dispositivos.
  - Servidor central opcional (Laravel + PostgreSQL) para escenarios multi-equipo o multi-sucursal conectados.
