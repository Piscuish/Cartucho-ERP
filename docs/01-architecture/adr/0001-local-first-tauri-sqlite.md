# ADR-0001: Arquitectura de Escritorio Local-First con Tauri 2, Rust y SQLite

- **Estado:** Aceptado (Reemplaza la propuesta inicial de servidor cliente-servidor obligatorio)
- **Fecha:** 2026-11-10

## Contexto
Para las primeras versiones de **Cartucho ERP**, se requiere una plataforma que el usuario pueda instalar y probar inmediatamente en su propio ordenador sin configurar servidores web, motores de bases de datos externos ni depender de conexión a Internet.

## Decisión
1. Construir **Cartucho ERP** desde su versión inicial como una aplicación de escritorio autónoma (**Local-First**) utilizando **Tauri 2** (Rust) y **React + TypeScript + Vite**.
2. Utilizar **SQLite** como única base de datos de la primera versión, accedida de forma centralizada desde la capa Rust mediante `rusqlite` (con la característica `bundled`).
3. Almacenar el archivo de base de datos exclusivamente en el directorio de datos de aplicación del sistema operativo correspondiente, nunca en la carpeta de instalación ni dentro del repositorio Git.
4. Posponer cualquier servidor central (Laravel + PostgreSQL), sincronización en la nube o respaldos remotos para etapas futuras opcionales.

## Consecuencias
- **Positivas:** Instalación inmediata para cada cliente; funcionamiento 100% offline garantizado; cero costos de infraestructura en la nube; latencia de lectura/escritura sub-milisegundo al operar contra un archivo SQLite local en modo WAL; código base mucho más pequeño, estable y fácil de mantener.
- **Negativas:** Cada instalación es inicialmente monopuesto/local; cuando en el futuro se requiera acceso simultáneo desde múltiples equipos, deberá añadirse una capa de sincronización o servidor central en lugar de compartir el archivo SQLite por red.
