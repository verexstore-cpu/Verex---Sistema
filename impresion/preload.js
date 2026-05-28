const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getPrinters:    () => ipcRenderer.invoke('get-printers'),
  imprimir: (html, widthMm, heightMm, printerName, pageCount) =>
    ipcRenderer.invoke('print-content', { html, widthMm, heightMm, printerName, pageCount }),
  // Perfiles de rollo
  rollProfileExists: (rollType)                    => ipcRenderer.invoke('roll-profile-exists', rollType),
  saveRollProfile:   (rollType, printerName)       => ipcRenderer.invoke('save-roll-profile', { rollType, printerName }),
  loadRollProfile:   (rollType, printerName)       => ipcRenderer.invoke('load-roll-profile', { rollType, printerName }),
  openPrinterProps:  (printerName)                 => ipcRenderer.invoke('open-printer-props', printerName),
  // Recibir PDFs enviados desde el admin (localhost:7891)
  onLoadPdfRecibo:   (cb) => ipcRenderer.on('load-pdf-recibo',   (_, data) => cb(data)),
  onLoadPdfGuia:     (cb) => ipcRenderer.on('load-pdf-guia',     (_, data) => cb(data)),
  onLoadPdfEtiqueta: (cb) => ipcRenderer.on('load-pdf-etiqueta', (_, data) => cb(data)),
})
