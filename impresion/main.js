const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const { exec } = require('child_process')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 860,
    minHeight: 600,
    title: 'VEREX – Impresión',
    backgroundColor: '#f0f2f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile('index.html')
  mainWindow.setMenuBarVisibility(false)
}

app.whenReady().then(() => {
  createWindow()
  startPrintServer()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ── Servidor HTTP local para recibir PDFs desde el admin ──────────────────
// Escucha en localhost:7891 — solo accesible desde esta misma PC
function startPrintServer() {
  const server = http.createServer((req, res) => {
    // Cabeceras CORS para que el admin (web) pueda hacer fetch a localhost
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

    // GET /ping — el admin comprueba si la app está abierta
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, app: 'VEREX Impresión' }))
      return
    }

    // POST /print-recibo   — recibe PDF térmico 62mm desde el admin
    // POST /print-guia     — recibe Nota de Pedido desde el admin
    // POST /print-etiqueta — recibe PDF de etiquetas DK-1204 desde consignación
    if (req.method === 'POST' && (req.url === '/print-recibo' || req.url === '/print-guia' || req.url === '/print-etiqueta')) {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          let canal = 'load-pdf-recibo'
          if (req.url === '/print-guia')     canal = 'load-pdf-guia'
          if (req.url === '/print-etiqueta') canal = 'load-pdf-etiqueta'
          if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
            mainWindow.webContents.send(canal, {
              pdfBase64: body.pdfBase64,
              nombre: body.nombre || '',
            })
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
      return
    }

    res.writeHead(404); res.end()
  })

  server.listen(7891, '127.0.0.1', () => {
    console.log('VEREX Print Server → http://127.0.0.1:7891')
  })

  server.on('error', (e) => {
    // Puerto ocupado: no es crítico, la app sigue funcionando normal
    console.warn('Print server error:', e.message)
  })
}

// ── Obtener impresoras via PowerShell (detecta online y offline) ──
function getPrintersPowerShell() {
  return new Promise((resolve) => {
    const cmd = `powershell -NoProfile -Command "Get-Printer | Select-Object Name,DriverName,PrinterStatus | ConvertTo-Json"`
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err || !stdout.trim()) {
        resolve([])
        return
      }
      try {
        let data = JSON.parse(stdout.trim())
        if (!Array.isArray(data)) data = [data]
        resolve(data.map(p => ({
          name: p.Name || '',
          driver: p.DriverName || '',
          // 3=Idle, 4=Printing → Ready. 7=Offline. WorkOffline=true → Offline. Todo lo demás = Ready
          status: (p.WorkOffline === true || p.PrinterStatus === 7) ? 'Offline' : 'Ready',
        })))
      } catch {
        resolve([])
      }
    })
  })
}

ipcMain.handle('get-printers', async () => {
  // 1. Intentar con PowerShell (más completo)
  const psList = await getPrintersPowerShell()
  if (psList.length > 0) return psList

  // 2. Fallback: API nativa de Electron
  try {
    const native = await mainWindow.webContents.getPrintersAsync()
    return native.map(p => ({ name: p.name, driver: '', status: p.isDefault ? 'Default' : 'Ready' }))
  } catch {
    return []
  }
})

// ── Imprimir sin diálogo ──
ipcMain.handle('print-content', async (event, { html, widthMm, heightMm, printerName }) => {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `verex-${Date.now()}.html`)
    fs.writeFileSync(tmpFile, html, 'utf8')

    const win = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })

    win.loadFile(tmpFile)

    win.webContents.once('did-finish-load', async () => {
      let finalHeightMm = heightMm
      if (heightMm === 0) {
        const px = await win.webContents.executeJavaScript('document.body.scrollHeight')
        finalHeightMm = Math.ceil((px / 96) * 25.4) + 6
      }

      win.webContents.print({
        silent: true,
        printBackground: true,
        deviceName: printerName || '',
        pageSize: {
          width: Math.round(widthMm * 1000),
          height: Math.round(finalHeightMm * 1000),
        },
        margins: { marginType: 'none' },
      }, (success, errorType) => {
        win.close()
        fs.unlink(tmpFile, () => {})
        resolve({ success, error: errorType || null })
      })
    })
  })
})
