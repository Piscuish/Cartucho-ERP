# ADR 0009 — Acceso desde celulares por la red local (solo consulta)

- **Estado:** Aceptada. Implementada en la rama `claude/acceso-celulares`.
- **Fecha:** 2026-11-12
- **Relacionada con:** ADR 0003 (preparación para red local), ADR 0005 (usuarios y roles).

## Contexto

El propietario quiere usar Cartucho ERP también desde el teléfono (Android primero). Pidió que el
celular trabaje **sobre los datos del PC por la red local** y que se puedan **ver documentos y
facturas**. AGENTS.md exige mantener SQLite en un solo equipo (§1.6, §5.6) y no introducir
sincronización ni bases remotas sin una decisión explícita (§11).

## Decisión

1. **El PC hace de servidor** (primera aplicación del «modo servidor» del ADR 0003). El programa de
   escritorio abre un servidor HTTP pequeño (`tiny_http`, 4 hilos) en el puerto 8787, configurable.
   SQLite sigue en un único equipo y nunca se comparte el archivo.
2. **Solo consulta.** La API expone `GET /api/invoices`, `/api/invoices/{id}`, `/api/quotes`,
   `/api/quotes/{id}` y `/api/me`, además de `POST /api/login` y `/api/logout`. Cualquier otro
   método responde 405. El celular no crea, modifica ni borra datos.
3. **Misma lógica y mismos permisos.** Cada petición se ejecuta con `AppState::gated_as`, que aplica la
   licencia y el rol del usuario del celular y llama a los mismos métodos de `LocalDatabase` que el
   programa. La sesión del celular se «presta» con `LocalDatabase::run_as_user` dentro del mismo
   bloqueo (Mutex) de la base y se restaura al terminar: la sesión del PC no cambia nunca.
4. **Autenticación.** Usuario y contraseña de Cartucho (Argon2id, `verify_credentials`, el mismo
   código que el inicio de sesión del PC). El servidor entrega un token aleatorio de 256 bits
   (`OsRng`) que vive **solo en memoria**. Las sesiones se cierran tras 12 horas sin uso, al apagar el
   acceso, con «Cerrar sesión en todos los celulares» o si el usuario se desactiva. Tras 5 intentos
   fallidos se bloquean los ingresos desde la red durante 2 minutos. Los mensajes no dicen si falló
   el usuario o la contraseña. Un rol sin facturas ni cotizaciones no puede entrar.
5. **Interfaz del celular.** Es una página web liviana incluida en el programa
   (`src-tauri/src/lan/mobile.html`, sin dependencias externas), con CSP restrictiva. Muestra listas
   con búsqueda y filtros, el detalle con saldo y abonos, y permite guardar en PDF o imprimir.
   Se abre en Chrome y se puede agregar a la pantalla de inicio como una app.
6. **Apagado por defecto.** Solo un administrador lo activa en **Configuración › Celulares**, donde
   se ven el código QR, la dirección, las sesiones abiertas y el puerto. La preferencia se guarda en
   `_app_metadata` (`lan_access_enabled`, `lan_access_port`) y el servidor se vuelve a abrir al
   iniciar el programa.

## Consecuencias

- **Sin cambios de esquema ni migraciones.** Solo se escriben dos claves en `_app_metadata`.
- Nuevas dependencias: `tiny_http`, `qrcode` (solo SVG) y `local-ip-address`.
- El PC debe estar encendido, con Cartucho abierto y en la misma red que el celular.
- Windows pide permiso de firewall la primera vez (hay que marcar «Redes privadas»).

## Limitaciones conocidas

- **HTTP sin cifrar dentro de la red local.** La contraseña y los datos viajan sin TLS por el WiFi.
  Se advierte en pantalla que solo se use en redes de confianza. Para cifrar con certificados en la
  red local haría falta emparejar cada celular con el PC (por ejemplo, fijando el certificado con el
  QR). Se deja como mejora futura.
- El bloqueo por intentos fallidos es global para la red local, no por dispositivo.
- La verificación Argon2id se hace con la base bloqueada (unos 100 ms por ingreso).

## Próximos pasos posibles

- APK de Android que use esta misma API (Tauri 2 móvil o un contenedor web) y encuentre el PC solo.
- Más módulos de consulta (clientes, inventario) y, si se decide, operaciones de escritura.
