# Hub de consignación — mapa de archivos

`index.html` solo trae el HTML. El código está en archivos que se cargan **en este orden** (scripts clásicos, comparten variables globales: no cambiar el orden).

- `css/hub.css` — estilos
- `js/hub-01.js` — 2017 líneas. Empieza con: hashStr, sanitizar, jsArg, jsArgArr, safeParseJSON, login
- `js/hub-02.js` — 2026 líneas. Empieza con: abrirModalVendedor, guardarVendedor, generarContratoPDF, generarContratoConsignacionPDF, generarContratoAfiliadoPDF, toggleMenuProducto
- `js/hub-03.js` — 2059 líneas. Empieza con: confirmarVentaAfiliado, enviarPorMensajeria, copiarCodigoMensajeria, enviarWhatsAppMensajeria, descargarPDFMensajeria, generarReciboPDF
- `js/hub-04.js` — 2011 líneas. Empieza con: abrirRegistrarVenta, registrarVenta, calcularComision, abrirCorte, toggleDecision, confirmarCorte
- `js/hub-05.js` — 2006 líneas. Empieza con: poblarFiltroCategoria, normalizar, limpiarSeleccion, descargarFotosSeleccionadas, abrirEditarStockItem, ejecutarAuditoriaStock
- `js/hub-06.js` — 2021 líneas. Empieza con: selFormatoNota, actualizarPreviewNota, generarPDFNotaLibre, enviarNotaImpresion, imprimirPDFNotaNavegador, _buscarProducto
- `js/hub-07.js` — 1576 líneas. Empieza con: cambioVDToggle, cambioVDSeleccion, cambioVDPreview, confirmarCambioVD, agregarProductoVentaDirectaVD, corregirSaldoVD
- `js/hub-extra.js` — Venta directa / escáner (segundo bloque)
