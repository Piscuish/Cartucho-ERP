import type { ErpModuleDescriptor, NavigationSectionId } from "@cartucho/shared";

/**
 * Catálogo desacoplado de módulos de gestión del ERP.
 *
 * Importante:
 * - Por defecto ningún módulo comercial viene habilitado (`enabled: false`),
 *   en concordancia con `enabled_modules_json = '[]'` en SQLite.
 * - Cada instalación habilitará explícitamente sus módulos cuando estén
 *   desarrollados y contratados/configurados según el perfil de negocio,
 *   plan comercial y complementos adicionales.
 */
export const MANAGEMENT_MODULE_CATALOG: ErpModuleDescriptor[] = [
  {
    id: "module-inventory",
    key: "inventory",
    label: "Inventario",
    description:
      "Control de productos, insumos, existencias locales y movimientos de almacén adaptables al giro del negocio.",
    category: "management",
    enabled: false,
    status: "planned",
  },
  {
    id: "module-sales",
    key: "sales",
    label: "Ventas",
    description:
      "Emisión de documentos de venta internos y registro manual de pagos recibidos (Efectivo, Transferencia, Tarjeta u Otro).",
    category: "management",
    enabled: false,
    status: "planned",
  },
  {
    id: "module-customers",
    key: "customers",
    label: "Clientes",
    description:
      "Directorio local de clientes, datos de contacto e historial operativo dentro de la empresa.",
    category: "management",
    enabled: false,
    status: "planned",
  },
  {
    id: "module-future",
    key: "custom-extensions",
    label: "Otros módulos futuros",
    description:
      "Espacio reservado para módulos especializados según el tipo de empresa (ej. órdenes de producción, mesas/comandas, compras o gastos).",
    category: "management",
    enabled: false,
    status: "planned",
  },
];

/**
 * Devuelve únicamente los módulos explícitamente habilitados en la instalación
 * (`enabled_modules_json`). Inicialmente devuelve `[]` hasta que los módulos
 * estén desarrollados y se habiliten para la empresa.
 */
export function resolveEnabledManagementModules(
  enabledModuleKeys?: string[] | null
): ErpModuleDescriptor[] {
  if (!enabledModuleKeys || enabledModuleKeys.length === 0) {
    return [];
  }
  const keySet = new Set(enabledModuleKeys);
  return MANAGEMENT_MODULE_CATALOG.filter((mod) => keySet.has(mod.key)).map(
    (mod) => ({
      ...mod,
      enabled: true,
    })
  );
}

/**
 * Resuelve los espacios de navegación de la categoría Gestión combinando el estado real
 * de habilitación (`enabledModuleKeys`, inicialmente `[]`) con los espacios preparados
 * en la estructura de navegación.
 */
export function resolveManagementNavigationSpaces(
  enabledModuleKeys?: string[] | null
): ErpModuleDescriptor[] {
  const keySet = new Set(enabledModuleKeys ?? []);
  return MANAGEMENT_MODULE_CATALOG.map((mod) => ({
    ...mod,
    enabled: keySet.has(mod.key),
  }));
}

export function findModuleDescriptor(
  sectionId: NavigationSectionId,
  enabledModuleKeys?: string[] | null
): ErpModuleDescriptor | undefined {
  return resolveManagementNavigationSpaces(enabledModuleKeys).find(
    (mod) => mod.id === sectionId
  );
}
