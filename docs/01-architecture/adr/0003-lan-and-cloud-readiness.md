# ADR 0003 — Preparación para red local y nube

- **Estado:** Aceptada (preparación). Implementación del modo servidor: pendiente.
- **Fecha:** 2026-11-11

## Contexto

El propietario quiere que Cartucho ERP funcione hoy de forma local en un equipo, que más adelante pueda usarse **desde varios equipos en una red local** y, en el futuro, **en la nube**. AGENTS.md prohíbe compartir el archivo SQLite por una carpeta de red (§5.6) y cambiar el motor de persistencia sin autorización (§1.6).

## Decisión

1. **Toda la lógica de negocio vive en Rust, en `LocalDatabase` y los módulos `erp/*` y `data_admin.rs`**, independiente de Tauri. Los comandos de `lib.rs` son una capa delgada que solo llama a esos métodos.
2. **La interfaz React solo conoce el contrato de `@cartucho/shared`** y llama al backend a través de `services/systemClient.ts` (función `call(command, args)`). No hay SQL ni reglas de negocio en React.
3. Para la red local se añadirá un **modo servidor**: uno de los equipos ejecuta Cartucho ERP con un pequeño servidor HTTP (por ejemplo `axum`) que expone los mismos métodos de `LocalDatabase` con autenticación por sesión; los demás equipos usan la misma interfaz cambiando el transporte de `call()` de `invoke` a HTTP. SQLite sigue en un único equipo, así que no hay corrupción por acceso concurrente al archivo.
4. Para la nube se evaluará sincronización o un servidor central (ver `future-evolution.md`), reutilizando el mismo contrato.

## Consecuencias

- Hoy no se agrega infraestructura nueva ni dependencias de red.
- Añadir el modo servidor no requiere rehacer pantallas: solo un nuevo transporte en `systemClient.ts` y un binario/servidor que reutilice `LocalDatabase`.
- Pendiente de decidir: usuarios múltiples con roles (vendedor/administrador), bloqueo optimista para ediciones concurrentes y descubrimiento del servidor en la red.
