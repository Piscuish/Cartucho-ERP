/**
 * Configuración › Usuarios y roles (solo administrador).
 *
 * - Usuarios: crear, editar, cambiar rol, restablecer contraseña y desactivar.
 * - Roles: nombre, descripción y acceso por módulo (Sin acceso / Ver / Ver y editar).
 *   Solo se ofrecen los módulos incluidos en la licencia. El rol Administrador tiene todo.
 * Las mismas reglas se validan en Rust; aquí solo se guía al administrador.
 */
import { useState } from "react";
import { Lock, Pencil, Plus, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { ALL_MODULES, AccessLevel, MODULE_LABELS, ModuleKey, Role, RoleInput, UserAccount, UserInput } from "@cartucho/shared";
import type { PageProps } from "./views";
import { api } from "../services/systemClient";
import { useAsync } from "../lib/hooks";
import { useAccess } from "../lib/access";
import { errorMessage, fmtDateTime } from "../lib/format";
import { Alert, Badge, Button, ConfirmDialog, Drawer, Field, Segmented, SkeletonRows, Switch, useToast } from "./ui";

const LEVELS: { value: AccessLevel; label: string }[] = [
  { value: "none", label: "Sin acceso" },
  { value: "read", label: "Ver" },
  { value: "write", label: "Ver y editar" },
];

/** Requisitos entre módulos (iguales a los de la licencia). */
const REQUIRES: Partial<Record<ModuleKey, ModuleKey>> = { quotes: "invoices", inventory: "catalog", finance: "invoices" };

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function UsersSettings({ overview, reloadOverview }: PageProps) {
  const toast = useToast();
  const [view, setView] = useState<"users" | "roles">("users");
  const [version, setVersion] = useState(0);
  const users = useAsync(() => api.listUsers(), [version]);
  const roles = useAsync(() => api.listRoles(), [version]);
  const [editUser, setEditUser] = useState<UserAccount | "new" | null>(null);
  const [editRole, setEditRole] = useState<Role | "new" | null>(null);
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);
  const refresh = () => setVersion((v) => v + 1);
  const meId = overview.currentUser?.id;

  return (
    <>
      <div className="card mb-16">
        <div className="card-body">
          <div className="row-between" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <div className="form-section-title">Usuarios y roles</div>
              <div className="form-section-desc" style={{ margin: 0 }}>
                Cada persona entra con su usuario. El rol define qué módulos ve y cuáles puede modificar.
              </div>
            </div>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "users", label: <><Users size={14} /> Usuarios</> },
                { value: "roles", label: <><ShieldCheck size={14} /> Roles</> },
              ]}
            />
          </div>
        </div>
      </div>

      {view === "users" ? (
        <div className="card mb-16">
          <div className="card-header">
            <div className="card-title">Usuarios</div>
            <Button size="sm" variant="primary" icon={<UserPlus size={15} />} onClick={() => setEditUser("new")}>
              Nuevo usuario
            </Button>
          </div>
          {users.error && <div className="card-body"><Alert tone="danger">{users.error}</Alert></div>}
          {users.loading && !users.data ? (
            <SkeletonRows rows={3} />
          ) : (
            <div className="list">
              {(users.data ?? []).map((u) => (
                <div key={u.id} className="list-item is-clickable" onClick={() => setEditUser(u)}>
                  <div className="avatar-sm">{initials(u.fullName)}</div>
                  <div className="list-item-main">
                    <div className="cell-main">
                      {u.fullName} {u.id === meId && <span className="subtle">(tú)</span>}
                    </div>
                    <div className="cell-sub">
                      @{u.username} · {u.lastLoginAt ? `Último ingreso ${fmtDateTime(u.lastLoginAt)}` : "Aún no ha ingresado"}
                    </div>
                  </div>
                  <Badge tone={u.roleKey === "admin" ? "accent" : "neutral"} dot={false}>
                    {u.roleName}
                  </Badge>
                  {!u.isActive && <Badge tone="danger">Desactivado</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card mb-16">
          <div className="card-header">
            <div className="card-title">Roles</div>
            <Button size="sm" variant="primary" icon={<Plus size={15} />} onClick={() => setEditRole("new")}>
              Nuevo rol
            </Button>
          </div>
          {roles.error && <div className="card-body"><Alert tone="danger">{roles.error}</Alert></div>}
          {roles.loading && !roles.data ? (
            <SkeletonRows rows={3} />
          ) : (
            <div className="list">
              {(roles.data ?? []).map((r) => (
                <div key={r.id} className="list-item is-clickable" onClick={() => setEditRole(r)}>
                  <div className={`role-icon ${r.isSystem ? "is-admin" : ""}`}>{r.isSystem ? <Lock size={16} /> : <ShieldCheck size={16} />}</div>
                  <div className="list-item-main">
                    <div className="cell-main">{r.name}</div>
                    <div className="cell-sub">{r.isSystem ? "Acceso total" : describePermissions(r)}</div>
                  </div>
                  <span className="subtle" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                    {r.userCount} {r.userCount === 1 ? "usuario" : "usuarios"}
                  </span>
                  <Pencil size={15} className="subtle" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editUser && (
        <UserDrawer
          user={editUser === "new" ? null : editUser}
          roles={roles.data ?? []}
          isMe={editUser !== "new" && editUser.id === meId}
          onClose={() => setEditUser(null)}
          onSaved={async (msg) => {
            setEditUser(null);
            refresh();
            await reloadOverview();
            toast(msg);
          }}
        />
      )}

      {editRole && (
        <RoleDrawer
          role={editRole === "new" ? null : editRole}
          onClose={() => setEditRole(null)}
          onDelete={(r) => {
            setEditRole(null);
            setDeleteRole(r);
          }}
          onSaved={async (msg) => {
            setEditRole(null);
            refresh();
            await reloadOverview();
            toast(msg);
          }}
        />
      )}

      {deleteRole && (
        <ConfirmDialog
          title={`¿Eliminar el rol «${deleteRole.name}»?`}
          text="Los usuarios no se ven afectados: solo se puede eliminar un rol que nadie tenga asignado."
          confirmLabel="Eliminar rol"
          danger
          onClose={() => setDeleteRole(null)}
          onConfirm={async () => {
            await api.deleteRole(deleteRole.id);
            refresh();
            toast("Rol eliminado");
          }}
        />
      )}
    </>
  );
}

function describePermissions(r: Role): string {
  const entries = Object.entries(r.permissions) as [ModuleKey, "read" | "write"][];
  if (!entries.length) return "Sin acceso a módulos";
  const edit = entries.filter(([, l]) => l === "write").map(([m]) => MODULE_LABELS[m]);
  const view = entries.filter(([, l]) => l === "read").map(([m]) => MODULE_LABELS[m]);
  return [edit.length ? `Edita: ${edit.join(", ")}` : null, view.length ? `Ve: ${view.join(", ")}` : null].filter(Boolean).join(" · ");
}

// ------------------------------------------------------------------ Usuario

function UserDrawer({
  user,
  roles,
  isMe,
  onClose,
  onSaved,
}: {
  user: UserAccount | null;
  roles: Role[];
  isMe: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [form, setForm] = useState<UserInput>({
    id: user?.id ?? null,
    fullName: user?.fullName ?? "",
    username: user?.username ?? "",
    roleKey: user?.roleKey ?? (roles.find((r) => !r.isSystem)?.key ?? "admin"),
    password: "",
    isActive: user?.isActive ?? true,
  });
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof UserInput>(k: K, v: UserInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const role = roles.find((r) => r.key === form.roleKey);

  const save = async () => {
    setError(null);
    if (form.password && form.password !== confirm) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    try {
      await api.saveUser({ ...form, password: form.password || null });
      onSaved(user ? "Usuario actualizado" : "Usuario creado");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      title={user ? user.fullName : "Nuevo usuario"}
      subtitle={user ? `@${user.username}` : "Tendrá su propio usuario y contraseña."}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {user ? "Guardar cambios" : "Crear usuario"}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Nombre completo">
          <input className="input" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} autoFocus={!user} />
        </Field>
        <Field label="Usuario" hint="Con este nombre inicia sesión. Sin espacios ni tildes.">
          <input className="input" value={form.username} onChange={(e) => set("username", e.target.value.replace(/\s/g, ""))} autoComplete="off" />
        </Field>
        <Field label="Rol" hint={isMe ? "No puedes cambiar tu propio rol." : undefined}>
          <select className="input" value={form.roleKey} disabled={isMe} onChange={(e) => set("roleKey", e.target.value)}>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        {role && (
          <div className="role-preview">
            <div className="subtle" style={{ fontSize: 12.5, marginBottom: 6 }}>
              {role.description || (role.isSystem ? "Acceso total." : "Permisos de este rol:")}
            </div>
            {!role.isSystem && (
              <div className="chips-wrap">
                {(Object.entries(role.permissions) as [ModuleKey, "read" | "write"][]).map(([m, l]) => (
                  <Badge key={m} tone={l === "write" ? "accent" : "neutral"} dot={false}>
                    {MODULE_LABELS[m]} · {l === "write" ? "edita" : "ve"}
                  </Badge>
                ))}
                {!Object.keys(role.permissions).length && <span className="subtle">Sin acceso a módulos.</span>}
              </div>
            )}
          </div>
        )}
        <div className="grid grid-2" style={{ gap: 12 }}>
          <Field label={user ? "Nueva contraseña" : "Contraseña"} hint={user ? "Déjala vacía para no cambiarla." : "Mínimo 8 caracteres."}>
            <input className="input" type="password" value={form.password ?? ""} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirmar contraseña">
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        {user && (
          <Switch
            checked={form.isActive}
            onChange={(v) => !isMe && set("isActive", v)}
            label="Cuenta activa"
            description={isMe ? "No puedes desactivar tu propia cuenta." : "Un usuario desactivado no puede iniciar sesión. Sus facturas y movimientos se conservan."}
          />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ Rol

function RoleDrawer({
  role,
  onClose,
  onDelete,
  onSaved,
}: {
  role: Role | null;
  onClose: () => void;
  onDelete: (r: Role) => void;
  onSaved: (msg: string) => void;
}) {
  const access = useAccess();
  const licensed = new Set(access.license?.modules ?? ALL_MODULES);
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Partial<Record<ModuleKey, AccessLevel>>>(() => ({ ...(role?.permissions ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdminRole = !!role?.isSystem;

  const setLevel = (m: ModuleKey, level: AccessLevel) =>
    setPerms((p) => {
      const next = { ...p, [m]: level };
      // Si un módulo requiere otro, el requerido queda al menos en «Ver».
      const req = REQUIRES[m];
      if (level !== "none" && req && (!next[req] || next[req] === "none") && licensed.has(req)) next[req] = "read";
      // Si se quita un módulo requerido, también los que dependen de él.
      if (level === "none") for (const [dep, r] of Object.entries(REQUIRES)) if (r === m) next[dep as ModuleKey] = "none";
      return next;
    });

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const input: RoleInput = { id: role?.id ?? null, name, description: description || null, permissions: perms };
      await api.saveRole(input);
      onSaved(role ? "Rol actualizado" : "Rol creado");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      wide
      title={role ? role.name : "Nuevo rol"}
      subtitle={isAdminRole ? "Rol de sistema: acceso total." : "Elige qué puede ver y modificar."}
      onClose={onClose}
      footer={
        <>
          {role && !isAdminRole && (
            <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => onDelete(role)} style={{ marginRight: "auto" }} disabled={role.userCount > 0} title={role.userCount > 0 ? "Tiene usuarios asignados" : undefined}>
              Eliminar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {role ? "Guardar cambios" : "Crear rol"}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Nombre del rol">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Cajero, Bodega, Contador" autoFocus={!role} />
        </Field>
        <Field label="Descripción (opcional)">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Qué hace esta persona" />
        </Field>

        {isAdminRole ? (
          <Alert tone="info">
            El administrador tiene acceso a todos los módulos de la licencia y es el único que puede gestionar usuarios, roles, la empresa,
            la apariencia, la licencia y los respaldos. Puedes cambiarle el nombre.
          </Alert>
        ) : (
          <div>
            <div className="form-section-title" style={{ fontSize: 14 }}>
              Acceso por módulo
            </div>
            <div className="form-section-desc">Solo puedes dar módulos incluidos en tu licencia.</div>
            <div className="perm-table">
              {ALL_MODULES.map((m) => {
                const inLicense = licensed.has(m);
                return (
                  <div key={m} className={`perm-row ${inLicense ? "" : "is-off"}`}>
                    <div>
                      <div className="cell-main">{MODULE_LABELS[m]}</div>
                      {!inLicense && <div className="cell-sub">No incluido en tu licencia</div>}
                    </div>
                    {inLicense ? (
                      <Segmented value={(perms[m] ?? "none") as AccessLevel} onChange={(v) => setLevel(m, v)} options={LEVELS} />
                    ) : (
                      <Lock size={15} className="subtle" />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="subtle" style={{ fontSize: 12.5, marginTop: 10 }}>
              Configuración de la empresa, usuarios, apariencia, licencia y respaldos son solo del administrador.
            </p>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Drawer>
  );
}
