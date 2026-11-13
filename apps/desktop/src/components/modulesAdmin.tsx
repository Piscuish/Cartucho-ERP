/**
 * Configuración › Módulos y apartados (solo administrador).
 *
 * Centro de administración funcional de la instalación. Distingue cuatro controles:
 *  - Disponible por licencia: si la licencia incluye el módulo.
 *  - Módulo activo: habilitado para esta empresa.
 *  - Mostrar en menú: solo visual; ocultarlo no quita permisos ni borra datos.
 *  - Permisos por rol: qué puede hacer cada usuario (se editan en Usuarios y roles).
 *
 * Las reglas de dependencias se validan en Rust; esta pantalla las explica antes de pedirlas.
 */
import { useEffect, useState } from "react";
import { ArrowRight, Clock, Link2, Lock, Users } from "lucide-react";
import { MODULE_REQUIRES } from "@cartucho/shared";
import type { ModuleKey, Role } from "@cartucho/shared";
import type { PageProps } from "./views";
import { MODULE_DEFINITIONS, ModuleDefinition, ModuleGroup, PLANNED_MODULES } from "../config/moduleRegistry";
import { api } from "../services/systemClient";
import { errorMessage } from "../lib/format";
import { useAccess } from "../lib/access";
import { Badge, Button, ConfirmDialog, Modal, Switch, useToast } from "./ui";

const GROUPS: ModuleGroup[] = ["Operación diaria", "Dinero", "Administración"];
const nameOf = (k: ModuleKey) => MODULE_DEFINITIONS.find((m) => m.key === k)?.name ?? k;

/** Dependencias obligatorias, incluidas las indirectas (la más básica primero). */
function requiredChain(k: ModuleKey): ModuleKey[] {
  const chain: ModuleKey[] = [];
  for (let dep = MODULE_REQUIRES[k]; dep && !chain.includes(dep); dep = MODULE_REQUIRES[dep]) chain.unshift(dep);
  return chain;
}

type Pending =
  | { kind: "activate-with"; module: ModuleDefinition; deps: ModuleKey[] }
  | { kind: "blocked"; title: string; text: string }
  | { kind: "deactivate"; module: ModuleDefinition };

export function ModulesSettings({ overview, setOverview, navigate }: PageProps) {
  const access = useAccess();
  const toast = useToast();
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [busy, setBusy] = useState<ModuleKey | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const settings = overview.moduleSettings ?? { disabled: [], hidden: [] };
  const disabled = new Set(settings.disabled);

  useEffect(() => {
    api.listRoles().then(setRoles).catch(() => setRoles([]));
  }, []);

  /** `inDialog`: el error lo muestra el propio diálogo de confirmación. */
  const run = async (key: ModuleKey, action: () => Promise<typeof overview>, done: string, inDialog = false) => {
    setBusy(key);
    try {
      setOverview(await action());
      toast(done);
    } catch (e) {
      if (inDialog) throw e;
      // El backend es quien decide: si rechaza, se muestra su explicación.
      setPending({ kind: "blocked", title: "No se pudo aplicar el cambio", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const toggleActive = (m: ModuleDefinition, wantActive: boolean) => {
    if (wantActive) {
      const chain = requiredChain(m.key);
      const unlicensed = chain.find((d) => !access.licensed(d));
      if (unlicensed) {
        setPending({ kind: "blocked", title: `No se puede activar ${m.name}`, text: `${m.name} necesita ${nameOf(unlicensed)}, que no está incluido en tu licencia.` });
        return;
      }
      const missing = chain.filter((d) => disabled.has(d));
      if (missing.length > 0) {
        setPending({ kind: "activate-with", module: m, deps: missing });
        return;
      }
      void run(m.key, () => api.setModuleActive(m.key, true, false), `${m.name} quedó activo`);
    } else {
      const blockers = MODULE_DEFINITIONS.filter((x) => MODULE_REQUIRES[x.key] === m.key && access.active(x.key));
      if (blockers.length > 0) {
        const first = blockers[0].name;
        setPending({
          kind: "blocked",
          title: `No se puede desactivar ${m.name}`,
          text: `No se puede desactivar ${m.name} porque ${blockers.map((b) => b.name).join(" y ")} ${blockers.length === 1 ? "depende" : "dependen"} de él. Desactiva ${first} primero o revisa los módulos que lo necesitan. No se elimina ningún dato.`,
        });
        return;
      }
      setPending({ kind: "deactivate", module: m });
    }
  };

  const roleSummary = (k: ModuleKey): string => {
    if (!roles) return "…";
    const others = roles.filter((r) => !r.isSystem);
    const withAccess = others.filter((r) => r.permissions[k]);
    if (others.length === 0) return "Solo el administrador";
    if (withAccess.length === 0) return "Ningún rol además del administrador";
    if (withAccess.length === others.length) return "Todos los roles";
    return `${withAccess.length} de ${others.length} roles`;
  };

  return (
    <>
      <div className="card mb-16">
        <div className="card-body">
          <div className="form-section-title">Módulos y apartados</div>
          <div className="form-section-desc">
            Decide qué módulos utiliza tu empresa y cuáles aparecen en el menú. Desactivar u ocultar un módulo <strong>nunca borra sus datos</strong>: quedan guardados y vuelven al reactivarlo.
          </div>
          <div className="mod-legend">
            <div>
              <strong>Activo</strong>
              <span>Habilita las pantallas y operaciones del módulo para esta empresa.</span>
            </div>
            <div>
              <strong>Mostrar en menú</strong>
              <span>Solo decide si aparece en la navegación. No es una medida de seguridad ni cambia permisos.</span>
            </div>
            <div>
              <strong>Permisos por rol</strong>
              <span>
                Quién puede ver o modificar cada módulo se define en{" "}
                <button type="button" className="link-btn" onClick={() => navigate({ page: "settings", tab: "users" })}>
                  Usuarios y roles
                </button>
                .
              </span>
            </div>
          </div>
        </div>
      </div>

      {GROUPS.map((group) => {
        const mods = MODULE_DEFINITIONS.filter((m) => m.group === group);
        if (mods.length === 0) return null;
        return (
          <div className="card mb-16" key={group}>
            <div className="card-header">
              <div className="card-title">{group}</div>
            </div>
            <ul className="mod-list">
              {mods.map((m) => {
                const licensed = access.licensed(m.key);
                const on = licensed && !disabled.has(m.key);
                // Activo de verdad: además sus dependencias están activas.
                const usable = access.active(m.key);
                const dep = MODULE_REQUIRES[m.key];
                const visible = !access.hiddenInMenu(m.key);
                const Icon = m.icon;
                return (
                  <li key={m.key} className={`mod-row ${on ? "" : "is-off"}`}>
                    <span className="mod-icon">
                      <Icon size={20} />
                    </span>
                    <div className="mod-main">
                      <div className="mod-name">
                        {m.name}
                        {!licensed ? (
                          <Badge tone="neutral" dot={false}>
                            <Lock size={11} /> No incluido en tu licencia
                          </Badge>
                        ) : usable ? (
                          <Badge tone="success">Activo</Badge>
                        ) : on ? (
                          <Badge tone="warning">Requiere {dep ? nameOf(dep) : "otro módulo"}</Badge>
                        ) : (
                          <Badge tone="neutral">Inactivo</Badge>
                        )}
                      </div>
                      <div className="mod-desc">{m.description}</div>
                      <div className="mod-meta">
                        {dep && (
                          <button type="button" className="mod-chip" title={m.dependencyReason} onClick={() => setPending({ kind: "blocked", title: `${m.name} necesita ${nameOf(dep)}`, text: m.dependencyReason ?? "" })}>
                            <Link2 size={12} /> Necesita {nameOf(dep)}
                          </button>
                        )}
                        {m.optional && m.optional.length > 0 && <span className="mod-chip is-soft">Se integra con {m.optional.map(nameOf).join(", ")}</span>}
                        <span className="mod-chip is-soft" title="Roles con acceso a este módulo (además del administrador)">
                          <Users size={12} /> {roleSummary(m.key)}
                        </span>
                      </div>
                    </div>
                    <div className="mod-controls">
                      {licensed ? (
                        <>
                          <Switch checked={on} onChange={(v) => busy === null && toggleActive(m, v)} label="Activo" />
                          <Switch checked={visible} onChange={(v) => busy === null && void run(m.key, () => api.setModuleVisible(m.key, v), v ? `${m.name} se muestra en el menú` : `${m.name} se ocultó del menú`)} label="Mostrar en menú" />
                          {usable && (
                            <Button size="sm" variant="ghost" onClick={() => navigate(m.route)}>
                              Abrir <ArrowRight size={14} />
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => navigate({ page: "settings", tab: "license" })}>
                          Ver licencia <ArrowRight size={14} />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      <div className="card mb-16">
        <div className="card-header">
          <div>
            <div className="card-title">Próximamente</div>
            <div className="card-subtitle">Módulos previstos en el plan de evolución. Aún no existen en esta versión y no se pueden activar.</div>
          </div>
        </div>
        <ul className="mod-list is-planned">
          {PLANNED_MODULES.map((p) => (
            <li key={p.name} className="mod-row is-off">
              <span className="mod-icon">
                <Clock size={18} />
              </span>
              <div className="mod-main">
                <div className="mod-name">
                  {p.name} <Badge tone="neutral" dot={false}>En planeación</Badge>
                </div>
                <div className="mod-desc">{p.description}</div>
                <div className="mod-meta">
                  <span className="mod-chip is-soft">{p.group}</span>
                  <span className="mod-chip is-soft">{p.needs}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {pending?.kind === "activate-with" && (
        <ConfirmDialog
          title={`Activar ${pending.module.name}`}
          text={
            <>
              Para utilizar {pending.module.name} también debe estar activo {pending.deps.map(nameOf).join(" y ")}. {pending.module.dependencyReason} ¿Deseas activar {pending.deps.length === 1 ? "ambos módulos" : "todos estos módulos"}?
            </>
          }
          confirmLabel={pending.deps.length === 1 ? "Activar ambos" : "Activar todos"}
          onConfirm={() => run(pending.module.key, () => api.setModuleActive(pending.module.key, true, true), `${pending.module.name} y ${pending.deps.map(nameOf).join(", ")} quedaron activos`, true)}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === "deactivate" && (
        <ConfirmDialog
          title={`Desactivar ${pending.module.name}`}
          text={`${pending.module.name} dejará de aceptar operaciones y sus pantallas no estarán disponibles hasta que lo reactives. Sus datos se conservan completos: no se borra nada.`}
          confirmLabel="Desactivar"
          onConfirm={() => run(pending.module.key, () => api.setModuleActive(pending.module.key, false, false), `${pending.module.name} quedó inactivo. Sus datos se conservan.`, true)}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === "blocked" && (
        <Modal
          onClose={() => setPending(null)}
          footer={
            <Button variant="primary" onClick={() => setPending(null)}>
              Entendido
            </Button>
          }
        >
          <div className="modal-title">{pending.title}</div>
          <div className="modal-text">{pending.text}</div>
        </Modal>
      )}
    </>
  );
}
