# Hoja de Ruta (Roadmap) — Cartucho ERP

Fases incrementales, priorizando la estabilidad local antes de añadir complejidad.

---

## Fase 0: Fundación local-first — Completada
- Monorepo `pnpm`, paquete `@cartucho/shared`, React + TypeScript + Vite con Tauri 2 + Rust.
- SQLite local con migraciones versionadas, respaldo verificado antes de migrar y pruebas de persistencia.

## Fase 1: Empresa, acceso y estructura — Completada
- Asistente de primera ejecución atómico (empresa + logo + administrador).
- Inicio de sesión local con Argon2id y bloqueo temporal por intentos fallidos.
- Menú lateral, temas claro/oscuro y configuración.

## Fase 2: Facturación y gestión — Completada (noviembre 2026)
- Catálogo de productos y servicios con foto, categorías, precio y costo.
- Inventario: existencias, compras, ajustes por conteo, movimientos y alertas de stock bajo.
- Clientes con total comprado y saldo pendiente.
- Facturas internas con abonos, anulación (sin borrar) e impresión en Carta, Media carta, A4 y tirilla 80/58 mm.
- Cotizaciones convertibles en factura.
- Gastos por categoría, resumen financiero, gráficos y exportación CSV.
- Exportar, restaurar y mover la base de datos; respaldo automático diario.
- Búsqueda rápida (Ctrl+K) y panel de inicio.

## Fase 2.5: Módulos y licencias — Lista (noviembre 2026)
- Módulos activables por licencia: Facturas, Cotizaciones, Clientes, Catálogo, Inventario, Gastos, Resumen.
- Activación con clave o código sin Internet; 1 a 5 equipos; 30 días sin conexión.
- Desactivación remota de licencia o equipo → solo ver facturas y «Contacta a soporte».
- Servidor Cloudflare Workers + D1 y panel de administración (`license-server/`). **Pendiente: publicarlo con la cuenta del propietario.**

## Fase 3: Próximos pasos sugeridos
- **Modo servidor para red local:** un equipo como servidor y los demás como clientes, sin compartir el archivo SQLite (ver ADR 0003).
- **Usuarios con roles** (vendedor, administrador) y permisos por módulo.
- Proveedores y órdenes de compra.
- Cierre de caja diario.
- Estado de cuenta por cliente imprimible.
- Edición de cotizaciones abiertas y duplicar documentos.
- Impuestos (IVA) y descuentos por línea, si el negocio los necesita.

## Fase 4 (futura y opcional): Servicios en la nube
- Respaldos automáticos en la nube.
- Sincronización entre dispositivos o servidor central.
- Facturación electrónica DIAN mediante un proveedor tecnológico autorizado.
