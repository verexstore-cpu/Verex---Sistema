const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const engine = require('./engine.js')

// Log de depuración a archivo — para diagnosticar sin depender de que el
// usuario pueda abrir/leer las DevTools en su PC.
const LOG_FILE = path.join(app.getPath('desktop'), 'verex-mejora-fotos-debug.log')
function logDebug(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toLocaleTimeString('es-SV')}] ${msg}\n`) } catch (_) {}
}
process.on('uncaughtException', (err) => logDebug('uncaughtException (main): ' + (err && err.stack || err)))

let mainWindow

const EXTENSIONES_VALIDAS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'VEREX – Mejora de fotos',
    backgroundColor: '#0e0e18',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile('index.html')
  mainWindow.setMenuBarVisibility(false)
  mainWindow.once('ready-to-show', () => {
    mainWindow.center()
    mainWindow.show()
    mainWindow.webContents.openDevTools({ mode: 'bottom' })
  })

  // Si el preload.js falla al cargar, window.electronAPI nunca aparece y
  // todos los botones quedan sin reaccionar — esto lo hace visible en vez
  // de fallar en silencio.
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logDebug('preload-error: ' + preloadPath + ' -> ' + (error && error.stack || error))
    dialog.showErrorBox('Error cargando preload.js', preloadPath + '\n\n' + (error && error.stack || error))
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logDebug(`console[${level}] ${sourceId}:${line} ${message}`)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logDebug('render-process-gone: ' + JSON.stringify(details))
  })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Elegir carpeta con fotos ────────────────────────────────────────────────
ipcMain.handle('elegir-carpeta', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths.length) return { ok: false }
  const carpeta = res.filePaths[0]
  const archivos = fs.readdirSync(carpeta)
    .filter(f => EXTENSIONES_VALIDAS.has(path.extname(f).toLowerCase()))
    .map(f => {
      const ruta = path.join(carpeta, f)
      return { nombre: f, ruta, url: 'file://' + ruta.replace(/\\/g, '/') }
    })
  return { ok: true, carpeta, archivos }
})

// ── Estado / instalación del motor de IA ────────────────────────────────────
ipcMain.handle('estado-motor', () => {
  return { instalado: engine.isEngineInstalled(app.getPath('userData')) }
})

ipcMain.handle('instalar-motor', async () => {
  try {
    await engine.instalarMotor(app.getPath('userData'), (info) => {
      mainWindow.webContents.send('progreso-motor', info)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Procesar fotos (preview de unas pocas o el lote completo) ──────────────
ipcMain.handle('procesar-fotos', async (_, { archivos, carpetaSalida, opts }) => {
  fs.mkdirSync(carpetaSalida, { recursive: true })
  const resultados = []
  for (let i = 0; i < archivos.length; i++) {
    const ruta = archivos[i]
    const nombreSalida = path.basename(ruta, path.extname(ruta)) + '.jpg'
    const rutaSalida = path.join(carpetaSalida, nombreSalida)
    mainWindow.webContents.send('progreso-lote', {
      actual: i + 1, total: archivos.length, nombre: path.basename(ruta), etapa: 'procesando',
    })
    try {
      await engine.procesarImagen(app.getPath('userData'), ruta, rutaSalida, opts)
      resultados.push({ ruta, ok: true, salida: rutaSalida, url: 'file://' + rutaSalida.replace(/\\/g, '/') })
    } catch (e) {
      resultados.push({ ruta, ok: false, error: e.message })
    }
  }
  return { ok: true, resultados, carpetaSalida }
})

ipcMain.handle('abrir-carpeta', (_, ruta) => {
  shell.openPath(ruta)
  return { ok: true }
})
