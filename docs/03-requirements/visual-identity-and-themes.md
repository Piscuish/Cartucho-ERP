# Identidad Visual (Business Minimalist) y Sistema de Temas

## 1. Dirección Visual

La interfaz de escritorio de **Cartucho ERP** sigue la dirección estética **Business Minimalist**:
- **Sobriedad y orden:** Pensada para jornadas prolongadas de trabajo administrativo en pantallas de escritorio.
- **Marca neutral y monocromática:** Isotipo geométrico de capas (`Layers` de Lucide) acompañado de **CARTUCHO** y el descriptor `ERP · LOCAL-FIRST`.
- **Tipografía e iconografía:** Fuente principal **Inter** (con soporte monoespaciado para rutas, versiones e identificadores) e iconografía **Lucide** (`lucide-react`).
- **Geometría y movimiento:** Bordes de `8px` a `12px`, sombras mínimas y transiciones de `150ms` a `180ms`. Sin degradados decorativos, sin *glassmorphism* ni estadísticas ficticias.

---

## 2. Tokens Semánticos Centralizados (`src/styles/theme.css`)

Todos los componentes consumen variables CSS semánticas definidas en `apps/desktop/src/styles/theme.css`. Ningún componente utiliza colores aislados fuera del sistema de tokens.

| Token Semántico | Tema Claro (`[data-theme="light"]`) | Tema Oscuro (`[data-theme="dark"]`) | Uso |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#F4F5F7` | `#17191E` | Fondo base de la aplicación |
| `--bg-surface` | `#FFFFFF` | `#24272E` | Tarjetas, Sidebar, Topbar y Statusbar |
| `--text-primary` | `#24272E` | `#F2F3F5` | Títulos, valores y texto principal |
| `--text-secondary` | `#777C85` | `#777C85` | Subtítulos, etiquetas secundarias y metadatos |
| `--accent-neutral` | `#41454E` | `#41454E` | Acento neutral y controles secundarios |
| `--border-default` | `#E2E5E9` | `#41454E` | Líneas divisorias y bordes de contenedores |

Los estados semánticos (`success`, `warning`, `error`, `neutral`) emplean tonos discretos de bajo impacto visual para indicar el estado de la conexión SQLite y las notificaciones.

---

## 3. Funcionamiento y Persistencia del Sistema de Temas

1. **Opciones disponibles:**
   - **Claro (`light`):** Aplica `[data-theme="light"]` en el elemento raíz `<html>`.
   - **Oscuro (`dark`):** Aplica `[data-theme="dark"]` en el elemento raíz `<html>`.
   - **Sistema operativo (`system`):** Detecta automáticamente la preferencia del sistema mediante `window.matchMedia("(prefers-color-scheme: dark)")` y reacciona en tiempo real si el usuario cambia el modo de su sistema operativo.
2. **Persistencia en SQLite:**
   - Al seleccionar un tema en la vista **Preferencias** (o desde el conmutador rápido de la barra superior), React invoca el comando IPC `set_theme_preference`, que actualiza la clave `theme_preference` en la tabla `_app_metadata` de SQLite.
   - Al volver a abrir la aplicación, `get_system_overview` recupera `preferences.theme` desde SQLite y restaura el tema elegido.

---

## 4. Estructura del Dashboard y Componentes de Fase 0

La ventana se estructura en cuatro áreas fijas de escritorio (`apps/desktop/src/components/layout.tsx`):
- **Sidebar izquierdo:** Navegación dividida en **GENERAL** (*Inicio*) y **APLICACIÓN** (*Almacenamiento*, *Preferencias*, *Acerca de*).
- **Barra superior (Topbar):** Título y descripción de la vista activa, indicador de conexión SQLite, botón de cambio rápido de tema y botón de recarga.
- **Área de contenido principal:** Renderiza la pantalla activa con ancho máximo legible (`1060px`).
- **Barra inferior de estado (Statusbar):** Muestra el estado de SQLite, versión del esquema, modo `WAL`, tema activo y plataforma.
