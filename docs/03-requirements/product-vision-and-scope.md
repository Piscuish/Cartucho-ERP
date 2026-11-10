# Visión del Producto, Alcance Inicial y Exclusiones

## 1. Enfoque Inicial de Cartucho ERP

**Cartucho ERP** nace como una aplicación de escritorio **local-first**, experimental y progresiva. Su objetivo es construir paso a paso una plataforma ERP funcional, estable y fácil de mantener, donde cada usuario o negocio controle sus propios datos en su equipo sin depender de Internet ni de infraestructura compleja.

Prioridades del proyecto:
- **Arquitectura limpia y escalable** (Tauri 2 + Rust + SQLite + React + TypeScript).
- **Funcionalidades básicas verificables** antes de agregar complejidad.
- **Interfaz intuitiva, rápida y profesional.**
- **Módulos sencillos** que puedan ampliarse progresivamente.
- **Cero sobrearquitectura:** No implementar características únicamente porque un ERP corporativo grande podría llegar a necesitarlas.

---

## 2. Alcance Futuro de Documentos de Venta y Registro Manual de Pagos

Cuando en fases posteriores se desarrolle el módulo de ventas y cobros, su funcionamiento seguirá un modelo administrativo interno claro y directo:

### 2.1. Documentos de Venta / Facturas Internas
- Permitir registrar una operación de venta y generar un **documento de venta o factura interna de control**.
- Estos documentos tendrán carácter **interno/administrativo** y no se presentarán como facturas electrónicas fiscales.
- Cada documento manejará tres estados de pago claros:
  - **Pendiente**
  - **Parcialmente pagada**
  - **Pagada**

### 2.2. Registro Manual e Informativo de Pagos
- **Cartucho ERP NO procesará pagos electrónicos.**
- Cuando la empresa reciba un pago de un cliente, el usuario registrará manualmente:
  1. **Importe recibido** (ej. `\$250.000`).
  2. **Método de pago utilizado:**
     - `Efectivo`
     - `Transferencia`
     - `Tarjeta`
     - `Otro`
  3. **Fecha del pago.**
  4. **Observación opcional** (ej. número de comprobante o nota interna).
- El sistema únicamente almacena dicho registro en SQLite y actualiza el saldo y estado del documento de venta. No realiza ni verifica transferencias bancarias ni cobros con tarjeta.

---

## 3. Exclusiones Explícitas del Alcance Inicial

Para evitar complejidad prematura legal, fiscal, bancaria o regulatoria, quedan **estrictamente fuera del alcance inicial**:

- Pasarelas de pago en línea.
- Conexiones o conciliaciones bancarias automáticas.
- Procesamiento de tarjetas de crédito o débito.
- Integración con datáfonos o terminales bancarias (POS bancario).
- Almacenamiento de datos sensibles de tarjetas (PAN, CVV, etc.).
- Facturación electrónica **DIAN** u otros organismos tributarios.
- Validaciones fiscales y tributarias avanzadas.
- Integraciones con proveedores tecnológicos de facturación electrónica.
