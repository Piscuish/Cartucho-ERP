import { useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Category, CategoryKind } from "@cartucho/shared";
import { api } from "../services/systemClient";
import { errorMessage } from "../lib/format";
import { Alert, Button, Drawer, IconButton, SkeletonRows, useToast } from "./ui";

/** Panel para crear, renombrar y eliminar categorías de productos o de gastos. */
export function CategoryManager({ kind, onClose, onChanged }: { kind: CategoryKind; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Category[] | null>(null);
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => api.listCategories(kind).then(setItems).catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try {
      await fn();
      toast(msg);
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Drawer title={kind === "product" ? "Categorías de productos" : "Categorías de gastos"} subtitle="Organiza tus registros para encontrarlos y analizarlos mejor." onClose={onClose}>
      <div className="stack">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void run(() => api.saveCategory(kind, newName), "Categoría creada").then(() => setNewName(""));
          }}
        >
          <input className="input" placeholder="Nueva categoría…" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" variant="primary" icon={<Plus size={16} />}>
            Agregar
          </Button>
        </form>
        {error && <Alert tone="danger">{error}</Alert>}
        {items === null ? (
          <SkeletonRows rows={4} />
        ) : (
          <div className="card list">
            {items.map((c) => (
              <div className="list-item" key={c.id}>
                {editId === c.id ? (
                  <>
                    <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                    <IconButton label="Guardar" onClick={() => run(() => api.saveCategory(kind, editName, c.id), "Categoría renombrada").then(() => setEditId(null))}>
                      <Check size={16} />
                    </IconButton>
                    <IconButton label="Cancelar" onClick={() => setEditId(null)}>
                      <X size={16} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <div className="list-item-main">
                      <div className="cell-main">{c.name}</div>
                      <div className="cell-sub">{c.usageCount === 0 ? "Sin uso" : `${c.usageCount} registros`}</div>
                    </div>
                    <IconButton
                      label="Renombrar"
                      onClick={() => {
                        setEditId(c.id);
                        setEditName(c.name);
                      }}
                    >
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton label={c.usageCount > 0 ? "En uso: no se puede eliminar" : "Eliminar"} danger disabled={c.usageCount > 0} onClick={() => run(() => api.deleteCategory(c.id), "Categoría eliminada")}>
                      <Trash2 size={15} />
                    </IconButton>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
