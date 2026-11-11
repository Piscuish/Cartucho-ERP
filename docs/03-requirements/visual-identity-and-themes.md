# Identidad Visual «Lateral oscuro», Navegación y Temas

## 1. Dirección visual

Elegida por el propietario en noviembre de 2026 (opción C):
- **Menú lateral oscuro** (`#161b26`) con acento **violeta** (`#6d5dd3` / `#8b7ff0` en tema oscuro) y **contenido claro** (`#f4f5f8`).
- **Tema oscuro** completo para el área de trabajo; el menú siempre es oscuro. Preferencia: Claro, Oscuro o Según el sistema.
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

## 4. Documentos impresos

Siempre en colores claros, con logotipo opcional. Plantilla completa para Carta, Media carta y A4; plantilla compacta monoespaciada para tirillas de 80 mm y 58 mm (el alto se ajusta al contenido). Todos indican que son documentos internos, no factura electrónica.
