# ADR 0011 — Módulos activables y apariencia del panel por usuario

Fecha: 13 de noviembre de 2026 · Estado: implementado (pendiente de publicar)

Origen: «Plan de evolución y especificación funcional» (Fase 0 y Fase 1) y «Guía de diseño visual y personalización UX/UI» v2.

## 1. Cuatro controles distintos

| Control | Dónde vive | Quién lo decide |
|---|---|---|
| Licencia | `licensing.rs` (token firmado) | El proveedor |
| Módulo activo | `modules.rs`, clave `module_settings` | El administrador |
| Mostrar en menú | `modules.rs`, clave `module_settings` | El administrador (solo visual) |
| Permisos por rol | `users.rs`, tabla `roles` | El administrador |

Cada comando pasa en Rust por `check_gate` (licencia) → `module_gate` (módulo activo) → `role_gate` (rol). Ocultar un módulo del menú no interviene en ninguna compuerta. Las dependencias (`quotes→invoices`, `inventory→catalog`, `finance→invoices`) siguen saliendo de `licensing::module_requires`; `modules::validate_registry` comprueba que no haya ciclos.

Reglas de `set_module_active`: activar exige licencia del módulo y de toda su cadena de dependencias; una dependencia desactivada solo se activa junto con él si la interfaz ya lo confirmó (`with_dependencies`); desactivar se rechaza si otro módulo activo depende de él. Es idempotente y se guarda en una sola escritura. **Desactivar u ocultar nunca borra datos.**

## 2. Persistencia (sin cambio de esquema)

No hay migración nueva: se usan claves JSON en `_app_metadata`, tabla que existe desde la migración 1.

| Clave | Contenido |
|---|---|
| `module_settings` | `{ "disabled": [...], "hidden": [...] }` |
| `ui_prefs` | Apariencia del panel predeterminada de la instalación |
| `ui_prefs:user:<id>` | Apariencia del panel de un usuario |

- Se guarda la lista de módulos **desactivados**, no la de activos: una instalación existente no tiene la clave y conserva todos sus módulos.
- `installation_entitlements.enabled_modules_json` sigue sin uso funcional. La única fuente de verdad de «módulo activo» es `module_settings`.
- Valores desconocidos o JSON dañado vuelven a los predeterminados al leer; al guardar se rechazan.
- La apariencia anterior (`appearance`, `theme_preference`, `visual_style`) no se toca. Si nadie ha elegido tema de color, se deriva del tema anterior: claro → Blanco, oscuro → Negro.

Recuperación: borrar una de esas claves devuelve ese ajuste a su valor predeterminado. No contienen datos del negocio.

## 3. Diseño, tema y widgets

Tres decisiones independientes (`UiPreferences`):

- `dashboardLayout`: `columns` (A), `analytics` (B), `widgets` (C). Solo distribución. Atributo `data-dash`.
- `colorTheme`: `white`, `black`, `gray`. Solo colores. Atributo `data-palette` (tokens en `styles/redesign.css`).
- `dashboardWidgets` y `widgetSizes`: qué bloques, en qué orden y tamaño. Catálogo en `config/widgetCatalog.ts` (ids repetidos en `modules::VALID_WIDGETS`).

`data-layout` conserva su significado anterior (estilo del menú). El color principal y el estilo del menú siguen siendo de la instalación (`set_appearance`, solo administrador).

## 4. Datos del panel

`get_dashboard` acepta `dateFrom`/`dateTo` y devuelve además `trend` (serie diaria hasta 92 días, mensual después, sin huecos), `previous` (periodo anterior de igual duración) y `scope`. Los datos de gastos, finanzas e inventario solo viajan si el módulo está activo y el rol puede verlos; lo no incluido llega vacío y la interfaz no lo muestra como cero.

## 5. Compatibilidad de esquema

`initialize_and_migrate` rechaza, antes de escribir nada, una base cuya versión de esquema sea mayor que la que admite el programa.

## 6. Pruebas

`modules::tests`, `role_gate_tests` (compuerta con llamada directa), `erp::tests::dashboard_range_trend_previous_period_and_scope`, `db::tests::test_future_schema_is_rejected_without_modifying_the_database`. Todas sobre bases temporales.

## 7. Pendiente

- Los comandos Tauri nuevos no se pudieron compilar en el entorno de desarrollo en la nube (faltan las bibliotecas GTK); la lógica que llaman sí está probada. Compilar con `--features desktop-tauri` antes de publicar.
- Permisos por acción (aplicar descuento, anular, aprobar…), auditoría y perfiles por tipo de negocio en el asistente inicial.
- Fases 2 a 8 del plan (Compras, Proveedores, Tesorería, Contabilidad, DIAN…): aparecen en la pantalla solo como «Próximamente».
