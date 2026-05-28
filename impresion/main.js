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

// ── Selector de rollo: modifica el DEVMODE del driver via Spooler API ───────
// Dimensiones en décimas de mm (formato DEVMODE: 54mm = 540, 17mm = 170)
const ROLL_DIMS = {
  '62mm':   { w: 620, l: 900  },  // 62mm ancho × 90mm largo (guías)
  'dk1204': { w: 540, l: 170  },  // 54mm ancho × 17mm largo (DK-1204)
}

function buildDevModeScript(printerName, widthTenths, lengthTenths) {
  const pn = printerName.replace(/'/g, "''")
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinPrint {
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern int DocumentProperties(IntPtr hWnd,IntPtr hPrinter,string dev,IntPtr dmOut,IntPtr dmIn,int fMode);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool SetPrinter(IntPtr h,int level,IntPtr pPrinter,int cmd);
}
"@ -Language CSharp

$name = '${pn}'
$w    = ${widthTenths}
$l    = ${lengthTenths}
$m    = [Runtime.InteropServices.Marshal]
$hP   = [IntPtr]::Zero

if (-not [WinPrint]::OpenPrinter($name,[ref]$hP,[IntPtr]::Zero)) { exit 1 }
try {
    $sz = [WinPrint]::DocumentProperties([IntPtr]::Zero,$hP,$name,[IntPtr]::Zero,[IntPtr]::Zero,0)
    if ($sz -le 0) { exit 1 }
    $dm = $m::AllocHGlobal($sz)
    try {
        # Leer DEVMODE actual
        if ([WinPrint]::DocumentProperties([IntPtr]::Zero,$hP,$name,$dm,[IntPtr]::Zero,2) -le 0) { exit 1 }
        # Modificar campos de papel (offsets DEVMODEW Unicode):
        # +72 dmFields, +78 dmPaperSize, +80 dmPaperLength, +82 dmPaperWidth
        $m::WriteInt32($dm,72,($m::ReadInt32($dm,72) -bor 14))  # 14 = DM_PAPERSIZE|DM_PAPERLENGTH|DM_PAPERWIDTH
        $m::WriteInt16($dm,78,256)          # DMPAPER_USER
        $m::WriteInt16($dm,80,[short]$l)    # dmPaperLength
        $m::WriteInt16($dm,82,[short]$w)    # dmPaperWidth
        # Dejar que el driver rellene sus datos privados (dmDriverExtra)
        $dm2 = $m::AllocHGlobal($sz)
        try {
            if ([WinPrint]::DocumentProperties([IntPtr]::Zero,$hP,$name,$dm2,$dm,10) -le 0) { exit 1 }
            # Guardar como default de usuario (nivel 9)
            $pi = $m::AllocHGlobal($m::SizeOf([IntPtr]))
            try {
                $m::WriteIntPtr($pi,$dm2)
                if (-not [WinPrint]::SetPrinter($hP,9,$pi,0)) { exit 1 }
            } finally { $m::FreeHGlobal($pi) }
        } finally { $m::FreeHGlobal($dm2) }
    } finally { $m::FreeHGlobal($dm) }
} finally { [WinPrint]::ClosePrinter($hP) }
exit 0
`
}

// No necesita "perfil guardado" — las dimensiones son fijas por tipo de rollo
ipcMain.handle('roll-profile-exists', () => ({ exists: true }))
ipcMain.handle('save-roll-profile',   () => ({ ok: true }))

ipcMain.handle('load-roll-profile', (_, { rollType, printerName }) => {
  const dims = ROLL_DIMS[rollType]
  if (!dims) return { ok: false, error: 'Tipo de rollo desconocido' }
  const script = buildDevModeScript(printerName, dims.w, dims.l)
  const ps1 = path.join(os.tmpdir(), `verex-devmode-${Date.now()}.ps1`)
  fs.writeFileSync(ps1, script, 'utf8')
  return new Promise(resolve => {
    exec(`powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps1}"`,
      { timeout: 15000 }, (err, stdout, stderr) => {
        fs.unlink(ps1, () => {})
        resolve({ ok: !err, error: err?.message || stderr || null })
      })
  })
})

ipcMain.handle('open-printer-props', (_, printerName) => {
  exec(`rundll32 printui.dll,PrintUIEntry /p /n "${printerName}"`)
  return { ok: true }
})

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
      // widthMm === 0 → etiquetas DK-1204: webContents.print() SIN pageSize.
      //   El DEVMODE del driver ya fue configurado correctamente por load-roll-profile
      //   (via Spooler API), así que el driver Brother valida el rollo físico contra
      //   su propio DEVMODE → sin error de tipo de rollo.
      // widthMm  >  0 → guías / recibos: webContents.print() con pageSize explícito.
      if (widthMm === 0) {
        win.webContents.print({
          silent: true,
          printBackground: true,
          deviceName: printerName || '',
          margins: { marginType: 'none' },
        }, (success, errorType) => {
          win.close()
          fs.unlink(tmpFile, () => {})
          resolve({ success, error: errorType || null })
        })
        return
      }

      // ── Guías / Recibos: webContents.print() con pageSize ──
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
