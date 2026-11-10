## Resumen del Cambio

Describe brevemente qué hace este Pull Request y por qué es necesario.

## Tipo de Cambio

- [ ] `feat`: Nueva funcionalidad
- [ ] `fix`: Corrección de error
- [ ] `docs`: Cambios únicamente en documentación
- [ ] `refactor`: Refactorización de código sin cambios funcionales
- [ ] `test`: Adición o actualización de pruebas
- [ ] `chore`: Tareas de mantenimiento, configuración o compilación

## Lista de Verificación

- [ ] El código compila sin errores de TypeScript (`pnpm typecheck`).
- [ ] El frontend construye correctamente (`pnpm build`).
- [ ] Las pruebas y verificaciones de Rust/SQLite pasan (`cargo test`).
- [ ] No se han incluido bases de datos SQLite locales (`.sqlite`, `.db`) ni secretos en el commit.
- [ ] Se ha respetado la compatibilidad multiplataforma (Windows, Linux y macOS).
- [ ] La documentación en `docs/` ha sido actualizada si aplica.
