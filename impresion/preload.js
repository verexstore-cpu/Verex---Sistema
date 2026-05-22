const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  imprimir: (html, widthMm, heightMm, printerName) =>
    ipcRenderer.invoke('print-content', { html, widthMm, heightMm, printerName }),
})
