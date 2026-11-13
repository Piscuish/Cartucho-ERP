# Identidad Visual «Lateral oscuro», Navegación y Temas

> **Actualización (noviembre de 2026):** el diseño del panel (A, B, C), los temas de color Blanco, Negro y Gris, los widgets y el menú por áreas (Operación diaria, Dinero, Administración) se describen en el [ADR 0011](../01-architecture/adr/0011-modulos-activables-y-apariencia-por-usuario.md). El acento predeterminado pasó a azul. Lo que sigue describe la base anterior, que se conserva.

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

## Apariencia: diseño × fondo × color (noviembre 2026)

Configuración › Apariencia tiene cinco partes que se combinan libremente:

1. **Combinaciones rápidas:** Violeta, Océano, Bosque, Coral, Neón, Panel, Medianoche, Estudio y Negro y azul. Aplican todo de una vez (incluido claro/oscuro).
2. **Diseño** (estructura y forma):
   - *Clásico*: menú con secciones y tarjetas limpias.
   - *Neón*: fondo con brillo del acento y su color compañero, tarjetas de vidrio con borde de color, cifras en degradado.
   - *Riel*: menú de íconos en cuadros de colores (cada sección con su color) y métricas en bloques de color sólidos.
   - *Flotante*: la ventana flota sobre un degradado del acento; elemento activo en píldora brillante; tarjetas con tinte.
   - *Estudio*: logo grande centrado, menú amplio sin secciones e inicio con accesos a cada módulo.
3. **Tema:** claro, oscuro o según Windows.
4. **Fondo:** oscuros (Pizarra, Grafito, Negro, Azul noche, Morado noche, Bosque noche) y claros (Blanco, Cálido, Hielo). Se guarda un fondo para cada tema.
5. **Color de acento:** Violeta, Azul, Cian, Verde, Naranja, Rosa, Rojo, Ámbar y Blanco y negro, más el interruptor **Bordes del color de acento**.

Implementación:
- Atributos en `<html>`: `data-theme`, `data-bg`, `data-accent`, `data-layout`, `data-borders`. Estilos en `styles/appearance.css`.
- Las variantes suaves del acento se calculan con `color-mix()`; el texto sobre el acento usa `--on-accent`.
- Se guarda como JSON en `_app_metadata` con la clave `appearance` (sin migración). Si no existe, se traduce el
  `visual_style` de la versión anterior; un valor inválido vuelve a la apariencia por defecto.
- Para agregar un fondo o acento: bloque CSS, entrada en `@cartucho/shared` (`LIGHT_BACKGROUNDS`, `DARK_BACKGROUNDS`, `ACCENTS`) y su id en las listas `VALID_*` de `db.rs`.

### Optimización (noviembre 2026)

- Sin interruptor de claro/oscuro en la barra superior ni sección «Tema»: el tema lo define el **fondo** elegido (o la combinación rápida).
- Neón sin `backdrop-filter` (el desenfoque por tarjeta causaba lag); el contenido se desplaza con `will-change: scroll-position`.
- El cambio de apariencia usa un solo fundido (`startViewTransition`) en lugar de animar todos los elementos, y se aplica al instante (optimista).
- La barra de título consulta «maximizada» solo al terminar de redimensionar.
- Menú contraído: etiquetas posicionadas con JavaScript (antes aparecían en lugares incorrectos); íconos centrados en Riel.
- Menú más compacto y botón «Contraer» junto al usuario, para que todo quepa en pantallas de 768 px.
