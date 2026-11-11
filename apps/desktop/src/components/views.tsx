/**
 * Enrutador de páginas del área principal.
 */
import type { SystemOverview } from "@cartucho/shared";
import type { Route } from "../config/moduleRegistry";
import { DashboardPage } from "../pages/Dashboard";
import { InvoicesPage } from "../pages/Invoices";
import { InvoiceDetailPage } from "../pages/InvoiceDetail";
import { DocumentEditorPage } from "../pages/DocumentEditor";
import { QuotesPage, QuoteDetailPage } from "../pages/Quotes";
import { CustomersPage } from "../pages/Customers";
import { CatalogPage } from "../pages/Catalog";
import { InventoryPage } from "../pages/Inventory";
import { FinancePage } from "../pages/Finance";
import { ExpensesPage } from "../pages/Expenses";
import { SettingsPage } from "../pages/Settings";

export interface PageProps {
  navigate: (r: Route) => void;
  goBack: () => void;
  overview: SystemOverview;
  setOverview: (o: SystemOverview) => void;
  reloadOverview: () => Promise<void>;
}

export function PageRouter({ route, ...props }: PageProps & { route: Route }) {
  switch (route.page) {
    case "dashboard":
      return <DashboardPage {...props} />;
    case "invoices":
      return <InvoicesPage {...props} initialStatus={route.status} />;
    case "invoice":
      return <InvoiceDetailPage {...props} id={route.id} autoPrint={route.print} />;
    case "invoice-new":
      return <DocumentEditorPage {...props} kind="invoice" customerId={route.customerId} source={route.fromInvoiceId ? { kind: "invoice", id: route.fromInvoiceId } : undefined} />;
    case "quote-new":
      return <DocumentEditorPage {...props} kind="quote" customerId={route.customerId} source={route.fromQuoteId ? { kind: "quote", id: route.fromQuoteId } : undefined} />;
    case "quotes":
      return <QuotesPage {...props} />;
    case "quote":
      return <QuoteDetailPage {...props} id={route.id} autoPrint={route.print} />;
    case "customers":
      return <CustomersPage {...props} openId={route.openId} />;
    case "catalog":
      return <CatalogPage {...props} openId={route.openId} />;
    case "inventory":
      return <InventoryPage {...props} />;
    case "finance":
      return <FinancePage {...props} />;
    case "expenses":
      return <ExpensesPage {...props} />;
    case "settings":
      return <SettingsPage {...props} tab={route.tab} />;
  }
}
