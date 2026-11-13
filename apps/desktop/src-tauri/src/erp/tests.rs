//! Pruebas de los módulos de negocio sobre bases SQLite temporales aisladas.

use super::catalog::{ProductInput, StockAdjustmentInput};
use super::customers::CustomerInput;
use super::finance::ExpenseInput;
use super::sales::{DocumentLineInput, InvoiceFilter, InvoiceInput, PaymentInput, QuoteInput};
use super::settings::BusinessSettings;
use crate::db::{
    CompleteInitialSetupInput, CreateInitialAdminInput, LocalDatabase, SaveCompanyProfileInput,
};
use rusqlite::Connection;
use tempfile::TempDir;

fn setup() -> (TempDir, LocalDatabase) {
    let dir = TempDir::new().unwrap();
    let mut db = LocalDatabase::open_in_dir(dir.path()).unwrap();
    db.complete_initial_setup(&CompleteInitialSetupInput {
        company: SaveCompanyProfileInput {
            trade_name: "Tienda Prueba".to_string(),
            ..Default::default()
        },
        admin: CreateInitialAdminInput {
            full_name: "Admin".to_string(),
            username: "admin".to_string(),
            password: "ClaveSegura#1".to_string(),
            password_confirm: "ClaveSegura#1".to_string(),
        },
        paper_size: None,
    })
    .unwrap();
    (dir, db)
}

fn product(db: &LocalDatabase, name: &str, price: i64, cost: i64, stock: f64) -> i64 {
    db.save_product(&ProductInput {
        name: name.to_string(),
        price,
        cost,
        track_stock: true,
        min_stock: 2.0,
        initial_stock: Some(stock),
        ..Default::default()
    })
    .unwrap()
    .id
}

fn line(pid: Option<i64>, desc: &str, qty: f64, price: i64) -> DocumentLineInput {
    DocumentLineInput {
        product_id: pid,
        description: desc.to_string(),
        quantity: qty,
        unit_price: price,
        note: None,
    }
}

#[test]
fn requires_authentication_for_business_operations() {
    let (_dir, mut db) = setup();
    db.logout();
    assert!(db.list_customers(None, false).is_err());
    assert!(db.list_products(None, None, false, false).is_err());
    assert!(db.list_invoices(&InvoiceFilter::default()).is_err());
    assert!(db.dashboard("2026-11-10").is_err());
    assert!(db.export_backup("/tmp").is_err());
}

#[test]
fn migration_v4_seeds_categories_and_sequences() {
    let (_dir, db) = setup();
    let cats = db.list_categories("expense").unwrap();
    assert!(cats.iter().any(|c| c.name == "Arriendo"));
    assert!(cats.iter().any(|c| c.name == "Compras de inventario"));
    let s = db.get_business_settings().unwrap();
    assert_eq!(s.invoice_prefix, "FAC-");
    assert_eq!(s.invoice_next_number, 1);
    assert!(crate::db::target_schema_version() >= 4);
}

#[test]
fn customers_crud_and_archive() {
    let (_dir, db) = setup();
    let c = db
        .save_customer(&CustomerInput {
            name: "  Ana Pérez ".to_string(),
            phone: Some("3001234567".to_string()),
            email: Some("ana@correo.co".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(c.name, "Ana Pérez");
    assert!(db
        .save_customer(&CustomerInput {
            name: " ".to_string(),
            ..Default::default()
        })
        .is_err());
    assert!(db
        .save_customer(&CustomerInput {
            name: "X".to_string(),
            email: Some("malo".to_string()),
            ..Default::default()
        })
        .is_err());
    let found = db.list_customers(Some("pér".to_string()), false).unwrap();
    assert_eq!(found.len(), 1);
    db.set_customer_active(c.id, false).unwrap();
    assert_eq!(db.list_customers(None, false).unwrap().len(), 0);
    assert_eq!(db.list_customers(None, true).unwrap().len(), 1);
}

#[test]
fn product_with_image_initial_stock_and_unique_sku() {
    let (_dir, db) = setup();
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let p = db
        .save_product(&ProductInput {
            sku: Some("CAM-01".to_string()),
            name: "Camiseta".to_string(),
            price: 35000,
            cost: 18000,
            track_stock: true,
            initial_stock: Some(10.0),
            image_base64: Some(png.to_string()),
            image_mime_type: Some("image/png".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert!(p
        .image_data_url
        .unwrap()
        .starts_with("data:image/png;base64,"));
    assert_eq!(p.stock_qty, 10.0);
    let dup = db.save_product(&ProductInput {
        sku: Some("cam-01".to_string()),
        name: "Otra".to_string(),
        ..Default::default()
    });
    assert!(dup.unwrap_err().contains("código"));
    // Imagen disfrazada se rechaza.
    let bad = db.save_product(&ProductInput {
        name: "Mala".to_string(),
        image_base64: Some(png.to_string()),
        image_mime_type: Some("image/jpeg".to_string()),
        ..Default::default()
    });
    assert!(bad.is_err());
    let movements = db.list_inventory_movements(Some(p.id), None).unwrap();
    assert_eq!(movements.len(), 1);
    assert_eq!(movements[0].kind, "initial");
}

#[test]
fn invoice_flow_numbering_stock_payments_and_void() {
    let (_dir, db) = setup();
    let pid = product(&db, "Cuaderno", 5000, 3000, 10.0);
    let cust = db
        .save_customer(&CustomerInput {
            name: "Colegio ABC".to_string(),
            ..Default::default()
        })
        .unwrap();

    let inv = db
        .create_invoice(&InvoiceInput {
            customer_id: Some(cust.id),
            issue_date: "2026-11-10".to_string(),
            due_date: Some("2026-11-20".to_string()),
            lines: vec![
                line(Some(pid), "", 3.0, 5000),
                line(None, "Servicio de forrado", 1.0, 2500),
            ],
            notes: Some("Entrega en portería".to_string()),
            initial_payment: Some(PaymentInput {
                amount: 7500,
                method: "cash".to_string(),
                paid_at: "2026-11-10".to_string(),
                note: None,
            }),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(inv.summary.number, "FAC-00001");
    assert_eq!(inv.summary.total, 17500);
    assert_eq!(inv.summary.status, "partial");
    assert_eq!(inv.summary.balance, 10000);
    assert_eq!(inv.lines[0].description, "Cuaderno");
    assert_eq!(inv.customer.name, "Colegio ABC");
    assert_eq!(db.stock_of(pid), 7.0);

    // Sobrepago rechazado.
    assert!(db
        .add_payment(
            inv.summary.id,
            &PaymentInput {
                amount: 10001,
                method: "cash".to_string(),
                paid_at: "2026-11-11".to_string(),
                note: None
            }
        )
        .is_err());
    let paid = db
        .add_payment(
            inv.summary.id,
            &PaymentInput {
                amount: 10000,
                method: "transfer".to_string(),
                paid_at: "2026-11-11".to_string(),
                note: Some("Nequi".to_string()),
            },
        )
        .unwrap();
    assert_eq!(paid.summary.status, "paid");
    assert_eq!(paid.payments.len(), 2);

    // Segunda factura sin cliente: consumidor final y número consecutivo.
    let inv2 = db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-12".to_string(),
            lines: vec![line(Some(pid), "", 2.0, 5000)],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(inv2.summary.number, "FAC-00002");
    assert_eq!(inv2.customer.name, "Consumidor final");
    assert_eq!(db.stock_of(pid), 5.0);

    // Anular devuelve existencias y conserva el registro.
    let voided = db
        .void_invoice(inv2.summary.id, "Error de digitación")
        .unwrap();
    assert_eq!(voided.summary.status, "void");
    assert_eq!(voided.summary.balance, 0);
    assert_eq!(db.stock_of(pid), 7.0);
    assert!(db.void_invoice(inv2.summary.id, "otra vez").is_err());
    assert!(db
        .add_payment(
            inv2.summary.id,
            &PaymentInput {
                amount: 100,
                method: "cash".to_string(),
                paid_at: "2026-11-12".to_string(),
                note: None
            }
        )
        .is_err());
    assert_eq!(
        db.list_invoices(&InvoiceFilter::default()).unwrap().len(),
        2
    );
    assert_eq!(
        db.list_invoices(&InvoiceFilter {
            status: Some("void".to_string()),
            ..Default::default()
        })
        .unwrap()
        .len(),
        1
    );

    // Resumen financiero excluye anuladas.
    let s = db.finance_summary("2026-11-01", "2026-11-30").unwrap();
    assert_eq!(s.invoiced_total, 17500);
    assert_eq!(s.collected_total, 17500);
    assert_eq!(s.cost_of_goods_sold, 9000);
    assert_eq!(s.gross_profit, 8500);
}

#[test]
fn invoice_validation_rolls_back_everything() {
    let (_dir, db) = setup();
    let pid = product(&db, "Lápiz", 1000, 500, 5.0);
    // Segunda línea inválida: nada debe guardarse ni descontarse.
    let r = db.create_invoice(&InvoiceInput {
        issue_date: "2026-11-10".to_string(),
        lines: vec![line(Some(pid), "", 2.0, 1000), line(None, "", 1.0, 100)],
        ..Default::default()
    });
    assert!(r.is_err());
    assert_eq!(db.stock_of(pid), 5.0);
    assert_eq!(
        db.list_invoices(&InvoiceFilter::default()).unwrap().len(),
        0
    );
    assert_eq!(db.get_business_settings().unwrap().invoice_next_number, 1);
    // Fecha inválida, sin líneas y vencimiento anterior.
    assert!(db
        .create_invoice(&InvoiceInput {
            issue_date: "10/11/2026".to_string(),
            lines: vec![line(None, "a", 1.0, 1)],
            ..Default::default()
        })
        .is_err());
    assert!(db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-10".to_string(),
            ..Default::default()
        })
        .is_err());
    assert!(db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-10".to_string(),
            due_date: Some("2026-11-01".to_string()),
            lines: vec![line(None, "a", 1.0, 1)],
            ..Default::default()
        })
        .is_err());
    assert!(db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-10".to_string(),
            lines: vec![line(None, "a", -1.0, 1)],
            ..Default::default()
        })
        .is_err());
}

#[test]
fn quotes_convert_to_invoice_once() {
    let (_dir, db) = setup();
    let pid = product(&db, "Resma", 20000, 15000, 4.0);
    let q = db
        .create_quote(&QuoteInput {
            issue_date: "2026-11-01".to_string(),
            valid_until: Some("2026-11-15".to_string()),
            lines: vec![line(Some(pid), "Resma carta", 2.0, 20000)],
            customer: Some(super::sales::CustomerSnapshotInput {
                name: "Oficina XY".to_string(),
                ..Default::default()
            }),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(q.summary.number, "COT-00001");
    assert_eq!(
        db.stock_of(pid),
        4.0,
        "una cotización no descuenta inventario"
    );
    let inv = db
        .convert_quote_to_invoice(q.summary.id, "2026-11-05", None)
        .unwrap();
    assert_eq!(inv.summary.total, 40000);
    assert_eq!(inv.quote_number.as_deref(), Some("COT-00001"));
    assert_eq!(inv.customer.name, "Oficina XY");
    assert_eq!(db.stock_of(pid), 2.0);
    let q2 = db.get_quote(q.summary.id).unwrap();
    assert_eq!(q2.summary.status, "converted");
    assert_eq!(
        q2.summary.converted_invoice_number.as_deref(),
        Some(inv.summary.number.as_str())
    );
    assert!(db
        .convert_quote_to_invoice(q.summary.id, "2026-11-05", None)
        .is_err());
    assert!(db.cancel_quote(q.summary.id).is_err());
}

#[test]
fn inventory_purchase_records_expense_and_adjustment() {
    let (_dir, db) = setup();
    let pid = product(&db, "Tinta", 30000, 20000, 1.0);
    assert_eq!(
        db.list_products(None, None, false, true).unwrap().len(),
        1,
        "stock bajo"
    );
    let p = db
        .adjust_stock(&StockAdjustmentInput {
            product_id: pid,
            kind: "purchase".to_string(),
            quantity: 5.0,
            unit_cost: Some(21000),
            record_expense: true,
            expense_date: Some("2026-11-03".to_string()),
            method: Some("transfer".to_string()),
            supplier: Some("Distribuidora".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(p.stock_qty, 6.0);
    assert_eq!(p.cost, 21000);
    assert!(!p.is_low_stock);
    let exps = db.list_expenses(None, None, None, None).unwrap();
    assert_eq!(exps.len(), 1);
    assert_eq!(exps[0].kind, "inventory");
    assert_eq!(exps[0].amount, 105000);
    let adj = db
        .adjust_stock(&StockAdjustmentInput {
            product_id: pid,
            kind: "adjustment".to_string(),
            quantity: 4.5,
            ..Default::default()
        })
        .unwrap();
    assert_eq!(adj.stock_qty, 4.5);
    let s = db.finance_summary("2026-11-01", "2026-11-30").unwrap();
    assert_eq!(s.inventory_purchases, 105000);
    assert_eq!(s.net_cash_flow, -105000);
}

#[test]
fn expenses_and_category_rules() {
    let (_dir, db) = setup();
    let cats = db.list_categories("expense").unwrap();
    let rent = cats.iter().find(|c| c.name == "Arriendo").unwrap();
    let e = db
        .save_expense(&ExpenseInput {
            category_id: Some(rent.id),
            description: "Arriendo noviembre".to_string(),
            amount: 1_200_000,
            expense_date: "2026-11-05".to_string(),
            method: "transfer".to_string(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(e.category_name.as_deref(), Some("Arriendo"));
    assert!(db.delete_category(rent.id).is_err(), "categoría en uso");
    assert!(db
        .save_expense(&ExpenseInput {
            description: "x".to_string(),
            amount: 0,
            expense_date: "2026-11-05".to_string(),
            method: "cash".to_string(),
            ..Default::default()
        })
        .is_err());
    assert!(db
        .save_expense(&ExpenseInput {
            description: "x".to_string(),
            amount: 5,
            expense_date: "2026-11-05".to_string(),
            method: "bitcoin".to_string(),
            ..Default::default()
        })
        .is_err());
    let s = db.finance_summary("2026-11-01", "2026-11-30").unwrap();
    assert_eq!(s.operating_expenses, 1_200_000);
    assert_eq!(s.expenses_by_category[0].label, "Arriendo");
    assert_eq!(s.monthly.len(), 12);
    assert_eq!(s.monthly[11].month, "2026-11");
    db.delete_expense(e.id).unwrap();
    assert_eq!(db.list_expenses(None, None, None, None).unwrap().len(), 0);
    let custom = db.save_category(None, "expense", "Papelería").unwrap();
    assert!(db.save_category(None, "expense", "papelería").is_err());
    db.delete_category(custom.id).unwrap();
}

#[test]
fn business_settings_numbering_cannot_go_backwards() {
    let (_dir, db) = setup();
    db.create_invoice(&InvoiceInput {
        issue_date: "2026-11-10".to_string(),
        lines: vec![line(None, "Servicio", 1.0, 1000)],
        ..Default::default()
    })
    .unwrap();
    let mut s = db.get_business_settings().unwrap();
    assert_eq!(s.invoice_next_number, 2);
    s.invoice_next_number = 1;
    assert!(db.save_business_settings(&s).is_err());
    s.invoice_next_number = 100;
    s.invoice_prefix = "F".to_string();
    s.paper_size = "roll80".to_string();
    s.default_footer = "Gracias".to_string();
    let saved: BusinessSettings = db.save_business_settings(&s).unwrap();
    assert_eq!(saved.paper_size, "roll80");
    let inv = db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-10".to_string(),
            lines: vec![line(None, "Servicio", 1.0, 1000)],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(inv.summary.number, "F00100");
    s.paper_size = "tabloide".to_string();
    assert!(db.save_business_settings(&s).is_err());
}

#[test]
fn dashboard_search_and_csv_export() {
    let (dir, db) = setup();
    let pid = product(&db, "Marcador", 3000, 1500, 1.0);
    db.create_invoice(&InvoiceInput {
        issue_date: "2026-11-10".to_string(),
        due_date: Some("2026-11-10".to_string()),
        lines: vec![line(Some(pid), "", 1.0, 3000)],
        customer: Some(super::sales::CustomerSnapshotInput {
            name: "Juan; \"el de la esquina\"".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    })
    .unwrap();
    let d = db.dashboard("2026-11-15").unwrap();
    assert_eq!(d.open_invoice_count, 1);
    assert_eq!(d.overdue_count, 1);
    assert_eq!(d.overdue_total, 3000);
    assert_eq!(d.low_stock.len(), 1);
    assert_eq!(d.month.invoiced_total, 3000);
    let hits = db.global_search("marca").unwrap();
    assert!(hits.iter().any(|h| h.kind == "product"));
    let hits = db.global_search("FAC-0").unwrap();
    assert!(hits.iter().any(|h| h.kind == "invoice"));
    // Comodines no rompen la búsqueda.
    assert!(db.global_search("%_").unwrap().is_empty());

    let out = db
        .export_csv("invoices", None, None, dir.path().to_str().unwrap())
        .unwrap();
    let content = std::fs::read_to_string(out).unwrap();
    assert!(content.starts_with('\u{feff}'));
    assert!(content.contains("\"Juan; \"\"el de la esquina\"\"\""));
    assert!(db
        .export_csv("desconocido", None, None, dir.path().to_str().unwrap())
        .is_err());
}

#[test]
fn upgrade_from_v3_preserves_data_and_creates_backup() {
    // Construye una base con solo las migraciones v1..v3 (como la versión anterior publicada).
    let dir = TempDir::new().unwrap();
    {
        let (_d, db) = setup();
        let _ = db; // solo para obtener SQL válido de setup en otra carpeta
    }
    {
        let mut db = LocalDatabase::open_in_dir(dir.path()).unwrap();
        db.complete_initial_setup(&CompleteInitialSetupInput {
            company: SaveCompanyProfileInput {
                trade_name: "Antigua".to_string(),
                ..Default::default()
            },
            admin: CreateInitialAdminInput {
                full_name: "Admin".to_string(),
                username: "admin".to_string(),
                password: "ClaveSegura#1".to_string(),
                password_confirm: "ClaveSegura#1".to_string(),
            },
            paper_size: None,
        })
        .unwrap();
    }
    // Simular una base v3: quitar las tablas v4 y su registro de migración.
    {
        let conn = Connection::open(dir.path().join("cartucho_erp.sqlite3")).unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             DROP TABLE expenses; DROP TABLE quote_lines; DROP TABLE quotes; DROP TABLE payments;
             DROP TABLE invoice_lines; DROP TABLE invoices; DROP TABLE document_sequences;
             DROP TABLE inventory_movements; DROP TABLE products; DROP TABLE customers; DROP TABLE categories;
             DROP TABLE IF EXISTS roles;
             DELETE FROM _schema_migrations WHERE version >= 4;",
        )
        .unwrap();
    }
    let mut db = LocalDatabase::open_in_dir(dir.path()).unwrap();
    db.login("admin", "ClaveSegura#1").unwrap();
    assert_eq!(
        db.get_company_profile().unwrap().unwrap().trade_name,
        "Antigua"
    );
    assert_eq!(db.status_report().unwrap().schema_version, crate::db::target_schema_version());
    let backups = db.list_backups().unwrap();
    assert!(backups
        .iter()
        .any(|b| b.kind == "pre_migration" && b.file_name.contains("v3_to_v")));
    assert!(!db.list_categories("expense").unwrap().is_empty());
}

#[test]
fn optional_modules_change_invoice_behavior() {
    let (_dir, mut db) = setup();
    let pid = product(&db, "Taladro", 250000, 180000, 5.0);
    let cust = db.save_customer(&CustomerInput { name: "Cliente".to_string(), ..Default::default() }).unwrap();

    // Sin inventario: la factura no descuenta existencias.
    db.features = super::Features { inventory: false, ..Default::default() };
    db.create_invoice(&InvoiceInput {
        issue_date: "2026-11-10".to_string(),
        lines: vec![line(Some(pid), "", 2.0, 250000)],
        ..Default::default()
    })
    .unwrap();
    assert_eq!(db.stock_of(pid), 5.0);

    // Sin clientes: no se puede enlazar un cliente guardado.
    db.features = super::Features { customers: false, ..Default::default() };
    assert!(db
        .create_invoice(&InvoiceInput {
            customer_id: Some(cust.id),
            issue_date: "2026-11-10".to_string(),
            lines: vec![line(None, "Servicio", 1.0, 1000)],
            ..Default::default()
        })
        .unwrap_err()
        .contains("clientes"));

    // Sin catálogo: solo ítems personalizados.
    db.features = super::Features { catalog: false, ..Default::default() };
    assert!(db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-10".to_string(),
            lines: vec![line(Some(pid), "", 1.0, 1000)],
            ..Default::default()
        })
        .is_err());
    assert!(db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-10".to_string(),
            lines: vec![line(None, "Instalación", 1.0, 50000)],
            ..Default::default()
        })
        .is_ok());

    // Sin gastos: una compra de inventario no puede registrarse como gasto.
    db.features = super::Features { expenses: false, ..Default::default() };
    assert!(db
        .adjust_stock(&StockAdjustmentInput {
            product_id: pid,
            kind: "purchase".to_string(),
            quantity: 1.0,
            unit_cost: Some(1000),
            record_expense: true,
            ..Default::default()
        })
        .is_err());

    // Todo activo de nuevo: descuenta normalmente.
    db.features = super::Features::default();
    db.create_invoice(&InvoiceInput {
        issue_date: "2026-11-10".to_string(),
        lines: vec![line(Some(pid), "", 1.0, 250000)],
        ..Default::default()
    })
    .unwrap();
    assert_eq!(db.stock_of(pid), 4.0);
    let _ = &mut db;
}

#[test]
fn cash_close_statement_and_seller_filter() {
    let (_dir, mut db) = setup();
    let admin_id = db.get_authenticated_user().unwrap().unwrap().id;
    let cust = db.save_customer(&CustomerInput { name: "Colegio".to_string(), ..Default::default() }).unwrap();

    // Admin: factura de contado (efectivo) y factura a crédito con abono por transferencia.
    let a = db
        .create_invoice(&InvoiceInput {
            issue_date: "2026-11-10".to_string(),
            lines: vec![line(None, "Copias", 10.0, 1000)],
            initial_payment: Some(PaymentInput { amount: 10000, method: "cash".to_string(), paid_at: "2026-11-10".to_string(), note: None }),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(a.summary.created_by_id, Some(admin_id));
    assert_eq!(a.summary.created_by_name.as_deref(), Some("Admin"));
    let b = db
        .create_invoice(&InvoiceInput {
            customer_id: Some(cust.id),
            issue_date: "2026-11-01".to_string(),
            due_date: Some("2026-11-05".to_string()),
            lines: vec![line(None, "Resmas", 5.0, 20000)],
            ..Default::default()
        })
        .unwrap();
    db.add_payment(b.summary.id, &PaymentInput { amount: 30000, method: "transfer".to_string(), paid_at: "2026-11-10".to_string(), note: None })
        .unwrap();
    db.save_expense(&ExpenseInput {
        description: "Domicilio".to_string(),
        amount: 4000,
        expense_date: "2026-11-10".to_string(),
        method: "cash".to_string(),
        ..Default::default()
    })
    .unwrap();

    // Vendedora: una venta en efectivo el mismo día.
    db.save_user(&crate::users::UserInput {
        id: None,
        full_name: "Ana".into(),
        username: "ana".into(),
        role_key: "vendedor".into(),
        password: Some("Vendedora#1".into()),
        is_active: true,
    })
    .unwrap();
    db.logout();
    db.login("ana", "Vendedora#1").unwrap();
    db.create_invoice(&InvoiceInput {
        issue_date: "2026-11-10".to_string(),
        lines: vec![line(None, "Lapiceros", 2.0, 1500)],
        initial_payment: Some(PaymentInput { amount: 3000, method: "cash".to_string(), paid_at: "2026-11-10".to_string(), note: None }),
        ..Default::default()
    })
    .unwrap();
    // Un usuario que no es administrador solo ve su propio cierre aunque pida «todos».
    let mine = db.cash_close("2026-11-10", None).unwrap();
    assert_eq!(mine.user_name.as_deref(), Some("Ana"));
    assert_eq!((mine.collected_total, mine.invoices_count, mine.cash_expenses), (3000, 1, 0));

    db.logout();
    db.login("admin", "ClaveSegura#1").unwrap();
    let all = db.cash_close("2026-11-10", None).unwrap();
    assert_eq!(all.collected_total, 10000 + 30000 + 3000);
    assert_eq!(all.cash_collected, 13000);
    assert_eq!(all.by_method.iter().find(|m| m.method == "transfer").unwrap().total, 30000);
    assert_eq!((all.invoices_count, all.invoices_total), (2, 13000));
    assert_eq!(all.cash_expenses, 4000);
    assert_eq!(all.expected_cash, 9000);
    assert_eq!(all.by_user.len(), 2);
    assert_eq!(all.payments.len(), 3);
    assert!(all.payments.iter().any(|p| p.created_by_name.as_deref() == Some("Ana")));

    // Filtro por vendedor en el historial.
    let ana_id = db.list_users().unwrap().into_iter().find(|u| u.username == "ana").unwrap().id;
    let ana_invoices = db.list_invoices(&InvoiceFilter { created_by: Some(ana_id), ..Default::default() }).unwrap();
    assert_eq!(ana_invoices.len(), 1);
    assert_eq!(ana_invoices[0].created_by_name.as_deref(), Some("Ana"));

    // Estado de cuenta: saldo 70.000 vencido desde el 5 de noviembre.
    let st = db.customer_statement(cust.id, "2026-11-11").unwrap();
    assert_eq!((st.total_invoiced, st.total_paid, st.balance, st.overdue_balance), (100000, 30000, 70000, 70000));
    assert_eq!(st.payments.len(), 1);

    // Bloqueo por inactividad: solo valores permitidos y solo administrador.
    assert_eq!(db.get_preferences().unwrap().auto_lock_minutes, 0);
    assert_eq!(db.set_auto_lock(15).unwrap().auto_lock_minutes, 15);
    assert!(db.set_auto_lock(7).is_err());
    let _ = &mut db;
}

#[test]
fn product_converted_to_service_clears_stock_with_movement() {
    let (_dir, db) = setup();
    let pid = product(&db, "Instalación", 80000, 0, 99999.0);
    let p = db.get_product(pid).unwrap();
    assert_eq!(p.stock_qty, 99999.0);

    let mut input = ProductInput {
        id: Some(pid),
        name: p.name.clone(),
        price: p.price,
        cost: p.cost,
        track_stock: false,
        unit: Some(p.unit.clone()),
        ..Default::default()
    };
    let s = db.save_product(&input).unwrap();
    assert!(!s.track_stock);
    assert_eq!(s.stock_qty, 0.0);
    let moves = db.list_inventory_movements(Some(pid), Some(10)).unwrap();
    assert_eq!(moves[0].kind, "adjustment");
    assert_eq!(moves[0].quantity, -99999.0);
    assert!(moves[0].note.as_deref().unwrap_or("").contains("servicio"));

    // Guardarlo otra vez como servicio no crea más movimientos; volver a producto arranca en cero.
    db.save_product(&input).unwrap();
    assert_eq!(db.list_inventory_movements(Some(pid), Some(10)).unwrap().len(), moves.len());
    input.track_stock = true;
    assert_eq!(db.save_product(&input).unwrap().stock_qty, 0.0);
}

#[test]
fn product_without_stock_control_and_line_notes() {
    let (_dir, db) = setup();
    // Pan del día: producto (no servicio) sin control de existencias.
    let pan = db
        .save_product(&ProductInput {
            name: "Pan francés".to_string(),
            price: 500,
            cost: 200,
            kind: Some("product".to_string()),
            track_stock: false,
            initial_stock: Some(50.0),
            ..Default::default()
        })
        .unwrap();
    assert_eq!((pan.kind.as_str(), pan.track_stock, pan.stock_qty), ("product", false, 0.0));
    // Un servicio nunca controla existencias, aunque lo pidan.
    let svc = db
        .save_product(&ProductInput { name: "Instalación".to_string(), price: 80000, kind: Some("service".to_string()), track_stock: true, ..Default::default() })
        .unwrap();
    assert_eq!((svc.kind.as_str(), svc.track_stock), ("service", false));
    assert!(db.save_product(&ProductInput { name: "X".to_string(), kind: Some("combo".to_string()), ..Default::default() }).is_err());

    // Vender 300 panes no descuenta nada ni falla por existencias.
    let mut l = line(Some(pan.id), "", 300.0, 500);
    l.note = Some("  Garantía: 1 día  ".to_string());
    let inv = db
        .create_invoice(&InvoiceInput { issue_date: "2026-11-11".to_string(), lines: vec![l, line(Some(svc.id), "", 1.0, 80000)], ..Default::default() })
        .unwrap();
    assert_eq!(inv.lines[0].note.as_deref(), Some("Garantía: 1 día"));
    assert_eq!(inv.lines[1].note, None);
    assert_eq!(db.get_product(pan.id).unwrap().stock_qty, 0.0);

    // La nota pasa de la cotización a la factura.
    let mut ql = line(None, "Torta de cumpleaños", 1.0, 60000);
    ql.note = Some("Entrega el sábado".to_string());
    let q = db
        .create_quote(&QuoteInput { issue_date: "2026-11-11".to_string(), lines: vec![ql], ..Default::default() })
        .unwrap();
    assert_eq!(q.lines[0].note.as_deref(), Some("Entrega el sábado"));
    let converted = db.convert_quote_to_invoice(q.summary.id, "2026-11-11", None).unwrap();
    assert_eq!(converted.lines[0].note.as_deref(), Some("Entrega el sábado"));
}

#[test]
fn upgrade_v5_to_v6_classifies_existing_items() {
    let dir = TempDir::new().unwrap();
    let file = dir.path().join("cartucho_erp.sqlite3");
    {
        let mut conn = Connection::open(&file).unwrap();
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;").unwrap();
        crate::db::LocalDatabase::apply_migrations_slice_for_tests(&mut conn, 5).unwrap();
        conn.execute_batch(
            "INSERT INTO products (name, price, cost, track_stock, stock_qty, created_at, updated_at)
               VALUES ('Resma', 18000, 12000, 1, 10, '2026-11-01', '2026-11-01'),
                      ('Impresión', 300, 0, 0, 0, '2026-11-01', '2026-11-01');",
        )
        .unwrap();
    }
    let db = crate::db::LocalDatabase::open_in_dir(dir.path()).unwrap();
    assert_eq!(db.status_report().unwrap().schema_version, crate::db::target_schema_version());
    let conn = db.connect().unwrap();
    let kinds: Vec<(String, String, f64)> = conn
        .prepare("SELECT name, item_kind, stock_qty FROM products ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(kinds, vec![("Resma".to_string(), "product".to_string(), 10.0), ("Impresión".to_string(), "service".to_string(), 0.0)]);
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
    assert_eq!(integrity, "ok");
    let backups: Vec<_> = std::fs::read_dir(db.backups_dir()).unwrap().filter_map(|e| e.ok()).collect();
    assert!(backups.iter().any(|b| b.file_name().to_string_lossy().contains("pre_migration_v5_to_v")));
}

#[test]
fn product_barcode_is_unique_searchable_and_validated() {
    let (_dir, db) = setup();
    let p = db
        .save_product(&ProductInput {
            name: "Cuaderno".to_string(),
            barcode: Some("  7702001045678 ".to_string()),
            price: 5000,
            track_stock: true,
            kind: Some("product".to_string()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(p.barcode.as_deref(), Some("7702001045678"));
    // Se encuentra buscando por el código.
    let found = db.list_products(Some("7702001045678".to_string()), None, false, false).unwrap();
    assert_eq!(found.len(), 1);
    // Único.
    let dup = db.save_product(&ProductInput { name: "Otro".to_string(), barcode: Some("7702001045678".to_string()), ..Default::default() });
    assert!(dup.unwrap_err().contains("código de barras"));
    // Sin espacios internos.
    let bad = db.save_product(&ProductInput { name: "Malo".to_string(), barcode: Some("770 200".to_string()), ..Default::default() });
    assert!(bad.is_err());
    // Varios productos sin código no chocan.
    db.save_product(&ProductInput { name: "A".to_string(), ..Default::default() }).unwrap();
    db.save_product(&ProductInput { name: "B".to_string(), barcode: Some("   ".to_string()), ..Default::default() }).unwrap();
    // Al editar se puede quitar.
    let edited = db
        .save_product(&ProductInput { id: Some(p.id), name: "Cuaderno".to_string(), price: 5000, track_stock: true, kind: Some("product".to_string()), ..Default::default() })
        .unwrap();
    assert_eq!(edited.barcode, None);
}

// ------------------------------------------------------------------ Panel por periodo

#[test]
fn dashboard_range_trend_previous_period_and_scope() {
    let (_dir, mut db) = setup();
    // Mínimo 60 con 50 en existencia: aparece en «stock bajo».
    let pid = db
        .save_product(&ProductInput { name: "Tinta".into(), price: 10_000, cost: 4_000, track_stock: true, min_stock: 60.0, initial_stock: Some(50.0), ..Default::default() })
        .unwrap()
        .id;
    let invoice = |date: &str, q: f64, paid: i64| InvoiceInput {
        issue_date: date.into(),
        lines: vec![line(Some(pid), "Tinta", q, 10_000)],
        initial_payment: if paid > 0 { Some(PaymentInput { amount: paid, method: "cash".into(), paid_at: date.into(), note: None }) } else { None },
        ..Default::default()
    };
    db.create_invoice(&invoice("2026-11-03", 2.0, 20_000)).unwrap();
    db.create_invoice(&invoice("2026-11-10", 1.0, 0)).unwrap();
    db.create_invoice(&invoice("2026-10-28", 3.0, 30_000)).unwrap();
    db.save_expense(&ExpenseInput { description: "Luz".into(), amount: 5_000, expense_date: "2026-11-05".into(), method: "cash".into(), ..Default::default() }).unwrap();

    // Sin fechas: del día 1 del mes a hoy (comportamiento anterior).
    let d = db.dashboard("2026-11-10").unwrap();
    assert_eq!((d.month.date_from.as_str(), d.month.date_to.as_str()), ("2026-11-01", "2026-11-10"));
    assert_eq!(d.month.invoiced_total, 30_000);
    assert_eq!(d.trend.len(), 10, "un punto por día, sin huecos");
    assert_eq!(d.trend[2].invoiced, 20_000);
    assert_eq!(d.trend[4].expenses, 5_000);
    assert_eq!(d.trend[1].invoiced, 0);
    assert_eq!(d.trend.iter().map(|t| t.invoiced).sum::<i64>(), d.month.invoiced_total);
    // Periodo anterior de igual duración: 22 al 31 de octubre.
    let prev = d.previous.clone().unwrap();
    assert_eq!((prev.date_from.as_str(), prev.date_to.as_str()), ("2026-10-22", "2026-10-31"));
    assert_eq!(prev.invoiced_total, 30_000);
    assert_eq!(prev.collected_total, 30_000);
    assert!(d.scope.expenses && d.scope.finance && d.scope.inventory);
    assert_eq!(d.low_stock.len(), 1);

    // Rango personalizado y serie mensual en rangos largos.
    let week = db.dashboard_range("2026-11-10", Some("2026-11-04"), Some("2026-11-10")).unwrap();
    assert_eq!(week.month.invoiced_total, 10_000);
    assert_eq!(week.trend.len(), 7);
    let year = db.dashboard_range("2026-11-10", Some("2026-01-01"), None).unwrap();
    assert_eq!(year.trend.len(), 11);
    assert_eq!(year.trend.last().unwrap().period, "2026-11");
    assert_eq!(year.trend[9].invoiced, 30_000);
    assert!(db.dashboard_range("2026-11-10", Some("2026-11-11"), None).is_err());
    assert!(db.dashboard_range("2026-11-10", Some("2010-01-01"), None).is_err());

    // Módulos desactivados: sus datos no viajan y `scope` lo indica.
    db.features = super::Features { expenses: false, inventory: false, ..Default::default() };
    let d = db.dashboard("2026-11-10").unwrap();
    assert!(!d.scope.expenses && !d.scope.inventory && d.scope.finance);
    assert_eq!(d.month.operating_expenses, 0);
    assert!(d.month.expenses_by_category.is_empty());
    assert!(d.low_stock.is_empty());
    assert_eq!(d.month.invoiced_total, 30_000);
    db.features = super::Features::default();

    // Un rol sin Gastos, Finanzas ni Inventario no recibe esas cifras.
    let role = db
        .save_role(
            &crate::users::RoleInput {
                id: None,
                name: "Caja".into(),
                description: None,
                permissions: [("invoices".to_string(), "write".to_string())].into_iter().collect(),
            },
            &crate::licensing::ALL_MODULES.iter().map(|m| m.to_string()).collect(),
        )
        .unwrap();
    db.save_user(&crate::users::UserInput { id: None, full_name: "Ana Caja".into(), username: "ana".into(), role_key: role.key.clone(), password: Some("ClaveSegura123".into()), is_active: true }).unwrap();
    db.logout();
    db.login("ana", "ClaveSegura123").unwrap();
    let d = db.dashboard("2026-11-10").unwrap();
    assert!(!d.scope.expenses && !d.scope.finance && !d.scope.inventory);
    assert_eq!(d.month.net_cash_flow, 0);
    assert_eq!(d.month.gross_profit, 0);
    assert!(d.trend.iter().all(|t| t.expenses == 0));
    assert!(d.month.monthly.iter().all(|m| m.expenses == 0));
    assert_eq!(d.month.collected_total, 20_000);
}
