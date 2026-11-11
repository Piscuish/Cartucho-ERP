# Identidad Visual «Lateral oscuro», Navegación y Temas

## 1. Dirección visual

Elegida por el propietario en noviembre de 2026 (opción C):
- Acento **violeta** (`#6d5dd3` / `#8b7ff0` en tema oscuro).
- **Tema claro:** menú lateral blanco y contenido gris muy claro (`#f4f5f8`). **Tema oscuro:** menú lateral oscuro (`#0a0d13`) y contenido oscuro. El menú sigue al tema (cambio pedido por el propietario en la v0.3). Preferencia: Claro, Oscuro o Según el sistema.
- **Tipografía Inter** incluida en la aplicación (`@fontsource-variable/inter`), sin depender de Internet. Cifras tabulares para montos.
- **Iconografía Lucide** (`lucide-react`).
- **Movimiento suave:** transiciones de 160–240 ms con `cubic-bezier(0.2, 0.8, 0.2, 1)`; se respeta `prefers-reduced-motion`.
- Montos en pesos colombianos sin decimales: `$ 1.250.000`.

Los tokens viven en `apps/desktop/src/styles/theme.css` (`:root` y `[data-theme="dark"]`).

## 2. Navegación

Menú lateral colapsable (Ctrl+B) con grupos:

1. **General:** Inicio.
2. **Ventas:** Nueva factura, Facturas, Cotizaciones, Clientes.
3. **Productos:** Catálogo, Inventario (con contador de stock bajo).
4. **Finanzas:** Resumen, Gastos.
5. **Sistema:** Configuración (Mi empresa, Facturación e impresión, Apariencia, Usuario y seguridad, Base de datos y respaldos, Acerca de).

Barra superior: búsqueda rápida (Ctrl+K), cambio de tema, «Cotización» y «Nueva factura» siempre visibles.

## 3. Patrones de interfaz

- Formularios en **paneles laterales** que se deslizan desde la derecha, sin cambiar de pantalla.
- **Avisos breves** («Factura guardada») en lugar de ventanas que interrumpen.
- **Estados vacíos** que invitan a actuar («Agrega tu primer producto»).
- Estados con color: Pagada (verde), Pendiente (ámbar), Pago parcial (azul), Vencida (rojo), Anulada (gris).
- Confirmación explícita, con texto claro, para acciones irreversibles (anular, restaurar, eliminar gasto).

## 4. Editor de facturas y cotizaciones

Diseño en tarjetas y con poco texto: Cliente, Productos y servicios, y «Notas y condiciones» plegable. A la derecha van las fechas, el total y el pago.
- El botón **«Agregar producto/servicio»** abre un menú con todo el catálogo en cuadrícula (foto, precio y existencias), con búsqueda y filtro por categoría. Un clic agrega el producto; si ya estaba, suma una unidad.
- La pestaña **«Personalizado»** agrega un ítem libre solo para esa venta. No se guarda en el catálogo ni afecta el inventario.
- Cada ítem tiene un selector de cantidad −/+, precio editable y botón para quitarlo.

## 5. Documentos impresos

Siempre en colores claros, con logotipo opcional. Plantilla completa para Carta, Media carta y A4; plantilla compacta monoespaciada para tirillas de 80 mm y 58 mm (el alto se ajusta al contenido). Todos indican que son documentos internos, no factura electrónica.

## Barra de título propia (noviembre 2026)

- La ventana se crea sin la barra del sistema (`decorations: false`); `components/titleBar.tsx` dibuja una propia
  de 36 px con el logo y el nombre de la empresa, y los botones minimizar, maximizar/restaurar y cerrar (rojo al pasar el mouse).
- Usa los colores del menú lateral (`--sb-*`), así que sigue al tema claro u oscuro y se une visualmente con el menú.
- Arrastrar la barra mueve la ventana; doble clic maximiza o restaura; los bordes siguen cambiando el tamaño.
- Al perder el foco, el título y los botones se atenúan, como en Windows 11.
- Los modales y paneles quedan debajo de la barra (`.window-content` con `contain: layout paint`), así siempre se puede cerrar o minimizar.
