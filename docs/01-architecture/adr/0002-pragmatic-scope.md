# ADR-0002: Enfoque Pragmático y Exclusión de Complejidad Fiscal/Bancaria Prematura

- **Estado:** Aceptado
- **Fecha:** 2026-11-10

## Contexto
Los sistemas ERP suelen fracasar en sus etapas tempranas cuando intentan abarcar desde el inicio normativas tributarias complejas (facturación electrónica gubernamental), integraciones bancarias en tiempo real o pasarelas de pago antes de contar con un flujo operativo básico sólido.

## Decisión
1. Mantener **Cartucho ERP** como un proyecto evolutivo por etapas, priorizando una arquitectura limpia, una interfaz intuitiva y módulos sencillos que puedan probarse localmente.
2. Cuando se implementen los módulos de ventas y pagos en fases posteriores:
   - Los documentos generados serán **documentos de venta o facturas internas de control**, sin validez fiscal electrónica.
   - Los pagos se registrarán de forma **100% manual e informativa** (indicando monto recibido, fecha, observación opcional y método: *Efectivo, Transferencia, Tarjeta u Otro*).
3. Quedan estrictamente fuera del alcance inicial: pasarelas de pago, procesamiento de tarjetas, integración con datáfonos, conexiones bancarias y facturación electrónica DIAN.

## Consecuencias
- **Positivas:** Desarrollo enfocado en valor funcional real y verificable; ausencia de bloqueos regulatorios o certificaciones de terceros durante la construcción de la plataforma base.
- **Negativas:** Los documentos emitidos en las primeras versiones tienen carácter de control administrativo interno.
