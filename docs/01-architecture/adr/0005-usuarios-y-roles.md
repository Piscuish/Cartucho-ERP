# ADR 0005 — Usuarios y roles

- **Estado:** Aceptada.
- **Fecha:** 2026-11-11

## Contexto

El propietario quiere que cada instalación tenga varios usuarios (por ejemplo, el dueño y sus vendedores)
y que el administrador decida qué puede hacer cada uno, sin poder dar más de lo que permite la licencia.

## Decisión

1. **Migración v5 (`0005_create_roles`)**: crea la tabla `roles` (`role_key` único, `name` único sin
   distinguir mayúsculas, `is_system`, `permissions_json`) e inserta Administrador (sistema), Vendedor y
   Solo consulta. No modifica tablas existentes: `app_users.role_key` ya existía y los usuarios actuales
   tienen `admin`, que es la clave del rol Administrador. Antes de migrar se crea el respaldo verificado
   `pre_migration_v4_to_v5` (mecanismo existente, AGENTS.md §3 y §9).
2. **Permisos por módulo**: `read` (ver) o `write` (ver y modificar). El acceso real es **licencia ∩ rol**.
   Al guardar un rol, Rust rechaza módulos que no estén en la licencia.
3. **Administrador**: acceso total; único que gestiona usuarios, roles, empresa, facturación, apariencia,
   licencia y respaldos. Su rol no se borra ni pierde permisos (solo se renombra).
4. **Compuertas**: `AppState::gated` aplica primero la licencia (`check_gate`) y luego el rol (`role_gate`).
   Nueva compuerta `Gate::Admin` para apariencia y gestión de usuarios/roles. El inicio (`get_dashboard`)
   requiere ver Facturas; sin ese permiso la interfaz muestra solo accesos a los módulos permitidos.
5. **Protecciones**: siempre queda al menos un administrador activo (transacción revertida si no); nadie
   puede quitarse su propio rol de administrador ni desactivarse; un rol con usuarios no se borra;
   las contraseñas siguen con Argon2id; los usuarios desactivados no inician sesión y sus registros se conservan.
6. `app_users.permissions_json` queda sin uso (los permisos salen del rol); no se elimina para no hacer
   cambios destructivos.

## Consecuencias

- La interfaz oculta lo que el rol no permite y los paneles se abren en solo lectura cuando el rol solo puede ver.
- Rust valida todo de nuevo: ocultar botones no es la barrera de seguridad.
