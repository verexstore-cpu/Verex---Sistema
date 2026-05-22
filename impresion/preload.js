const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  imprimir: (html, widthMm, heightMm, printerName) =>
    ipcRenderer.invoke('print-content', { html, widthMm, heightMm, printerName }),
  // Recibir PDFs enviados desde el admin (localhost:7891)
  onLoadPdfRecibo: (cb) => ipcRenderer.on('load-pdf-recibo', (_, data) => cb(data)),
  onLoadPdfGuia:   (cb) => ipcRenderer.on('load-pdf-guia',   (_, data) => cb(data)),
})
