# ADR 0007 — Punto de venta y código de barras

## Contexto

En el mostrador se necesita cobrar rápido: tocar productos o pasarlos por el lector, ver el
total, el dinero recibido y el cambio. Los lectores USB/Bluetooth funcionan como un teclado.

## Decisión

1. **Migración v7 (`0007_product_barcode`)**, aditiva: `products.barcode TEXT COLLATE NOCASE`
   (opcional) con índice único parcial `idx_products_barcode … WHERE barcode IS NOT NULL`.
   Va precedida de la copia verificada automática `pre_migration_v6_to_v7`.
2. `save_product` valida el código en Rust (recorta espacios, máx. 64, sin espacios internos,
   único). La búsqueda de productos y la búsqueda global también buscan por código de barras.
3. **Punto de venta** (`pages/Pos.tsx`, ruta `pos`, módulo `invoices` con escritura): cada venta se
   guarda con el mismo `create_invoice` de siempre (no hay comandos IPC nuevos), así que aparece
   en Facturas, descuenta inventario y entra al Cierre de caja. «Fiado» crea la factura sin pago
   inicial y exige un cliente guardado.
4. Lector: `lib/barcode.ts` reconoce teclas muy rápidas terminadas en Enter cuando el foco no
   está en un campo; los buscadores (punto de venta y menú de productos) agregan el producto si el
   texto coincide exactamente con un código de barras o SKU.

## Consecuencias

- Compatibilidad: `barcode` es opcional en el contrato; versiones anteriores lo ignoran.
- Pruebas: `product_barcode_is_unique_searchable_and_validated`; las pruebas de actualización
  existentes recorren la cadena completa de migraciones hasta v7.
