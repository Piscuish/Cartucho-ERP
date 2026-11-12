# ADR 0006 — Productos sin control de existencias y descripción por línea

## Contexto

- Hay negocios (p. ej. una panadería) que venden productos que no se pueden contar: no tiene
  sentido limitar la venta por existencias ni sumarlos al valor del inventario.
- Hasta ahora `products.track_stock = 0` significaba "servicio". No había forma de distinguir un
  servicio de un producto que simplemente no lleva existencias.
- Al facturar, el usuario necesita agregar un texto libre por línea (garantía, serial, color…).

## Decisión

1. **Migración v6 (`0006_item_kind_and_line_notes`)**, aditiva y no destructiva:
   - `products.item_kind TEXT NOT NULL DEFAULT 'product' CHECK (item_kind IN ('product','service'))`.
     Los ítems existentes con `track_stock = 0` quedan como `service` (así se mostraban antes).
   - `invoice_lines.note TEXT` y `quote_lines.note TEXT` (nulos).
   - Como toda migración, va precedida de la copia de seguridad verificada `pre_migration_v5_to_v6`.
2. `save_product` valida el tipo en Rust: `service` fuerza `track_stock = 0`; un `product` puede
   tener o no control de existencias. Sin control: se vende sin límite, no genera movimientos y no
   suma al valor del inventario. Al apagar el control con existencias, éstas pasan a cero con un
   movimiento de ajuste registrado.
3. La descripción adicional de la línea se limpia y limita a 500 caracteres en Rust; pasa de la
   cotización a la factura al convertirla y se imprime bajo el nombre del ítem.

## Consecuencias

- Compatibilidad: los clientes sin `kind` infieren el tipo con `itemKind()` (servicio si no controla
  existencias). Los comandos IPC aceptan `kind` y `note` como opcionales.
- Pruebas: `product_without_stock_control_and_line_notes` y `upgrade_v5_to_v6_classifies_existing_items`.
