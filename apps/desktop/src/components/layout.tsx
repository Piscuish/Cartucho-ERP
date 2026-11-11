/**
 * Estructura principal: menú lateral colapsable, barra superior y búsqueda rápida (Ctrl+K).
 */
import { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronsLeft,
  ChevronsRight,
  CornerDownLeft,
  FilePlus2,
  FileSignature,
  FileText,
  LogOut,
  Package,
  Plus,
  Search,
  Users,
} from "lucide-react";
import type { AuthenticatedUserSummary, CompanyProfile, SearchHit } from "@cartucho/shared";
import { NAV_TONE, NAVIGATION, NavGroup, Route } from "../config/moduleRegistry";
import type { LayoutId } from "@cartucho/shared";
import { useAccess } from "../lib/access";
import { api } from "../services/systemClient";
import { useDebounced, useHotkey } from "../lib/hooks";
import { initials } from "../lib/format";
import { Button } from "./ui";

export function AppShell({
  company,
  user,
  route,
  navigate,
  onLogout,
  lowStockCount,
  layout = "clasico",
  children,
}: {
  layout?: LayoutId;
  company: CompanyProfile;
  user: AuthenticatedUserSummary;
  route: Route;
  navigate: (r: Route) => void;
  onLogout: () => void;
  lowStockCount: number;
  children: ReactNode;
}) {
  const [collapsedPref, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("cartucho_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const access = useAccess();
  const navigation = useVisibleNavigation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem("cartucho_sidebar_collapsed", collapsedPref ? "1" : "0");
    } catch {
      /* ignorar */
    }
  }, [collapsedPref]);
  // El diseño «Riel» siempre muestra el menú como columna de íconos.
  const railOnly = layout === "riel";
  const collapsed = railOnly || collapsedPref;

  // Etiqueta flotante del menú contraído (se calcula con la posición real del botón).
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const tipProps = (label: string) => ({
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
      if (!collapsed) return;
      const r = e.currentTarget.getBoundingClientRect();
      const host = e.currentTarget.closest(".window-content")?.getBoundingClientRect();
      setTip({ label, top: r.top - (host?.top ?? 0) + r.height / 2, left: r.right - (host?.left ?? 0) + 10 });
    },
    onMouseLeave: () => setTip(null),
  });
  useEffect(() => setTip(null), [route, collapsed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [route]);

  useHotkey((e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k", () => setPaletteOpen(true));
  useHotkey((e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b", () => setCollapsed((c) => !c));

  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sb-brand">
          <div className="sb-logo">
            {company.logoDataUrl ? <img src={company.logoDataUrl} alt="" /> : initials(company.tradeName)}
          </div>
          <div className="sb-brand-text">
            <div className="sb-company">{company.tradeName}</div>
            <div className="sb-app">Cartucho ERP</div>
          </div>
        </div>

        <nav className="sb-nav" aria-label="Menú principal">
          {navigation.map((group) => (
            <div className="sb-group" key={group.label}>
              <div className="sb-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = item.matches.includes(route.page);
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={`sb-item ${active ? "is-active" : ""}`}
                    data-tip={item.label}
                    {...tipProps(item.label)}
                    style={NAV_TONE[item.id] ? ({ "--tone": NAV_TONE[item.id] } as CSSProperties) : undefined}
                    onClick={() => navigate(item.route)}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon size={18} />
                    <span className="sb-item-label">{item.label}</span>
                    {item.id === "inventory" && lowStockCount > 0 && (
                      <span className="sb-badge" title="Productos con stock bajo">
                        {lowStockCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sb-footer">
          <div className="sb-user">
            <div className="sb-avatar">{initials(user.fullName)}</div>
            <div className="sb-user-text">
              <div className="sb-user-name">{user.fullName}</div>
              <div className="sb-user-role">Administrador</div>
            </div>
            {!railOnly && (
              <button className="sb-icon-btn sb-hide-collapsed" onClick={() => setCollapsed(true)} title="Contraer menú (Ctrl+B)" aria-label="Contraer menú">
                <ChevronsLeft size={16} />
              </button>
            )}
            <button className="sb-icon-btn sb-hide-collapsed" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut size={16} />
            </button>
          </div>
          {collapsed && !railOnly && (
            <button
              className="sb-item"
              onClick={() => setCollapsed((c) => !c)}
              data-tip={collapsed ? "Expandir menú" : "Contraer menú"}
              {...tipProps(collapsed ? "Expandir menú" : "Contraer menú")}
            >
              {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
              <span className="sb-item-label">Contraer menú</span>
            </button>
          )}
        </div>
      </aside>
      {tip && (
        <div className="sb-tooltip" style={{ top: tip.top, left: tip.left }} role="tooltip">
          {tip.label}
        </div>
      )}

      <div className="main-area">
        <header className="topbar">
          <button className="topbar-search" onClick={() => setPaletteOpen(true)}>
            <Search size={16} />
            <span>Buscar facturas, clientes, productos…</span>
            <span className="kbd">Ctrl K</span>
          </button>
          <div className="topbar-spacer" />
          {access.canWrite("quotes") && (
            <Button variant="secondary" icon={<FileSignature size={16} />} onClick={() => navigate({ page: "quote-new" })}>
              Cotización
            </Button>
          )}
          {access.canWrite("invoices") && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate({ page: "invoice-new" })}>
              Nueva factura
            </Button>
          )}
        </header>
        <div className="main-scroll" ref={scrollRef}>
          {children}
        </div>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} navigate={navigate} />}
    </div>
  );
}

/** Menú lateral filtrado por los módulos de la licencia. */
function useVisibleNavigation(): NavGroup[] {
  const access = useAccess();
  return useMemo(
    () =>
      NAVIGATION.map((g) => ({ ...g, items: g.items.filter((i) => access.canOpen(i.route)) })).filter((g) => g.items.length > 0),
    [access],
  );
}

// ------------------------------------------------------------------ Búsqueda rápida

interface PaletteEntry {
  key: string;
  section: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  run: () => void;
}

const HIT_ICON: Record<SearchHit["kind"], ReactNode> = {
  invoice: <FileText size={16} />,
  customer: <Users size={16} />,
  product: <Package size={16} />,
  quote: <FileSignature size={16} />,
};

const HIT_SECTION: Record<SearchHit["kind"], string> = {
  invoice: "Facturas",
  customer: "Clientes",
  product: "Productos",
  quote: "Cotizaciones",
};

function CommandPalette({ onClose, navigate }: { onClose: () => void; navigate: (r: Route) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState(0);
  const debounced = useDebounced(query, 160);
  const access = useAccess();
  const navigation = useVisibleNavigation();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    if (!debounced.trim()) {
      setHits([]);
      return;
    }
    api
      .search(debounced)
      .then((h) => alive && setHits(h))
      .catch(() => alive && setHits([]));
    return () => {
      alive = false;
    };
  }, [debounced]);

  const go = (r: Route) => {
    navigate(r);
    onClose();
  };

  const entries: PaletteEntry[] = useMemo(() => {
    const actions: PaletteEntry[] = [];
    if (access.canWrite("invoices"))
      actions.push({ key: "a-inv", section: "Acciones", title: "Nueva factura", icon: <FilePlus2 size={16} />, run: () => go({ page: "invoice-new" }) });
    if (access.canWrite("quotes"))
      actions.push({ key: "a-quote", section: "Acciones", title: "Nueva cotización", icon: <FileSignature size={16} />, run: () => go({ page: "quote-new" }) });
    const pages: PaletteEntry[] = navigation.flatMap((g) =>
      g.items
        .filter((i) => i.id !== "invoice-new")
        .map((i) => {
          const Icon = i.icon;
          return { key: `p-${i.id}`, section: "Ir a", title: i.label, subtitle: g.label, icon: <Icon size={16} />, run: () => go(i.route) };
        }),
    );
    const q = query.trim().toLowerCase();
    const filteredStatic = [...actions, ...pages].filter((e) => !q || e.title.toLowerCase().includes(q));
    const found: PaletteEntry[] = hits.map((h) => ({
      key: `${h.kind}-${h.id}`,
      section: HIT_SECTION[h.kind],
      title: h.title,
      subtitle: h.subtitle,
      icon: HIT_ICON[h.kind],
      run: () => {
        if (h.kind === "invoice") go({ page: "invoice", id: h.id });
        else if (h.kind === "quote") go({ page: "quote", id: h.id });
        else if (h.kind === "customer") go({ page: "customers", openId: h.id });
        else go({ page: "catalog", openId: h.id });
      },
    }));
    return [...found, ...filteredStatic];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, query, access, navigation]);

  useEffect(() => setSelected(0), [entries.length]);

  useEffect(() => {
    listRef.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(entries.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      entries[selected]?.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastSection = "";
  return createPortal(
    <>
      <div className="overlay" onClick={onClose} />
      <div className="cmdk" role="dialog" aria-label="Búsqueda rápida">
        <div className="cmdk-input">
          <Search size={18} color="var(--text-3)" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Busca o escribe un comando…" />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {entries.length === 0 && <div className="empty-text" style={{ padding: 24, textAlign: "center" }}>Sin resultados para “{query}”.</div>}
          {entries.map((e, i) => {
            const header = e.section !== lastSection ? <div className="cmdk-section">{e.section}</div> : null;
            lastSection = e.section;
            return (
              <div key={e.key}>
                {header}
                <button className={`cmdk-item ${i === selected ? "is-selected" : ""}`} onMouseEnter={() => setSelected(i)} onClick={e.run}>
                  <span className="cmdk-item-icon">{e.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div className="cmdk-item-title">{e.title}</div>
                    {e.subtitle && <div className="cmdk-item-sub">{e.subtitle}</div>}
                  </span>
                  {i === selected && <CornerDownLeft size={14} color="var(--text-3)" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cmdk-footer">
          <span>↑ ↓ para moverte</span>
          <span>Enter para abrir</span>
          <span>Ctrl B contrae el menú</span>
        </div>
      </div>
    </>,
    document.body,
  );
}
