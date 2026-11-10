# Flujo de Trabajo en Git, Ramas, Commits y Pull Requests

## 1. Estrategia de Ramas

- **`main`**: Rama principal estable. Todo commit en `main` debe compilar limpiamente y pasar las verificaciones de TypeScript y Rust.
- **Ramas de trabajo:** Para nuevas funcionalidades, correcciones o documentación, utilizar prefijos descriptivos en minúsculas separados por guiones:
  - `feat/<descripcion-corta>` (ej. `feat/modulo-clientes-basico`)
  - `fix/<descripcion-corta>` (ej. `fix/ruta-sqlite-windows`)
  - `docs/<descripcion-corta>` (ej. `docs/actualizar-roadmap`)
  - `chore/<descripcion-corta>` (ej. `chore/actualizar-dependencias`)
  - `refactor/<descripcion-corta>`

---

## 2. Convención de Mensajes de Commit (Conventional Commits)

Los commits deben seguir el formato:

```text
<tipo>(<alcance opcional>): <descripción breve en imperativo>
```

Ejemplos válidos:
- `chore(monorepo): initialize phase 0 local-first desktop architecture`
- `feat(db): add sqlite migration runner and persistence checks`
- `docs(setup): add compilation requirements for Windows, Linux and macOS`

Tipos permitidos: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.

---

## 3. Reglas para Pull Requests

1. Completar la plantilla ubicada en `.github/pull_request_template.md`.
2. Verificar antes de abrir o fusionar el PR:
   - `pnpm typecheck`
   - `pnpm build`
   - `pnpm test:rust`
3. Asegurarse de que ningún archivo `.sqlite`, `.sqlite3` o `.db` haya sido agregado accidentalmente al control de versiones.
