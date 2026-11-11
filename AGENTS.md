# Instrucciones obligatorias para agentes de desarrollo --- Cartucho ERP

> **Prioridad:** Estas reglas son obligatorias en toda tarea que
> modifique, consulte, migre, pruebe o dependa de la base de datos, la
> persistencia, la autenticación o la configuración de la aplicación.
>
> **Lectura obligatoria:** Antes de comenzar CUALQUIER tarea en este
> repositorio, lee este archivo completo. No asumas que lo recuerdas de
> una sesión anterior. Si una instrucción de una tarea parece
> contradecir estas reglas, detente y solicita aclaración antes de
> realizar cambios.

## 1. Principios no negociables

1.  **Los datos del usuario son prioritarios.** Nunca sacrifiques datos
    existentes para simplificar una implementación.
2.  **No realizar cambios destructivos por iniciativa propia.** No
    borrar bases de datos, tablas, columnas, registros, archivos de
    respaldo ni datos de usuario.
3.  **No reinicializar ni reemplazar una base existente** para resolver
    errores de migración o pruebas.
4.  **No usar datos reales del usuario en pruebas destructivas.** Las
    pruebas deben usar bases temporales o copias aisladas.
5.  **No afirmar que los datos están seguros solo porque compila el
    proyecto.** La seguridad de persistencia requiere pruebas
    específicas.
6.  **No cambiar la arquitectura de persistencia** (SQLite local-first)
    ni introducir otro motor, servicio o infraestructura sin
    autorización explícita.
7.  **Una instalación corresponde a una sola empresa.** No implementar
    múltiples empresas/tenants dentro de una instalación salvo nueva
    decisión explícita del propietario del proyecto.

## 2. Obligación antes de cada tarea

Antes de editar archivos:

1.  Leer este documento completo.
2.  Revisar el estado actual de Git (`git status`, rama y últimos
    commits).
3.  Identificar si la tarea afecta directa o indirectamente:
    -   SQLite, `rusqlite` o archivos de base de datos.
    -   Migraciones y versión del esquema.
    -   Comandos IPC entre React y Rust.
    -   Modelos, contratos compartidos o validaciones.
    -   Inicio de sesión, usuarios, contraseñas o permisos.
    -   Preferencias, configuración o rutas de datos.
    -   Copias de seguridad, restauración o actualización de versiones.
4.  Inspeccionar el código y las pruebas existentes antes de proponer
    cambios.
5.  Explicar brevemente el riesgo y el plan de verificación antes de una
    modificación potencialmente destructiva.

Si el archivo no está disponible, no continúes con cambios que puedan
afectar persistencia o datos: informa del bloqueo y solicita que se
restaure la instrucción.

## 3. Migraciones de base de datos

1.  Toda modificación del esquema debe implementarse mediante una
    **nueva migración versionada**.
2.  Nunca editar, renombrar ni eliminar una migración que ya haya sido
    publicada o aplicada en una instalación. Corregir mediante una nueva
    migración.
3.  Las migraciones deben ser deterministas, idempotentes en su
    mecanismo de control y registrarse correctamente en la tabla de
    migraciones.
4.  Ejecutar cada migración dentro de una transacción cuando SQLite y la
    operación lo permitan.
5.  Si una migración falla, debe revertirse por completo cuando sea
    transaccional; no dejar el esquema en un estado parcial.
6.  No eliminar ni reconstruir tablas para cambiar su estructura sin un
    plan explícito de preservación, copia y validación de datos.
7.  Para renombrar, dividir, combinar o cambiar tipos de columnas,
    definir cómo se trasladan los valores existentes y cómo se verifica
    que no se pierdan.
8.  Mantener compatibilidad con las versiones de esquema que la
    aplicación realmente pueda encontrar en instalaciones existentes.
9.  Probar tanto una instalación nueva como la actualización desde una
    base creada con la versión anterior.
10. Documentar cualquier cambio de esquema y su estrategia de
    recuperación.

## 4. Copias de seguridad y restauración

1.  Antes de una migración o actualización que pueda afectar datos, debe
    existir una copia de seguridad válida y recuperable.
2.  No copiar únicamente el archivo principal de SQLite mientras la base
    está abierta y en modo WAL. Usar la API de backup de SQLite o un
    procedimiento seguro que contemple WAL.
3.  Una copia no se considera válida solo porque el archivo exista:
    verificar que puede abrirse y que supera comprobaciones de
    integridad.
4.  Nunca sobrescribir la única copia de seguridad conocida.
5.  La restauración debe proteger primero el estado actual, validar la
    copia seleccionada y explicar claramente qué datos serán
    reemplazados.
6.  No implementar borrado automático de respaldos sin una política de
    retención explícita y segura.
7.  Mantener las copias fuera de la carpeta de instalación y del
    repositorio. No subir bases de datos ni respaldos con información
    privada a Git.

## 5. Integridad, concurrencia y transacciones

1.  Mantener habilitadas y verificar las restricciones de integridad
    referencial (`foreign_keys`) en cada conexión.
2.  Usar transacciones para operaciones que deban completarse como una
    unidad.
3.  Definir restricciones `NOT NULL`, `UNIQUE`, `CHECK` y claves
    foráneas cuando correspondan al modelo.
4.  Validar los datos en el backend Rust; la validación de React mejora
    la experiencia, pero no es una barrera de integridad suficiente.
5.  Manejar errores de escritura y bloqueo de SQLite sin descartar
    silenciosamente operaciones.
6.  No compartir el archivo SQLite mediante una carpeta de red como
    mecanismo multiusuario.
7.  Revisar el comportamiento de WAL, checkpoints y cierre ordenado
    cuando se modifique la capa de base de datos.

## 6. Seguridad de credenciales y acceso

1.  Nunca guardar contraseñas en texto plano, logs, archivos de
    configuración ni preferencias.
2.  Al implementar autenticación, almacenar únicamente hashes de
    contraseña generados con un algoritmo de derivación de contraseñas
    apropiado y parámetros seguros (por ejemplo, Argon2id).
3.  No inventar ni implementar criptografía propia.
4.  No incluir contraseñas, tokens, datos personales ni contenido de la
    base de datos en mensajes de error o telemetría.
5.  La autenticación local controla el acceso a la aplicación, pero no
    debe describirse como cifrado de la base de datos ni como protección
    frente a alguien con acceso directo a los archivos del equipo.
6.  No añadir usuarios, roles o permisos ficticios para aparentar que la
    seguridad está implementada.

## 7. Pruebas obligatorias

Cuando un cambio pueda afectar persistencia, ejecutar las pruebas
pertinentes y añadir nuevas pruebas para el comportamiento nuevo. Como
mínimo, según corresponda:

-   Creación de una base de datos nueva.
-   Apertura de una base ya existente.
-   Escritura, lectura y persistencia después de cerrar y reabrir.
-   Migración desde la versión anterior del esquema.
-   Migración fallida y rollback.
-   Conservación de todos los registros previos tras una migración.
-   Restricciones de claves foráneas e integridad.
-   Manejo de errores y bloqueos de escritura.
-   Restauración de una copia de seguridad en una base temporal.
-   Inicio de sesión correcto e incorrecto, sin revelar secretos, cuando
    exista autenticación.
-   Pruebas de regresión para comandos IPC y vistas afectadas.

Las pruebas deben ejecutarse sobre bases temporales aisladas. Nunca
apuntar pruebas a la base de datos de trabajo del usuario.

## 8. Reglas de Git y cambios

1.  Revisar `git status` antes de editar y antes de hacer commit.
2.  No sobrescribir cambios del usuario ni descartar archivos
    modificados que no sean parte de la tarea.
3.  Mantener los cambios acotados al alcance solicitado.
4.  Separar commits por etapa o conjunto coherente de cambios.
5.  No hacer `push`, publicar releases ni ejecutar operaciones
    destructivas sin la autorización correspondiente.
6.  No incluir archivos SQLite, WAL/SHM, respaldos, secretos,
    credenciales ni datos reales en Git.
7.  Si una prueba modifica archivos persistentes, confirmar que no dejó
    cambios o datos de prueba en el repositorio.

## 9. Protocolo de actualización segura

Antes de considerar terminada una actualización que afecte datos:

1.  Identificar las versiones de aplicación y esquema de origen y
    destino.
2.  Crear y validar un respaldo recuperable.
3.  Ejecutar la actualización en una copia de prueba que reproduzca una
    instalación anterior.
4.  Verificar que se conservan los registros y relaciones previas.
5.  Ejecutar pruebas de integridad de SQLite.
6.  Probar apertura, lectura y escritura con la nueva versión.
7.  Documentar resultado, limitaciones y procedimiento de recuperación.
8.  Si cualquiera de estas comprobaciones falla, detener la entrega y
    reportar el problema. No ocultarlo ni declarar éxito.

## 10. Informe obligatorio al finalizar cada tarea

Todo informe de Antigravity debe incluir:

-   Archivos modificados y motivo.
-   Si se afectó la base de datos, el esquema, migraciones, IPC o
    autenticación.
-   Migraciones añadidas y estrategia de preservación de datos, si
    aplica.
-   Copia de seguridad utilizada o explicación de por qué no era
    necesaria.
-   Comandos de prueba ejecutados y resultados reales.
-   Pruebas de regresión y actualización desde una base anterior, cuando
    correspondan.
-   Riesgos o limitaciones que sigan pendientes.
-   Estado de Git y commit creado, si fue autorizado.

No declarar "seguro", "completo" o "verificado" aquello que no se haya
probado.

## 11. Alcance actual del proyecto

-   Aplicación de escritorio: Tauri 2 + React + TypeScript + Rust.
-   Persistencia local: SQLite mediante `rusqlite`.
-   Enfoque: local-first; la aplicación debe funcionar sin Internet.
-   Una empresa por instalación.
-   No introducir sincronización, multiempresa, base de datos remota ni
    procesamiento de pagos sin una decisión explícita.
-   No desarrollar módulos comerciales fuera del alcance autorizado.

------------------------------------------------------------------------

## Confirmación requerida del agente

Al comenzar cada tarea, confirma en tu plan de trabajo:

> "He leído las instrucciones obligatorias de `AGENTS.md`. Revisaré el
> estado de Git, identificaré los riesgos de persistencia y seguiré las
> reglas de protección de datos antes de modificar el proyecto."

Esta confirmación no sustituye las comprobaciones técnicas. Debes
cumplir las reglas aunque no se te recuerden en el prompt de la tarea.
