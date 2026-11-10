# Guía de Instalación, Ejecución y Compilación Multiplataforma

Esta guía detalla los requisitos y pasos para instalar, ejecutar y compilar **Cartucho ERP** en **Windows 10/11**, **Linux** y **macOS**.

---

## 1. Requisitos Comunes (Todos los Sistemas Operativos)

1. **Node.js:** Versión `20.x` LTS o superior (`22.x` / `24.x` recomendadas).
2. **pnpm:** Versión `9.x` o superior (se puede activar con `corepack enable`).
3. **Rust (rustc y cargo):** Versión estable reciente instalada mediante [`rustup`](https://rustup.rs/).

---

## 2. Dependencias Nativas de Tauri 2 por Sistema Operativo

### 2.1. Windows 10 / 11
1. **Microsoft Visual Studio C++ Build Tools:**
   - Instalar *Visual Studio 2022 Build Tools* seleccionando la carga de trabajo **"Desarrollo para el escritorio con C++"** (*Desktop development with C++*).
2. **Microsoft Edge WebView2:**
   - Viene preinstalado en Windows 11 y en instalaciones actualizadas de Windows 10. Si no está presente, el instalador de Tauri o el runtime de Microsoft lo descargan automáticamente.

### 2.2. Linux (Debian, Ubuntu, Linux Mint y derivados)
Tauri 2 utiliza GTK3 y WebKitGTK para renderizar la ventana nativa en Linux. Ejecuta en una terminal con permisos de administrador:

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  pkg-config
```

*(En Fedora / RHEL: `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel`)*

### 2.3. macOS (Intel y Apple Silicon M1/M2/M3/M4)
1. **Xcode Command Line Tools:**
   ```bash
   xcode-select --install
   ```
2. `WKWebView` forma parte nativa de macOS, por lo que no requiere instalar ningún motor WebView adicional.

---

## 3. Instalación de Dependencias del Proyecto

Clona el repositorio e instala las dependencias de los workspaces con `pnpm`:

```bash
git clone https://github.com/Piscuish/Cartucho-ERP.git
cd Cartucho-ERP
pnpm install
```

---

## 4. Comandos de Desarrollo y Verificación

### 4.1. Ejecutar la Aplicación de Escritorio en Modo Desarrollo (con Hot-Reload)
Levanta simultáneamente Vite y la ventana nativa de Tauri 2 conectada a SQLite:

```bash
pnpm tauri:dev
```

> **Nota para compilación completa con la feature `desktop-tauri`:**
> Cuando todas las librerías gráficas del sistema operativo (`WebKit2GTK` en Linux, `WebView2` en Windows, `Cocoa/WKWebView` en macOS) están instaladas, puedes compilar la ventana nativa de Tauri activando la feature `desktop-tauri` en `apps/desktop/src-tauri/Cargo.toml` o pasando `--features desktop-tauri`.

### 4.2. Ejecutar solo el Frontend en Vista Previa Web (Vite)
Útil para trabajar rápidamente en diseño de interfaz o en entornos sin servidor gráfico:

```bash
pnpm dev
```

### 4.3. Verificar Tipado TypeScript y Compilación Frontend

```bash
pnpm typecheck
pnpm build
```

### 4.4. Ejecutar las Pruebas Automatizadas de Rust y Persistencia SQLite

```bash
pnpm test:rust
```

---

## 5. Compilar el Instalador de Escritorio para Producción

Para generar el ejecutable e instalador nativo (`.msi` / `.exe` en Windows, `.deb` / `.AppImage` en Linux, `.dmg` / `.app` en macOS):

```bash
pnpm tauri:build
```

Los instaladores generados se ubicarán en:
`apps/desktop/src-tauri/target/release/bundle/`
