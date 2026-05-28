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

// ── Brother QL RAW print — bypasa driver Y firmware RFID ─────────────────────
// Envía datos raster nativos Brother QL directamente via WritePrinter(RAW).
// valid_flag = 0x8C: width+length válidos, media_type NO válido → impresora
// NO verifica RFID. El trabajo nunca pasa por el driver de Brother.
// pageCount: etiquetas apiladas verticalmente en el PNG de entrada.
function buildRawPrintScript(printerName, pngFile, pageCount) {
  const pn  = printerName.replace(/'/g, "''")
  const png = pngFile.replace(/\\/g, '\\\\').replace(/'/g, "''")
  return `
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class BrotherRaw {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
    public struct DOC_INFO_1 {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        public IntPtr pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
    }
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr h,int level,ref DOC_INFO_1 di);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr h);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr h);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr h);
    [DllImport("winspool.drv",SetLastError=true)]
    public static extern bool WritePrinter(IntPtr h,IntPtr pBuf,int cbBuf,out int written);
    [DllImport("kernel32.dll")] public static extern int GetLastError();

    static byte[] PackBits(byte[] input) {
        var o = new List<byte>(); int i = 0;
        while (i < input.Length) {
            if (i+1 < input.Length && input[i] == input[i+1]) {
                int j=i; while (j<input.Length && j-i<128 && input[j]==input[i]) j++;
                o.Add((byte)(-(j-i-1)&0xFF)); o.Add(input[i]); i=j;
            } else {
                int j=i+1;
                while (j<input.Length && j-i<128 && !(j+1<input.Length && input[j]==input[j+1])) j++;
                o.Add((byte)(j-i-1)); for(int k=i;k<j;k++) o.Add(input[k]); i=j;
            }
        }
        return o.ToArray();
    }

    public static byte[] MakeRaster(string pngPath,int pages,int printW,int printH,int headDots) {
        int leftPad=(headDots-printW)/2, rowBytes=headDots/8;
        var o=new List<byte>();
        // Init + raster mode
        o.AddRange(new byte[]{0x1B,0x40,0x1B,0x69,0x61,0x01});
        // Print info: valid_flag=0x8C (width+length OK, media_type NOT set → no RFID check)
        var np=BitConverter.GetBytes((short)pages);
        o.AddRange(new byte[]{0x1B,0x69,0x7A, 0x8C,0x0B,54,17, np[0],np[1],0,0,0,0});
        // Mode: auto-cut ON (die-cut)
        o.AddRange(new byte[]{0x1B,0x69,0x4D,0x40});
        // Cut every 1 label
        o.AddRange(new byte[]{0x1B,0x69,0x41,0x01});
        // Expanded mode: cut at end
        o.AddRange(new byte[]{0x1B,0x69,0x4B,0x08});
        // Margins = 0
        o.AddRange(new byte[]{0x1B,0x69,0x64,0x00,0x00});

        using(var src=new Bitmap(pngPath)) {
            int sliceH=src.Height/pages;
            for(int page=0;page<pages;page++) {
                var rect=new Rectangle(0,page*sliceH,src.Width,sliceH);
                using(var slice=src.Clone(rect,PixelFormat.Format32bppArgb))
                using(var rsz=new Bitmap(printW,printH)) {
                    using(var g=Graphics.FromImage(rsz)) {
                        g.InterpolationMode=InterpolationMode.HighQualityBicubic;
                        g.DrawImage(slice,0,0,printW,printH);
                    }
                    for(int y=0;y<printH;y++) {
                        var row=new byte[rowBytes];
                        for(int x=0;x<printW;x++) {
                            var c=rsz.GetPixel(x,y);
                            if(c.R*0.299+c.G*0.587+c.B*0.114<128) {
                                int pos=leftPad+x;
                                if(pos>=0&&pos<headDots) row[pos/8]|=(byte)(0x80>>(pos%8));
                            }
                        }
                        var cmp=PackBits(row);
                        o.Add(0x67); o.Add(0x00); o.Add((byte)cmp.Length);
                        o.AddRange(cmp);
                    }
                }
                o.Add(0x0C); // print + cut
            }
        }
        o.Add(0x1A); // end
        return o.ToArray();
    }
}
"@ -Language CSharp -ReferencedAssemblies "System.Drawing"
$m = [Runtime.InteropServices.Marshal]
$pages = ${pageCount}
Write-Output "RAW-PRINT impresora='${pn}' paginas=$pages"
$rawData = [BrotherRaw]::MakeRaster('${png}',$pages,638,201,720)
Write-Output "Raster generado: $($rawData.Length) bytes"

# ── Intento 1: TCP directo al puerto 9100 (bypasea TODO: driver, port monitor, RFID) ──
$ip = $null
try {
    $printer = Get-WmiObject Win32_Printer | Where-Object { $_.Name -eq '${pn}' }
    if ($printer) {
        $port = Get-WmiObject Win32_TCPIPPrinterPort | Where-Object { $_.Name -eq $printer.PortName }
        if ($port -and $port.HostAddress) { $ip = $port.HostAddress }
    }
} catch {}

if ($ip) {
    Write-Output ("TCP directo a " + $ip + ":9100")
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect($ip, 9100)
        $stream = $tcp.GetStream()
        $stream.Write($rawData, 0, $rawData.Length)
        $stream.Flush()
        Start-Sleep -Milliseconds 3000
        $tcp.Close()
        Write-Output "TCP OK enviados=$($rawData.Length) bytes"
        exit 0
    } catch {
        Write-Output "TCP fallo: $_ — intentando WritePrinter..."
    }
} else {
    Write-Output "No se encontro IP TCP — usando WritePrinter RAW"
}

# ── Intento 2: WritePrinter RAW ──
$hP = [IntPtr]::Zero
if (-not [BrotherRaw]::OpenPrinter('${pn}',[ref]$hP,[IntPtr]::Zero)) {
    Write-Error "OpenPrinter fallo Win32=$([BrotherRaw]::GetLastError())"
    exit 1
}
Write-Output "OpenPrinter OK"
try {
    $di = New-Object BrotherRaw+DOC_INFO_1
    $di.pDocName  = 'VEREX RAW'
    $di.pOutputFile = [IntPtr]::Zero
    $di.pDatatype = 'RAW'
    $jobId = [BrotherRaw]::StartDocPrinter($hP,1,[ref]$di)
    Write-Output "StartDocPrinter jobId=$jobId"
    if ($jobId -le 0) {
        Write-Error "StartDocPrinter fallo Win32=$([BrotherRaw]::GetLastError())"
        exit 1
    }
    try {
        [BrotherRaw]::StartPagePrinter($hP) | Out-Null
        $buf = $m::AllocHGlobal($rawData.Length)
        try {
            $m::Copy($rawData,0,$buf,$rawData.Length)
            $written = 0
            $ok = [BrotherRaw]::WritePrinter($hP,$buf,$rawData.Length,[ref]$written)
            Write-Output "WritePrinter ok=$ok written=$written total=$($rawData.Length)"
        } finally { $m::FreeHGlobal($buf) }
        [BrotherRaw]::EndPagePrinter($hP) | Out-Null
    } finally { [BrotherRaw]::EndDocPrinter($hP) | Out-Null }
} finally { [BrotherRaw]::ClosePrinter($hP) | Out-Null }
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
      // ── DK-1204: RAW Brother QL raster (bypasa driver + RFID firmware) ──
      if (widthMm === 0) {
        try {
          // Eliminar scrollbars y forzar dimensiones exactas antes de capturar
          await win.webContents.insertCSS(
            'html,body{overflow:hidden!important;margin:0!important;padding:0!important;' +
            'width:54mm!important;height:' + (17 * PC) + 'mm!important;}'
          )
          await new Promise(r => setTimeout(r, 400))
          const img = await win.webContents.capturePage({
            x: 0, y: 0, width: LW, height: LH * PC,
          })
          clearTimeout(guard)
          win.close(); fs.unlink(tmpFile, () => {})
          if (!img || img.isEmpty()) {
            done({ success: false, error: 'Captura vacía — intenta de nuevo' }); return
          }
          const pngBuf = img.toPNG()
          fs.writeFileSync(path.join(app.getPath('desktop'), 'verex-debug-label.png'), pngBuf)
          const tmpPng = path.join(os.tmpdir(), `verex-lbl-${Date.now()}.png`)
          fs.writeFileSync(tmpPng, pngBuf)
          const r = await runPs1(buildRawPrintScript(printerName || '', tmpPng, PC), 35000)
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
