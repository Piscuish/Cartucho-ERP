# Evolución Arquitectónica Futura (Opcional y No Implementada en Fase 0)

> [!NOTE]
> Nada de lo descrito en este documento debe implementarse en la Fase 0 ni en las primeras versiones locales. Se documenta únicamente para preservar una ruta de evolución limpia cuando el producto madure.

---

## 1. Servicios Opcionales Futuros

A medida que **Cartucho ERP** valide sus módulos básicos en instalaciones locales, podrían incorporarse de manera **100% opcional** los siguientes servicios complementarios:

1. **Copias de Seguridad (Backups):**
   - Exportación manual o programada de copias de seguridad locales cifradas/comprimidas de la base de datos SQLite (usando el API de `BACKUP` seguro de SQLite).
   - Opción futura para subir respaldos a almacenamiento en la nube del usuario o de un servicio complementario.
2. **Sincronización Entre Dispositivos:**
   - Capacidad opcional para que una empresa con más de un equipo sincronice sus catálogos y operaciones mediante un protocolo de sincronización basado en eventos/deltas, sin perder la capacidad de operar localmente sin Internet.
3. **Servidor Central Opcional (Laravel + PostgreSQL):**
   - Si en etapas avanzadas se requiere un servidor centralizado (en red local LAN o en la nube) para consolidar múltiples sucursales, dicho servidor podrá implementarse con **Laravel (PHP)** como API REST y **PostgreSQL** como base de datos central.

---

## 2. Regla Crítica sobre Acceso Simultáneo y Carpetas de Red

> [!CAUTION]
> **Prohibido compartir el archivo SQLite en una carpeta de red (SMB / Samba / NFS / Dropbox / OneDrive) para acceso simultáneo desde varios equipos.**

- **Justificación técnica:** SQLite depende de bloqueos de archivo del sistema operativo local (`fcntl` / `LockFileEx`). Los sistemas de archivos en red tienen implementaciones de bloqueo inconsistentes o con latencia que provocan **corrupción irreversible de la base de datos** cuando dos ordenadores escriben simultáneamente.
- **Solución correcta cuando se requiera multi-equipo:** Cada equipo mantendrá siempre su propia base de datos SQLite en su disco local y, cuando en el futuro se habilite el trabajo multi-equipo, la comunicación se realizará a través de una API de sincronización o un servidor central adecuadamente diseñado.
