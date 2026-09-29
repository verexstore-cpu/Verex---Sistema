const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  elegirCarpeta:   () => ipcRenderer.invoke('elegir-carpeta'),
  estadoMotor:     () => ipcRenderer.invoke('estado-motor'),
  instalarMotor:   () => ipcRenderer.invoke('instalar-motor'),
  procesarFotos:   (archivos, carpetaSalida, opts) =>
    ipcRenderer.invoke('procesar-fotos', { archivos, carpetaSalida, opts }),
  abrirCarpeta:    (ruta) => ipcRenderer.invoke('abrir-carpeta', ruta),
  onProgresoMotor: (cb) => ipcRenderer.on('progreso-motor', (_, data) => cb(data)),
  onProgresoLote:  (cb) => ipcRenderer.on('progreso-lote', (_, data) => cb(data)),
})
