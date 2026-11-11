# Identidad Visual (Business Minimalist), Navegación y Sistema de Temas

## 1. Dirección Visual Refinada

La interfaz de escritorio de **Cartucho ERP** aplica una estética **Business Minimalist** sobria, limpia y orientada al negocio:
- **Paleta neutral y monocromática:** Alto contraste legible tanto en modo claro como en modo oscuro, sin colores chillones, degradados ni efectos innecesarios.
- **Tipografía e iconografía:** Fuente **Inter** e iconografía **Lucide** (`lucide-react`).
- **Barras de desplazamiento discretas:** Scrollbars delgadas (`6px`), de bordes redondeados y colores integrados con los tokens `--scrollbar-thumb` y `--scrollbar-thumb-hover` en todos los contenedores con desplazamiento.
- **Barra superior limpia y controles de ventana:** La barra superior muestra únicamente el contexto de la vista actual, el nombre de la empresa activa, el usuario autenticado, los botones de actualizar/cerrar sesión y los controles discretos de ventana de escritorio (*Minimizar*, *Maximizar/Restaurar* y *Cerrar*). El selector de apariencia reside exclusivamente en **Configuración > Apariencia**.

---

## 2. Estructura de Navegación Categorizada y Dinámica

El menú lateral izquierdo (`Sidebar`) organiza la aplicación en cuatro categorías claras:

1. **GENERAL**
   - **Inicio:** Espacio principal de trabajo de la empresa con cabecera de bienvenida (logotipo y nombre comercial real), tarjetas de acceso a áreas de gestión y resumen de la ficha empresarial.
2. **EMPRESA**
   - **Mi empresa:** Consulta y edición de los datos comerciales y del logotipo almacenado en SQLite.
3. **GESTIÓN** *(Construida dinámicamente desde `moduleRegistry.ts`)*
   - Muestra los espacios preparados para **Inventario**, **Ventas**, **Clientes** y **Otros módulos futuros**, distinguiendo claramente entre módulos habilitados (`enabled_modules_json`, inicialmente `[]`) y espacios en planificación.
4. **APLICACIÓN**
   - **Configuración** *(Submenú expandible/colapsable)*:
     - **Apariencia:** Selección de tema Claro, Oscuro o Sistema Operativo.
     - **Usuarios y acceso:** Datos del administrador autenticado, cierre de sesión y cambio seguro de contraseña verificando la contraseña actual con Argon2id.
     - **Base de datos:** Estado del almacenamiento SQLite local, ruta de respaldos automáticos, comprobación de persistencia e historial de migraciones.
     - **Acerca de:** Información general del producto y versión instalada.
