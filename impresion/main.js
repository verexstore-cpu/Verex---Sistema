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

// ── Selector de rollo ────────────────────────────────────────────────────────
// 62mm continuo : DEVMODE se construye automáticamente por API (el driver
//                 Brother reconoce 62mm×90mm sin configuración previa).
// DK-1204 54×17mm: se captura el DEVMODE binario EXACTO del driver después de
//                   que el usuario lo configura en preferencias Windows, y se
//                   restaura antes de imprimir — incluyendo los campos privados
//                   (dmDriverExtra) que codifican el tipo de medio correcto.

function getProfilePath(rollType) {
  return path.join(app.getPath('userData'), `verex-roll-${rollType}.devmode`)
}

// Ejecuta un script PowerShell en archivo temporal y devuelve { ok, error }
function runPs1(script, timeout = 15000) {
  const ps1 = path.join(os.tmpdir(), `verex-ps-${Date.now()}.ps1`)
  fs.writeFileSync(ps1, script, 'utf8')
  return new Promise(resolve => {
    exec(`powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File "${ps1}"`,
      { timeout }, (err, stdout, stderr) => {
        fs.unlink(ps1, () => {})
        const detail = [stdout, stderr].map(s => (s||'').trim()).filter(Boolean).join(' | ')
        resolve({ ok: !err, out: (stdout||'').trim(), error: err ? (detail || err.message) : null })
      })
  })
}

// ── 62mm: construye DEVMODE con API Spooler (funciona sin perfil guardado) ──
function buildDevModeScript(printerName, widthTenths, lengthTenths) {
  const pn = printerName.replace(/'/g, "''")
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinPrintBuild {
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
if (-not [WinPrintBuild]::OpenPrinter($name,[ref]$hP,[IntPtr]::Zero)) { exit 1 }
try {
    $sz = [WinPrintBuild]::DocumentProperties([IntPtr]::Zero,$hP,$name,[IntPtr]::Zero,[IntPtr]::Zero,0)
    if ($sz -le 0) { exit 1 }
    $dm = $m::AllocHGlobal($sz)
    try {
        if ([WinPrintBuild]::DocumentProperties([IntPtr]::Zero,$hP,$name,$dm,[IntPtr]::Zero,2) -le 0) { exit 1 }
        $m::WriteInt32($dm,72,($m::ReadInt32($dm,72) -bor 14))
        $m::WriteInt16($dm,78,256)
        $m::WriteInt16($dm,80,[short]$l)
        $m::WriteInt16($dm,82,[short]$w)
        $dm2 = $m::AllocHGlobal($sz)
        try {
            if ([WinPrintBuild]::DocumentProperties([IntPtr]::Zero,$hP,$name,$dm2,$dm,10) -le 0) { exit 1 }
            $pi = $m::AllocHGlobal($m::SizeOf([IntPtr]))
            try {
                $m::WriteIntPtr($pi,$dm2)
                if (-not [WinPrintBuild]::SetPrinter($hP,9,$pi,0)) { exit 1 }
            } finally { $m::FreeHGlobal($pi) }
        } finally { $m::FreeHGlobal($dm2) }
    } finally { $m::FreeHGlobal($dm) }
} finally { [WinPrintBuild]::ClosePrinter($hP) }
exit 0
`
}

// ── DK-1204 BYPASS: captura el DEVMODE exacto tal como el usuario lo configuró ──
// El usuario abre Preferencias → selecciona 54×17mm (DK-1204) → cierra → hace clic en 💾.
// En ese momento DocumentProperties devuelve el DEVMODE con el código DK-1204 que el
// usuario eligió manualmente. Lo guardamos SIN ninguna modificación.
// Con GDI directo (CreateDC con ese DEVMODE), el driver imprime en 54×17mm y
// la validación RFID ocurre solo en el pipeline de Windows/Chromium, no en GDI directo.
function buildDK1204BypassScript(printerName, outputFile) {
  const pn = printerName.replace(/'/g, "''")
  const of = outputFile.replace(/\\/g, '\\\\').replace(/'/g, "''")
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinPrintCapture {
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern int DocumentProperties(IntPtr hWnd,IntPtr hPrinter,string dev,IntPtr dmOut,IntPtr dmIn,int fMode);
    [DllImport("kernel32.dll")] public static extern int GetLastError();
}
"@ -Language CSharp
$name = '${pn}'
$m    = [Runtime.InteropServices.Marshal]
$hP   = [IntPtr]::Zero
if (-not [WinPrintCapture]::OpenPrinter($name,[ref]$hP,[IntPtr]::Zero)) {
    Write-Error "OpenPrinter fallo Win32=$([WinPrintCapture]::GetLastError()) impresora='$name'"
    exit 1
}
try {
    $sz = [WinPrintCapture]::DocumentProperties([IntPtr]::Zero,$hP,$name,[IntPtr]::Zero,[IntPtr]::Zero,0)
    if ($sz -le 0) { Write-Error "DocumentProperties tamaño fallo"; exit 1 }
    $dm = $m::AllocHGlobal($sz)
    try {
        if ([WinPrintCapture]::DocumentProperties([IntPtr]::Zero,$hP,$name,$dm,[IntPtr]::Zero,2) -le 0) {
            Write-Error "DocumentProperties lectura fallo"; exit 1
        }
        # Leer y loguear campos estándar para diagnóstico
        $paperSize = $m::ReadInt16($dm,78)
        $paperLen  = $m::ReadInt16($dm,80)
        $paperWid  = $m::ReadInt16($dm,82)
        Write-Output "DEVMODE capturado: sz=$sz dmPaperSize=$paperSize dmPaperLength=$paperLen dmPaperWidth=$paperWid"
        # Guardar bytes SIN modificación — exactamente como el driver los tiene ahora
        $bytes = New-Object byte[] $sz
        $m::Copy($dm, $bytes, 0, $sz)
        [System.IO.File]::WriteAllBytes('${of}', $bytes)
        Write-Output "Perfil guardado en ${of}"
    } finally { $m::FreeHGlobal($dm) }
} finally { [WinPrintCapture]::ClosePrinter($hP) }
exit 0
`
}

// ── DK-1204: restaura el DEVMODE binario como default de usuario ───────────
// Carga los bytes guardados y los pasa a SetPrinter(nivel 9) —
// el mismo nivel que usan las preferencias de usuario de Windows.
function buildLoadDevModeScript(printerName, inputFile) {
  const pn = printerName.replace(/'/g, "''")
  const inf = inputFile.replace(/\\/g, '\\\\').replace(/'/g, "''")
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinPrintLoad {
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool SetPrinter(IntPtr h,int level,IntPtr pPrinter,int cmd);
}
"@ -Language CSharp
$name  = '${pn}'
$m     = [Runtime.InteropServices.Marshal]
$hP    = [IntPtr]::Zero
$bytes = [System.IO.File]::ReadAllBytes('${inf}')
if (-not [WinPrintLoad]::OpenPrinter($name,[ref]$hP,[IntPtr]::Zero)) { exit 1 }
try {
    $dm = $m::AllocHGlobal($bytes.Length)
    try {
        $m::Copy($bytes, 0, $dm, $bytes.Length)
        $pi = $m::AllocHGlobal($m::SizeOf([IntPtr]))
        try {
            $m::WriteIntPtr($pi, $dm)
            if (-not [WinPrintLoad]::SetPrinter($hP,9,$pi,0)) { exit 1 }
        } finally { $m::FreeHGlobal($pi) }
    } finally { $m::FreeHGlobal($dm) }
} finally { [WinPrintLoad]::ClosePrinter($hP) }
exit 0
`
}

// roll-profile-exists: 62mm siempre listo; dk1204 solo si tiene archivo guardado
ipcMain.handle('roll-profile-exists', (_, rollType) => {
  if (rollType === '62mm') return { exists: true }
  return { exists: fs.existsSync(getProfilePath(rollType)) }
})

// save-roll-profile:
//   dk1204 → Captura el DEVMODE actual SIN modificarlo.
//            IMPORTANTE: el usuario debe primero abrir Preferencias → seleccionar 54×17mm DK-1204
//            → cerrar → luego hacer clic en 💾. Así guardamos el DEVMODE con código DK-1204.
//   62mm   → no necesita guardar (se construye automático)
ipcMain.handle('save-roll-profile', (_, { rollType, printerName }) => {
  if (rollType !== 'dk1204') return { ok: true }
  const profileFile = getProfilePath(rollType)
  return runPs1(buildDK1204BypassScript(printerName, profileFile))
})

// load-roll-profile:
//   62mm   → construye DEVMODE por API (automático)
//   dk1204 → restaura binario guardado; si no existe → notSetup:true
ipcMain.handle('load-roll-profile', (_, { rollType, printerName }) => {
  if (rollType === '62mm') {
    return runPs1(buildDevModeScript(printerName, 620, 900))
  }
  const profileFile = getProfilePath(rollType)
  if (!fs.existsSync(profileFile)) return { ok: false, notSetup: true }
  return runPs1(buildLoadDevModeScript(printerName, profileFile))
})

ipcMain.handle('open-printer-props', (_, printerName) => {
  // /e abre directamente Preferencias de impresión (donde se elige el tipo de papel/rollo)
  exec(`rundll32 printui.dll,PrintUIEntry /e /n "${printerName}"`)
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

// ── GDI print directo para DK-1204 ───────────────────────────────────────────
// Bypasa completamente el pipeline de Electron/Chromium.
// CreateDC recibe nuestro DEVMODE directamente → el driver valida el código RFID
// del DEVMODE contra el cartucho físico → match → imprime a 54×17mm.
// El contenido proviene de una captura PNG del HTML renderizado.
// pageCount: número de etiquetas (slices verticales iguales en la imagen).
function buildGdiPrintScript(printerName, pngFile, devModeFile, pageCount) {
  const pn  = printerName.replace(/'/g, "''")
  const png = pngFile.replace(/\\/g, '\\\\').replace(/'/g, "''")
  const dmf = devModeFile.replace(/\\/g, '\\\\').replace(/'/g, "''")
  return `
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class GdiLabel {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    public struct DOCINFO {
        public int cbSize;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszDocName;
        public IntPtr lpszOutput;
        public IntPtr lpszDatatype;
        public int fwType;
    }
    [DllImport("gdi32.dll",CharSet=CharSet.Unicode)]
    public static extern IntPtr CreateDC(string drv,string dev,string port,IntPtr dm);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr h);
    [DllImport("gdi32.dll")] public static extern int StartDoc(IntPtr h,ref DOCINFO d);
    [DllImport("gdi32.dll")] public static extern int EndDoc(IntPtr h);
    [DllImport("gdi32.dll")] public static extern int StartPage(IntPtr h);
    [DllImport("gdi32.dll")] public static extern int EndPage(IntPtr h);
    [DllImport("gdi32.dll")] public static extern int GetDeviceCaps(IntPtr h,int c);
    [DllImport("gdi32.dll")] public static extern bool StretchBlt(
        IntPtr hdcDest,int xDest,int yDest,int wDest,int hDest,
        IntPtr hdcSrc, int xSrc, int ySrc, int wSrc, int hSrc, int rop);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr h);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr h);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr h,IntPtr o);
    [DllImport("kernel32.dll")] public static extern int GetLastError();
}
"@ -Language CSharp -ReferencedAssemblies "System.Drawing"
$m       = [Runtime.InteropServices.Marshal]
$SRCCOPY = 0x00CC0020
$pages   = ${pageCount}
Write-Output "GDI-PRINT impresora='${pn}' paginas=$pages"
$bytes   = [IO.File]::ReadAllBytes('${dmf}')
$dmPtr   = $m::AllocHGlobal($bytes.Length)
$m::Copy($bytes,0,$dmPtr,$bytes.Length)
try {
    $hDC = [GdiLabel]::CreateDC('WINSPOOL','${pn}',$null,$dmPtr)
    if ($hDC -eq [IntPtr]::Zero) {
        $err = [GdiLabel]::GetLastError()
        Write-Error "CreateDC fallo. Impresora='${pn}' Win32Error=$err"
        exit 1
    }
    Write-Output "CreateDC OK hDC=$hDC"
    try {
        $dpiX   = [GdiLabel]::GetDeviceCaps($hDC,88)
        $dpiY   = [GdiLabel]::GetDeviceCaps($hDC,90)
        $printW = [int](54.0/25.4*$dpiX)
        $printH = [int](17.0/25.4*$dpiY)
        Write-Output "DPI=$dpiX x $dpiY  printArea=$printW x $printH px"
        $full   = New-Object System.Drawing.Bitmap('${png}')
        Write-Output "PNG cargado: $($full.Width)x$($full.Height) px"
        $sliceH = [int]($full.Height / $pages)
        $di = New-Object GdiLabel+DOCINFO
        $di.cbSize       = $m::SizeOf([GdiLabel+DOCINFO])
        $di.lpszDocName  = 'VEREX Etiqueta'
        $di.lpszOutput   = [IntPtr]::Zero
        $di.lpszDatatype = [IntPtr]::Zero
        $docId = [GdiLabel]::StartDoc($hDC,[ref]$di)
        Write-Output "StartDoc=$docId"
        if ($docId -le 0) {
            $err = [GdiLabel]::GetLastError()
            Write-Error "StartDoc fallo Win32Error=$err"
            $full.Dispose(); exit 1
        }
        try {
            for ($i=0; $i -lt $pages; $i++) {
                $rect  = New-Object System.Drawing.Rectangle(0,($i*$sliceH),$full.Width,$sliceH)
                $slice = $full.Clone($rect,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                try {
                    $hBmp = $slice.GetHbitmap()
                    $mDC  = [GdiLabel]::CreateCompatibleDC($hDC)
                    $old  = [GdiLabel]::SelectObject($mDC,$hBmp)
                    $sp   = [GdiLabel]::StartPage($hDC)
                    $blt  = [GdiLabel]::StretchBlt($hDC,0,0,$printW,$printH,$mDC,0,0,$slice.Width,$slice.Height,$SRCCOPY)
                    $ep   = [GdiLabel]::EndPage($hDC)
                    Write-Output "Pagina $($i+1): StartPage=$sp StretchBlt=$blt EndPage=$ep"
                    [GdiLabel]::SelectObject($mDC,$old) | Out-Null
                    [GdiLabel]::DeleteObject($hBmp) | Out-Null
                    [GdiLabel]::DeleteDC($mDC) | Out-Null
                } finally { $slice.Dispose() }
            }
        } finally {
            $ed = [GdiLabel]::EndDoc($hDC)
            Write-Output "EndDoc=$ed"
        }
        $full.Dispose()
    } finally { [GdiLabel]::DeleteDC($hDC) | Out-Null }
} finally { $m::FreeHGlobal($dmPtr) }
exit 0
`
}

// ── Imprimir sin diálogo ──
// pageCount: número de etiquetas DK-1204 en el HTML (slices verticales iguales)
ipcMain.handle('print-content', async (event, { html, widthMm, heightMm, printerName, pageCount }) => {
  const PC = Math.max(1, parseInt(pageCount) || 1)

  // Dimensiones de ventana para DK-1204: offscreen rendering a 2× para mejor calidad
  // offscreen:true garantiza render real aunque la ventana esté oculta
  const LW = Math.round(54 * 96 / 25.4)   // 204px (54mm @ 96dpi)
  const LH = Math.round(17 * 96 / 25.4)   // 64px  (17mm @ 96dpi)
  const winW = widthMm === 0 ? LW  : 1100
  const winH = widthMm === 0 ? LH * PC : 750

  return new Promise((resolve) => {
    let settled = false
    const done = (val) => { if (!settled) { settled = true; resolve(val) } }
    // Timeout de seguridad: nunca dejar la UI colgada
    const guard = setTimeout(() => done({ success: false, error: 'Tiempo agotado — revisa la impresora' }), 50000)

    const tmpFile = path.join(os.tmpdir(), `verex-${Date.now()}.html`)
    fs.writeFileSync(tmpFile, html, 'utf8')

    const offscreen = widthMm === 0  // solo DK-1204 necesita offscreen
    const win = new BrowserWindow({
      show: false,
      width: winW,
      height: winH,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen,           // render real aunque window esté oculta
      },
    })

    win.loadFile(tmpFile)

    win.webContents.once('did-finish-load', async () => {
      // ── DK-1204: GDI directo (bypasa Electron print pipeline) ──
      if (widthMm === 0) {
        const profileFile = getProfilePath('dk1204')
        if (!fs.existsSync(profileFile)) {
          clearTimeout(guard)
          win.close(); fs.unlink(tmpFile, () => {})
          done({ success: false, error: 'Perfil DK-1204 no encontrado. Haz clic en 💎 DK-1204 → configura 54×17mm en Prefs → OK → haz clic en 💾' })
          return
        }
        try {
          // Con offscreen:true, capturePage() renderiza correctamente sin ventana visible
          await new Promise(r => setTimeout(r, 400))
          const img = await win.webContents.capturePage()
          clearTimeout(guard)
          win.close(); fs.unlink(tmpFile, () => {})
          if (!img || img.isEmpty()) {
            done({ success: false, error: 'Captura vacía — intenta de nuevo' }); return
          }
          const pngBuf = img.toPNG()
          // PNG de debug en escritorio para verificar contenido
          fs.writeFileSync(path.join(app.getPath('desktop'), 'verex-debug-label.png'), pngBuf)
          const tmpPng = path.join(os.tmpdir(), `verex-lbl-${Date.now()}.png`)
          fs.writeFileSync(tmpPng, pngBuf)
          const r = await runPs1(buildGdiPrintScript(printerName || '', tmpPng, profileFile, PC), 30000)
          fs.unlink(tmpPng, () => {})
          done({ success: r.ok, error: r.ok ? null : r.error, debug: r.out })
        } catch (e) {
          clearTimeout(guard)
          try { win.close() } catch (_) {}
          fs.unlink(tmpFile, () => {})
          done({ success: false, error: 'Captura: ' + e.message })
        }
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
        clearTimeout(guard)
        win.close(); fs.unlink(tmpFile, () => {})
        done({ success, error: errorType || null })
      })
    })
  })
})
