import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Download, LayoutGrid, List, Package, PackagePlus, Tags } from "lucide-react";
import type { Category, Product, ProductInput } from "@cartucho/shared";
import type { PageProps } from "../components/views";
import { api, isDesktop, pickSavePath } from "../services/systemClient";
import { useAccess } from "../lib/access";
import { useAsync, useDebounced } from "../lib/hooks";
import { errorMessage, money, parseQty, qty, todayISO } from "../lib/format";
import { Alert, Badge, Button, Drawer, EmptyState, Field, ImagePicker, MoneyInput, PageHeader, SearchBox, Segmented, SkeletonRows, Switch, useToast } from "../components/ui";
import { CategoryManager } from "../components/categories";

const UNITS = ["und", "kg", "g", "l", "ml", "m", "cm", "caja", "paquete", "docena", "par", "serv", "hora"];

export function stockBadge(p: Product) {
  if (!p.trackStock) return <Badge dot={false}>Servicio</Badge>;
  if (p.stockQty <= 0) return <Badge tone="danger">Agotado</Badge>;
  if (p.isLowStock) return <Badge tone="warning">{qty(p.stockQty)} {p.unit}</Badge>;
  return <Badge tone="success">{qty(p.stockQty)} {p.unit}</Badge>;
}

export function CatalogPage({ openId }: PageProps & { openId?: number }) {
  const withStock = useAccess().can("inventory");
  const canEdit = useAccess().canWrite("catalog");
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return (localStorage.getItem("cartucho_catalog_view") as "grid" | "list") || "grid";
    } catch {
      return "grid";
    }
  });
  const q = useDebounced(search);
  const { data, loading, error, reload } = useAsync(() => api.listProducts({ search: q, categoryId, includeInactive: showArchived }), [q, categoryId, showArchived]);
  const cats = useAsync(() => api.listCategories("product"), []);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [managingCats, setManagingCats] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem("cartucho_catalog_view", view);
    } catch {
      /* ignorar */
    }
  }, [view]);

  useEffect(() => {
    if (openId && data) {
      const p = data.find((x) => x.id === openId);
      if (p) setEditing(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, data === null]);

  const exportCsv = async () => {
    try {
      const dest = await pickSavePath("Exportar catálogo", `catalogo_${todayISO()}.csv`, "csv", "Archivo CSV (Excel)");
      if (!dest) return;
      toast(`Exportado: ${await api.exportCsv("products", null, null, dest)}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Catálogo"
        subtitle="Productos y servicios que vendes, con su foto, precio y descripción."
        actions={
          <>
            {canEdit && (
              <Button icon={<Tags size={16} />} onClick={() => setManagingCats(true)}>
                Categorías
              </Button>
            )}
            {isDesktop() && (
              <Button icon={<Download size={16} />} onClick={exportCsv}>
                Exportar
              </Button>
            )}
            {canEdit && (
              <Button variant="primary" icon={<PackagePlus size={16} />} onClick={() => setEditing("new")}>
                Nuevo producto
              </Button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="toolbar">
          <SearchBox value={search} onChange={setSearch} placeholder="Nombre, código o descripción…" />
          <select className="select" style={{ width: 200 }} value={categoryId ?? ""} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todas las categorías</option>
            {cats.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Switch checked={showArchived} onChange={setShowArchived} label="Archivados" />
          <div style={{ marginLeft: "auto" }}>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: <LayoutGrid size={15} aria-label="Cuadrícula" /> },
                { value: "list", label: <List size={15} aria-label="Lista" /> },
              ]}
            />
          </div>
        </div>

        {error && (
          <div style={{ padding: 16 }}>
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        {loading && !data ? (
          <SkeletonRows rows={6} />
        ) : data && data.length === 0 ? (
          <EmptyState
            icon={<Package size={24} />}
            title={search || categoryId ? "No hay productos con esos filtros" : "Agrega tu primer producto"}
            text={search || categoryId ? undefined : "Incluye nombre, precio, una foto de referencia y su descripción. También puedes registrar servicios."}
            action={
              !search && !categoryId && canEdit ? (
                <Button variant="primary" onClick={() => setEditing("new")}>
                  Nuevo producto
                </Button>
              ) : undefined
            }
          />
        ) : view === "grid" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14, padding: 16 }}>
            {data?.map((p) => (
              <button
                key={p.id}
                className="card"
                onClick={() => setEditing(p)}
                style={{ textAlign: "left", cursor: "pointer", padding: 0, overflow: "hidden", opacity: p.isActive ? 1 : 0.6, display: "flex", flexDirection: "column" }}
              >
                <div style={{ aspectRatio: "4 / 3", background: "var(--surface-3)", display: "grid", placeItems: "center", width: "100%" }}>
                  {p.imageDataUrl ? <img src={p.imageDataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={32} color="var(--text-3)" />}
                </div>
                <div style={{ padding: 12, width: "100%" }}>
                  <div className="cell-main" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.name}
                  </div>
                  <div className="cell-sub">{p.categoryName ?? "Sin categoría"}</div>
                  <div className="row-between mt-8">
                    <span className="money" style={{ fontWeight: 650, fontSize: 15 }}>
                      {money(p.price)}
                    </span>
                    {stockBadge(p)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th className="t-right">Precio</th>
                  <th className="t-right">Costo</th>
                  <th className="t-right">Margen</th>
                  {withStock && <th>Existencias</th>}
                </tr>
              </thead>
              <tbody>
                {data?.map((p) => (
                  <tr key={p.id} className={`is-clickable ${p.isActive ? "" : "is-muted"}`} onClick={() => setEditing(p)}>
                    <td>
                      <div className="cell-flex">
                        <div className="thumb">{p.imageDataUrl ? <img src={p.imageDataUrl} alt="" /> : <Package size={16} />}</div>
                        <div>
                          <div className="cell-main">{p.name}</div>
                          <div className="cell-sub">{p.sku ?? "Sin código"}</div>
                        </div>
                      </div>
                    </td>
                    <td>{p.categoryName ?? <span className="subtle">—</span>}</td>
                    <td className="t-right money">{money(p.price)}</td>
                    <td className="t-right money subtle">{money(p.cost)}</td>
                    <td className="t-right num">{p.price > 0 ? `${Math.round(((p.price - p.cost) / p.price) * 100)}%` : "—"}</td>
                    {withStock && <td>{stockBadge(p)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ProductDrawer
          product={editing === "new" ? null : editing}
          categories={cats.data ?? []}
          onClose={() => setEditing(null)}
          onManageCategories={() => setManagingCats(true)}
          onSaved={(p, msg) => {
            toast(msg);
            void reload();
            setEditing(p);
          }}
        />
      )}
      {managingCats && (
        <CategoryManager
          kind="product"
          onClose={() => setManagingCats(false)}
          onChanged={() => {
            void cats.reload();
            void reload();
          }}
        />
      )}
    </div>
  );
}

function ProductDrawer({
  product,
  categories,
  onClose,
  onSaved,
  onManageCategories,
}: {
  product: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: (p: Product, msg: string) => void;
  onManageCategories: () => void;
}) {
  const canEditProduct = useAccess().canWrite("catalog");
  const withStock = useAccess().can("inventory");
  const [form, setForm] = useState<ProductInput>({
    id: product?.id ?? null,
    sku: product?.sku ?? "",
    name: product?.name ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? null,
    unit: product?.unit ?? "und",
    price: product?.price ?? 0,
    cost: product?.cost ?? 0,
    trackStock: product?.trackStock ?? true,
    minStock: product?.minStock ?? 0,
  });
  const [minText, setMinText] = useState(String(product?.minStock ?? 0));
  const [initialText, setInitialText] = useState("0");
  const [image, setImage] = useState<string | null>(product?.imageDataUrl ?? null);
  const [newImage, setNewImage] = useState<{ base64: string; mime: string } | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const margin = form.price > 0 ? Math.round(((form.price - form.cost) / form.price) * 100) : null;

  const save = async () => {
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveProduct({
        ...form,
        minStock: Math.max(0, parseQty(minText)),
        initialStock: product ? null : Math.max(0, parseQty(initialText)),
        imageBase64: newImage?.base64 ?? null,
        imageMimeType: newImage?.mime ?? null,
        removeImage,
      });
      onSaved(saved, product ? "Producto actualizado" : "Producto creado");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!product) return;
    try {
      const p = await api.setProductActive(product.id, !product.isActive);
      onSaved(p, p.isActive ? "Producto activado" : "Producto archivado");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Drawer
      wide
      readOnly={!canEditProduct}
      title={product ? product.name : "Nuevo producto"}
      subtitle={product ? (product.trackStock ? `Existencias: ${qty(product.stockQty)} ${product.unit}` : "Servicio (sin inventario)") : "Producto o servicio de tu catálogo"}
      onClose={onClose}
      footer={
        <>
          {product && (
            <Button variant="ghost" icon={product.isActive ? <Archive size={16} /> : <ArchiveRestore size={16} />} onClick={toggleActive} style={{ marginRight: "auto" }}>
              {product.isActive ? "Archivar" : "Activar"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="stack-lg">
        <Field label="Foto de referencia" optional>
          <ImagePicker
            value={image}
            size={120}
            onChange={(img) => {
              setImage(img.dataUrl);
              setNewImage(img);
              setRemoveImage(false);
            }}
            onRemove={() => {
              setImage(null);
              setNewImage(null);
              setRemoveImage(true);
            }}
          />
        </Field>

        <div className="form-grid">
          <Field label="Nombre" className="span-2" error={error && !form.name.trim() ? error : null}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={!product} placeholder="Resma papel carta 75 g" />
          </Field>
          <Field label="Código / SKU" optional>
            <input className="input" value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="PAP-001" />
          </Field>
          <Field
            label="Categoría"
            optional
            hint={
              <button type="button" className="back-link" style={{ margin: 0, fontSize: 12.5 }} onClick={onManageCategories}>
                Administrar categorías
              </button>
            }
          >
            <select className="select" value={form.categoryId ?? ""} onChange={(e) => setForm({ ...form, categoryId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Descripción" optional className="span-all">
            <textarea className="textarea" rows={3} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Detalles, referencias, medidas, colores…" />
          </Field>
        </div>

        <div className="form-section">
          <div className="form-section-title">Precio</div>
          <div className="form-grid cols-3 mt-8">
            <Field label="Precio de venta">
              <MoneyInput value={form.price} onChange={(v) => setForm({ ...form, price: v })} />
            </Field>
            <Field label="Costo" optional hint="Lo que te cuesta a ti.">
              <MoneyInput value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
            </Field>
            <Field label="Margen">
              <div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface-2)" }}>
                {margin === null ? "—" : <span className={margin >= 0 ? "profit-positive" : "profit-negative"}>{margin}% · {money(form.price - form.cost)}</span>}
              </div>
            </Field>
          </div>
        </div>

        {withStock && (
        <div className="form-section">
          <Switch
            checked={form.trackStock}
            onChange={(v) => setForm({ ...form, trackStock: v })}
            label="Controlar inventario"
            description="Desactívalo para servicios (impresiones, mano de obra, etc.)."
          />
          {form.trackStock && (
            <div className="form-grid cols-3 mt-16">
              <Field label="Unidad">
                <select className="select" value={form.unit ?? "und"} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label="Stock mínimo" hint="Te avisamos al llegar aquí.">
                <input className="input num" inputMode="decimal" value={minText} onChange={(e) => setMinText(e.target.value)} />
              </Field>
              {!product ? (
                <Field label="Existencia inicial">
                  <input className="input num" inputMode="decimal" value={initialText} onChange={(e) => setInitialText(e.target.value)} />
                </Field>
              ) : (
                <Field label="Existencia actual" hint="Cámbiala desde Inventario.">
                  <div className="input" style={{ display: "flex", alignItems: "center", background: "var(--surface-2)" }}>
                    {qty(product.stockQty)} {product.unit}
                  </div>
                </Field>
              )}
            </div>
          )}
        </div>
        )}
        {error && form.name.trim() && <Alert tone="danger">{error}</Alert>}
      </div>
    </Drawer>
  );
}
