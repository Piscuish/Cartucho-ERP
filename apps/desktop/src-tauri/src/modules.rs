//! Configuración funcional de la instalación: qué módulos están activos, cuáles se muestran
//! en el menú y cómo ve cada usuario su panel de inicio.
//!
//! Cuatro controles distintos, que no se mezclan:
//! - **Licencia**: qué módulos puede usar el cliente (`licensing.rs`).
//! - **Módulo activo**: el administrador lo habilitó para esta empresa (este archivo).
//! - **Mostrar en menú**: preferencia visual; no concede ni quita permisos (este archivo).
//! - **Rol**: qué puede hacer cada usuario (`users.rs`).
//!
//! Persistencia: claves JSON en la tabla `_app_metadata`, que existe desde la migración 1.
//! No cambia el esquema. Se guarda la lista de módulos **desactivados** (no la de activos):
//! así una instalación existente, que no tiene la clave, conserva todos sus módulos.
//! `installation_entitlements.enabled_modules_json` sigue sin uso funcional; la única fuente
//! de verdad de «módulo activo» es la clave `module_settings`.
//!
//! Desactivar u ocultar un módulo nunca borra datos.

use crate::db::LocalDatabase;
use crate::licensing::{module_requires, ALL_MODULES};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MODULE_SETTINGS_KEY: &str = "module_settings";
const UI_PREFS_KEY: &str = "ui_prefs";

pub fn module_label(module: &str) -> &'static str {
    match module {
        "invoices" => "Ventas y facturación",
        "quotes" => "Cotizaciones",
        "customers" => "Clientes",
        "catalog" => "Catálogo",
        "inventory" => "Inventario",
        "expenses" => "Gastos",
        "finance" => "Finanzas",
        _ => "Módulo",
    }
}

/// Por qué un módulo necesita a otro (se muestra al administrador).
pub fn dependency_reason(module: &str) -> &'static str {
    match module {
        "quotes" => "Las cotizaciones se convierten en facturas y comparten su numeración.",
        "inventory" => "Las existencias se asocian a los productos del catálogo.",
        "finance" => "El resumen financiero se calcula a partir de las ventas y sus cobros.",
        _ => "",
    }
}

/// Dependencias obligatorias de un módulo, incluidas las indirectas (en orden: la más básica primero).
pub fn required_chain(module: &str) -> Vec<&'static str> {
    let mut chain = Vec::new();
    let mut current = module_requires(module);
    // El límite evita un bucle infinito si alguien introduce un ciclo por error.
    while let Some(dep) = current {
        if chain.contains(&dep) || chain.len() > ALL_MODULES.len() {
            break;
        }
        chain.push(dep);
        current = module_requires(dep);
    }
    chain.reverse();
    chain
}

/// Módulos que dependen directamente de `module`.
pub fn dependents_of(module: &str) -> Vec<&'static str> {
    ALL_MODULES.iter().copied().filter(|m| module_requires(m) == Some(module)).collect()
}

/// Comprueba que el registro de módulos no tenga ciclos de dependencias.
pub fn validate_registry() -> Result<(), String> {
    for m in ALL_MODULES {
        let mut seen = vec![*m];
        let mut current = module_requires(m);
        while let Some(dep) = current {
            if !ALL_MODULES.contains(&dep) {
                return Err(format!("El módulo '{}' depende de '{}', que no existe.", m, dep));
            }
            if seen.contains(&dep) {
                return Err(format!("Ciclo de dependencias en el módulo '{}'.", m));
            }
            seen.push(dep);
            current = module_requires(dep);
        }
    }
    Ok(())
}

/// Activación y visibilidad de módulos de la instalación.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModuleSettings {
    /// Módulos que el administrador desactivó (el resto de la licencia está activo).
    #[serde(default)]
    pub disabled: BTreeSet<String>,
    /// Módulos que no se muestran en el menú. Solo visual.
    #[serde(default)]
    pub hidden: BTreeSet<String>,
}

impl ModuleSettings {
    fn sanitized(mut self) -> Self {
        self.disabled.retain(|m| ALL_MODULES.contains(&m.as_str()));
        self.hidden.retain(|m| ALL_MODULES.contains(&m.as_str()));
        self
    }

    /// Módulos realmente utilizables: los de la licencia que no están desactivados y cuyas
    /// dependencias también están activas.
    pub fn active_modules(&self, licensed: &BTreeSet<String>) -> BTreeSet<String> {
        crate::licensing::normalize_modules(licensed.iter().filter(|m| !self.disabled.contains(*m)).cloned())
    }
}

fn known_module(module: &str) -> Result<&'static str, String> {
    ALL_MODULES
        .iter()
        .copied()
        .find(|m| *m == module.trim())
        .ok_or_else(|| "Módulo desconocido.".to_string())
}

// ------------------------------------------------------------------ Apariencia del panel

pub const VALID_DASHBOARD_LAYOUTS: &[&str] = &["columns", "analytics", "widgets"];
pub const VALID_COLOR_THEMES: &[&str] = &["white", "black", "gray"];
pub const VALID_WIDGET_SIZES: &[&str] = &["small", "medium", "wide"];
/// Catálogo de widgets del panel (debe coincidir con `WIDGETS` en `@cartucho/shared`).
pub const VALID_WIDGETS: &[&str] = &[
    "salesKpi",
    "collectedKpi",
    "expensesKpi",
    "balanceKpi",
    "receivableKpi",
    "salesTrend",
    "incomeVsExpenses",
    "paymentMethods",
    "expensesByCategory",
    "topProducts",
    "lowStock",
    "recentInvoices",
    "overdueAlerts",
    "dueCalendar",
    "quickActions",
];

/// Preferencias visuales del panel. Son independientes entre sí: el diseño decide la
/// distribución, el tema decide los colores y los widgets deciden qué se muestra.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UiPreferences {
    pub dashboard_layout: String,
    /// `None`: se deriva del tema anterior (claro → Blanco, oscuro → Negro).
    #[serde(default)]
    pub color_theme: Option<String>,
    /// Widgets visibles, en orden. `None`: el conjunto predeterminado.
    #[serde(default)]
    pub dashboard_widgets: Option<Vec<String>>,
    #[serde(default)]
    pub widget_sizes: BTreeMap<String, String>,
}

impl Default for UiPreferences {
    fn default() -> Self {
        Self { dashboard_layout: "columns".into(), color_theme: None, dashboard_widgets: None, widget_sizes: BTreeMap::new() }
    }
}

impl UiPreferences {
    /// Para guardar: rechaza valores desconocidos.
    pub fn validated(&self) -> Result<Self, String> {
        if !VALID_DASHBOARD_LAYOUTS.contains(&self.dashboard_layout.as_str()) {
            return Err("Diseño del panel desconocido.".to_string());
        }
        if let Some(t) = &self.color_theme {
            if !VALID_COLOR_THEMES.contains(&t.as_str()) {
                return Err("Tema de color desconocido.".to_string());
            }
        }
        let mut widgets = None;
        if let Some(list) = &self.dashboard_widgets {
            let mut seen = Vec::new();
            for w in list {
                if !VALID_WIDGETS.contains(&w.as_str()) {
                    return Err("Widget desconocido.".to_string());
                }
                if !seen.contains(w) {
                    seen.push(w.clone());
                }
            }
            widgets = Some(seen);
        }
        for (w, s) in &self.widget_sizes {
            if !VALID_WIDGETS.contains(&w.as_str()) || !VALID_WIDGET_SIZES.contains(&s.as_str()) {
                return Err("Tamaño de widget no válido.".to_string());
            }
        }
        Ok(Self {
            dashboard_layout: self.dashboard_layout.clone(),
            color_theme: self.color_theme.clone(),
            dashboard_widgets: widgets,
            widget_sizes: self.widget_sizes.clone(),
        })
    }

    /// Para leer: cada valor desconocido vuelve a su predeterminado sin perder los demás.
    pub fn sanitized(self) -> Self {
        let d = Self::default();
        Self {
            dashboard_layout: if VALID_DASHBOARD_LAYOUTS.contains(&self.dashboard_layout.as_str()) { self.dashboard_layout } else { d.dashboard_layout },
            color_theme: self.color_theme.filter(|t| VALID_COLOR_THEMES.contains(&t.as_str())),
            dashboard_widgets: self.dashboard_widgets.map(|l| {
                let mut seen: Vec<String> = Vec::new();
                for w in l {
                    if VALID_WIDGETS.contains(&w.as_str()) && !seen.contains(&w) {
                        seen.push(w);
                    }
                }
                seen
            }),
            widget_sizes: self
                .widget_sizes
                .into_iter()
                .filter(|(w, s)| VALID_WIDGETS.contains(&w.as_str()) && VALID_WIDGET_SIZES.contains(&s.as_str()))
                .collect(),
        }
    }
}

fn user_prefs_key(user_id: i64) -> String {
    format!("{}:user:{}", UI_PREFS_KEY, user_id)
}

// ------------------------------------------------------------------ Operaciones

impl LocalDatabase {
    fn read_meta(&self, key: &str) -> Result<Option<String>, String> {
        use rusqlite::OptionalExtension;
        let conn = self.connect()?;
        conn.query_row("SELECT value FROM _app_metadata WHERE key = ?1", params![key], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Error leyendo la configuración: {}", e))
    }

    fn write_meta(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.connect()?;
        conn.execute(
            "INSERT INTO _app_metadata (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, Utc::now().to_rfc3339()],
        )
        .map_err(|e| format!("Error guardando la configuración: {}", e))?;
        Ok(())
    }

    /// Activación y visibilidad de módulos. Sin configuración guardada: todo activo y visible.
    pub fn module_settings(&self) -> Result<ModuleSettings, String> {
        Ok(self
            .read_meta(MODULE_SETTINGS_KEY)?
            .and_then(|v| serde_json::from_str::<ModuleSettings>(&v).ok())
            .map(|s| s.sanitized())
            .unwrap_or_default())
    }

    fn save_module_settings(&self, settings: &ModuleSettings) -> Result<(), String> {
        let json = serde_json::to_string(settings).map_err(|e| format!("Error serializando los módulos: {}", e))?;
        self.write_meta(MODULE_SETTINGS_KEY, &json)
    }

    /// Activa o desactiva un módulo para la instalación. Solo administrador.
    ///
    /// - Activar exige que el módulo y todas sus dependencias estén en la licencia. Si una
    ///   dependencia está desactivada, se activa también solo cuando `with_dependencies` es
    ///   verdadero (la interfaz lo confirma antes con el usuario).
    /// - Desactivar se rechaza si otro módulo activo depende de este.
    /// - Es idempotente y se guarda en una sola escritura. Nunca borra datos.
    pub fn set_module_active(
        &self,
        module: &str,
        active: bool,
        with_dependencies: bool,
        licensed: &BTreeSet<String>,
    ) -> Result<ModuleSettings, String> {
        self.require_admin()?;
        validate_registry()?;
        let module = known_module(module)?;
        let mut settings = self.module_settings()?;
        if active {
            if !licensed.contains(module) {
                return Err(format!("{} no está incluido en tu licencia.", module_label(module)));
            }
            for dep in required_chain(module) {
                if !licensed.contains(dep) {
                    return Err(format!(
                        "{} necesita {}, que no está incluido en tu licencia.",
                        module_label(module),
                        module_label(dep)
                    ));
                }
                if settings.disabled.contains(dep) {
                    if !with_dependencies {
                        return Err(format!(
                            "Para utilizar {} también debe estar activo {}.",
                            module_label(module),
                            module_label(dep)
                        ));
                    }
                    settings.disabled.remove(dep);
                }
            }
            settings.disabled.remove(module);
        } else {
            let active_now = settings.active_modules(licensed);
            let blockers: Vec<&str> = dependents_of(module).into_iter().filter(|d| active_now.contains(*d)).collect();
            if let Some(first) = blockers.first() {
                return Err(format!(
                    "No se puede desactivar {} porque {} depende de él. Desactiva {} primero o revisa los módulos que lo necesitan.",
                    module_label(module),
                    module_label(first),
                    module_label(first)
                ));
            }
            settings.disabled.insert(module.to_string());
        }
        self.save_module_settings(&settings)?;
        Ok(settings)
    }

    /// Muestra u oculta un módulo en el menú. Solo visual: no cambia permisos ni datos.
    pub fn set_module_visible(&self, module: &str, visible: bool) -> Result<ModuleSettings, String> {
        self.require_admin()?;
        let module = known_module(module)?;
        let mut settings = self.module_settings()?;
        if visible {
            settings.hidden.remove(module);
        } else {
            settings.hidden.insert(module.to_string());
        }
        self.save_module_settings(&settings)?;
        Ok(settings)
    }

    fn read_ui_prefs(&self, key: &str) -> Result<Option<UiPreferences>, String> {
        Ok(self.read_meta(key)?.and_then(|v| serde_json::from_str::<UiPreferences>(&v).ok()).map(|p| p.sanitized()))
    }

    /// Preferencias del panel que aplican a la sesión: las del usuario si eligió las suyas;
    /// si no, las predeterminadas de la instalación. El segundo valor indica si son propias.
    pub fn effective_ui_preferences(&self) -> Result<(UiPreferences, bool), String> {
        if let Some(user) = self.get_authenticated_user()? {
            if let Some(own) = self.read_ui_prefs(&user_prefs_key(user.id))? {
                return Ok((own, true));
            }
        }
        Ok((self.read_ui_prefs(UI_PREFS_KEY)?.unwrap_or_default(), false))
    }

    /// Guarda las preferencias del panel: `installation` (solo administrador) o las del
    /// usuario de la sesión.
    pub fn set_ui_preferences(&self, prefs: &UiPreferences, installation: bool) -> Result<(), String> {
        let user = self.require_authenticated_user()?;
        let valid = prefs.validated()?;
        let json = serde_json::to_string(&valid).map_err(|e| format!("Error serializando la apariencia: {}", e))?;
        if installation {
            self.require_admin()?;
            self.write_meta(UI_PREFS_KEY, &json)
        } else {
            self.write_meta(&user_prefs_key(user.id), &json)
        }
    }

    /// Restaura los valores predeterminados: el usuario vuelve a los de la instalación, o la
    /// instalación a los de fábrica. Solo quita la preferencia visual; no toca datos del negocio.
    pub fn reset_ui_preferences(&self, installation: bool) -> Result<(), String> {
        let user = self.require_authenticated_user()?;
        let key = if installation {
            self.require_admin()?;
            UI_PREFS_KEY.to_string()
        } else {
            user_prefs_key(user.id)
        };
        let conn = self.connect()?;
        conn.execute("DELETE FROM _app_metadata WHERE key = ?1", params![key])
            .map_err(|e| format!("Error restaurando la apariencia: {}", e))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{CompleteInitialSetupInput, CreateInitialAdminInput, SaveCompanyProfileInput};
    use tempfile::TempDir;

    fn all() -> BTreeSet<String> {
        ALL_MODULES.iter().map(|m| m.to_string()).collect()
    }

    fn open(dir: &TempDir) -> LocalDatabase {
        let mut db = LocalDatabase::open_in_dir(dir.path()).unwrap();
        db.complete_initial_setup(&CompleteInitialSetupInput {
            company: SaveCompanyProfileInput { trade_name: "Prueba".into(), ..Default::default() },
            admin: CreateInitialAdminInput {
                full_name: "Admin".into(),
                username: "admin".into(),
                password: "ClaveSegura123".into(),
                password_confirm: "ClaveSegura123".into(),
            },
            paper_size: None,
        })
        .unwrap();
        db
    }

    #[test]
    fn registry_has_no_cycles_and_chains_resolve() {
        validate_registry().unwrap();
        assert_eq!(required_chain("inventory"), vec!["catalog"]);
        assert!(required_chain("catalog").is_empty());
        assert_eq!(dependents_of("invoices"), vec!["quotes", "finance"]);
    }

    #[test]
    fn default_is_everything_active_and_visible() {
        let dir = TempDir::new().unwrap();
        let db = open(&dir);
        let s = db.module_settings().unwrap();
        assert!(s.disabled.is_empty() && s.hidden.is_empty());
        assert_eq!(s.active_modules(&all()), all());
    }

    #[test]
    fn deactivation_respects_dependents_and_keeps_data() {
        let dir = TempDir::new().unwrap();
        let db = open(&dir);
        let before: i64 = db.connect().unwrap().query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();

        // Catálogo no se puede desactivar mientras Inventario esté activo.
        let err = db.set_module_active("catalog", false, false, &all()).unwrap_err();
        assert!(err.contains("Inventario depende"), "{}", err);
        assert!(db.module_settings().unwrap().disabled.is_empty());

        db.set_module_active("inventory", false, false, &all()).unwrap();
        // Idempotente.
        let s = db.set_module_active("inventory", false, false, &all()).unwrap();
        assert_eq!(s.disabled.len(), 1);
        let s = db.set_module_active("catalog", false, false, &all()).unwrap();
        assert!(!s.active_modules(&all()).contains("catalog"));

        // Activar Inventario sin Catálogo: se explica; con confirmación se activan ambos.
        let err = db.set_module_active("inventory", true, false, &all()).unwrap_err();
        assert!(err.contains("también debe estar activo Catálogo"), "{}", err);
        let s = db.set_module_active("inventory", true, true, &all()).unwrap();
        assert!(s.disabled.is_empty());

        // Los datos no se tocan y la configuración persiste al reabrir.
        db.set_module_active("expenses", false, false, &all()).unwrap();
        db.set_module_visible("customers", false).unwrap();
        let after: i64 = db.connect().unwrap().query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0)).unwrap();
        assert_eq!(before, after);
        drop(db);
        let reopened = LocalDatabase::open_in_dir(dir.path()).unwrap();
        let s = reopened.module_settings().unwrap();
        assert!(s.disabled.contains("expenses") && s.hidden.contains("customers"));
        // Ocultar no desactiva.
        assert!(s.active_modules(&all()).contains("customers"));
    }

    #[test]
    fn activation_requires_license_for_module_and_dependencies() {
        let dir = TempDir::new().unwrap();
        let db = open(&dir);
        let licensed: BTreeSet<String> = ["invoices", "inventory"].iter().map(|m| m.to_string()).collect();
        assert!(db.set_module_active("expenses", true, true, &licensed).unwrap_err().contains("licencia"));
        let err = db.set_module_active("inventory", true, true, &licensed).unwrap_err();
        assert!(err.contains("necesita Catálogo"), "{}", err);
        assert!(db.set_module_active("nomina", true, true, &all()).is_err());
    }

    #[test]
    fn only_admin_changes_modules_and_bad_json_falls_back() {
        let dir = TempDir::new().unwrap();
        let mut db = open(&dir);
        db.connect()
            .unwrap()
            .execute("INSERT INTO _app_metadata (key, value, updated_at) VALUES ('module_settings', '{roto', 'x')", [])
            .unwrap();
        assert_eq!(db.module_settings().unwrap(), ModuleSettings::default());
        db.connect()
            .unwrap()
            .execute("UPDATE _app_metadata SET value = '{\"disabled\":[\"nomina\",\"expenses\"]}' WHERE key = 'module_settings'", [])
            .unwrap();
        assert_eq!(db.module_settings().unwrap().disabled.len(), 1);
        db.logout();
        assert!(db.set_module_active("expenses", true, false, &all()).is_err());
        assert!(db.set_module_visible("expenses", false).is_err());
    }

    #[test]
    fn ui_preferences_per_user_with_installation_default() {
        let dir = TempDir::new().unwrap();
        let db = open(&dir);
        // Sin nada guardado: predeterminados, sin romper la apariencia anterior.
        let (p, own) = db.effective_ui_preferences().unwrap();
        assert_eq!(p, UiPreferences::default());
        assert!(!own);
        assert_eq!(db.get_preferences().unwrap().ui.dashboard_layout, "columns");

        let install = UiPreferences { dashboard_layout: "analytics".into(), color_theme: Some("gray".into()), ..Default::default() };
        db.set_ui_preferences(&install, true).unwrap();
        assert_eq!(db.effective_ui_preferences().unwrap(), (install.clone(), false));

        let mine = UiPreferences {
            dashboard_layout: "widgets".into(),
            color_theme: Some("black".into()),
            dashboard_widgets: Some(vec!["salesKpi".into(), "lowStock".into(), "salesKpi".into()]),
            widget_sizes: [("salesKpi".to_string(), "wide".to_string())].into_iter().collect(),
        };
        db.set_ui_preferences(&mine, false).unwrap();
        let (p, own) = db.effective_ui_preferences().unwrap();
        assert!(own);
        assert_eq!(p.dashboard_widgets.as_deref(), Some(&["salesKpi".to_string(), "lowStock".to_string()][..]));

        // Valores desconocidos se rechazan al guardar.
        for bad in [
            UiPreferences { dashboard_layout: "neon".into(), ..Default::default() },
            UiPreferences { color_theme: Some("rosa".into()), ..Default::default() },
            UiPreferences { dashboard_widgets: Some(vec!["nomina".into()]), ..Default::default() },
        ] {
            assert!(db.set_ui_preferences(&bad, false).is_err());
        }

        // Persisten al cerrar y reabrir; sin sesión se usan las de la instalación.
        drop(db);
        let mut db = LocalDatabase::open_in_dir(dir.path()).unwrap();
        assert_eq!(db.effective_ui_preferences().unwrap(), (install.clone(), false));
        db.login("admin", "ClaveSegura123").unwrap();
        assert_eq!(db.effective_ui_preferences().unwrap().0, p);

        // Restaurar: el usuario vuelve a lo de la instalación; la apariencia anterior sigue intacta.
        db.reset_ui_preferences(false).unwrap();
        assert_eq!(db.effective_ui_preferences().unwrap(), (install, false));
        db.reset_ui_preferences(true).unwrap();
        assert_eq!(db.effective_ui_preferences().unwrap().0, UiPreferences::default());
        assert_eq!(db.get_preferences().unwrap().appearance, crate::db::Appearance::default());
    }
}
