const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const http = require('http')
const net = require('net')
const { exec } = require('child_process')

let mainWindow
let tray = null

function createTrayIcon() {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    buf[i * 4]     = 0xC9  // R (gold)
    buf[i * 4 + 1] = 0xA8  // G
    buf[i * 4 + 2] = 0x4C  // B
    buf[i * 4 + 3] = 0xFF  // A
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function createTray() {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('VEREX Impresión · Activo')
  const menu = Menu.buildFromTemplate([
    { label: 'VEREX Impresión', enabled: false },
    { type: 'separator' },
    { label: '🖨️ Abrir ventana', click: () => { mainWindow.setSkipTaskbar(false); mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: 'Salir', click: () => { tray.destroy(); app.quit() } },
  ])
  tray.setContextMenu(menu)
  tray.on('double-click', () => { mainWindow.setSkipTaskbar(false); mainWindow.show(); mainWindow.focus() })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 860,
    minHeight: 600,
    title: 'VEREX – Impresión',
    backgroundColor: '#0e0e18',
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadFile('index.html')
  mainWindow.setMenuBarVisibility(false)

  // Al cerrar la ventana → ocultar a bandeja en lugar de cerrar
  mainWindow.on('close', (e) => {
    e.preventDefault()
    mainWindow.hide()
    mainWindow.setSkipTaskbar(true)
  })

  // Bloquear navegación al arrastrar archivos desde el Explorador de Windows
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') || !url.endsWith('index.html')) e.preventDefault()
  })
}

// Registrar protocolo verex:// para que el browser pueda abrir la app
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient('verex', process.execPath, [path.resolve(process.argv[1])])
} else {
  app.setAsDefaultProtocolClient('verex')
}

// Activar auto-inicio con Windows
app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false })

app.whenReady().then(() => {
  createWindow()
  createTray()
  startPrintServer()
})

// Si ya hay una instancia corriendo y el browser abre verex://, traer al frente
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// En Windows: segunda instancia por protocolo verex://
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Nunca cerrar la app al cerrar la ventana — vive en la bandeja del sistema
app.on('window-all-closed', () => {})

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

    // POST /imprimir — recibe { formato, rollo, pdf_base64, pageCount } desde consignación
    if (req.method === 'POST' && req.url === '/imprimir') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', async () => {
        try {
          const body   = JSON.parse(Buffer.concat(chunks).toString())
          const { formato, rollo, pdf_base64, pageCount } = body
          const pages  = parseInt(pageCount) || 1
          if (!pdf_base64) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'pdf_base64 vacío' }))
            return
          }

          // Dimensiones de captura según formato
          const isMini   = formato === 'mini'
          const isDK2214srv = formato === 'dk2214'
          const isLabel  = !['guia','recibo','mini','dk2214'].includes(formato)
          const widthMm  = isMini ? 29 : (isLabel ? 0 : 62)
          const heightMm = isMini ? 90.3 : (formato === 'guia' ? 90 : 0)

          const pdfPath = path.join(os.tmpdir(), `verex-print-${Date.now()}.pdf`)
          fs.writeFileSync(pdfPath, Buffer.from(pdf_base64, 'base64'))

          // HTML mínimo que carga el PDF con pdfjs y lo renderiza en canvas
          const pdfJsPath     = path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.min.js').replace(/\\/g, '/')
          const pdfWorkerPath = path.join(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.js').replace(/\\/g, '/')
          const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#fff">
<canvas id="c"></canvas>
<script src="file:///${pdfJsPath}"><\/script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='file:///${pdfWorkerPath}';
const url='file:///${pdfPath.replace(/\\/g,'/')}';
pdfjsLib.getDocument(url).promise.then(pdf=>{
  const total=pdf.numPages;
  Promise.all(Array.from({length:total},(_,i)=>pdf.getPage(i+1))).then(pgs=>{
    const vp=pgs[0].getViewport({scale:4});
    const W=Math.round(vp.width), H=Math.round(vp.height);
    const c=document.getElementById('c');
    c.width=W; c.height=H*total;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H*total);
    let done=0;
    pgs.forEach((pg,i)=>{
      const vp2=pg.getViewport({scale:4});
      ctx.save();
      ctx.translate(0, i*H);
      pg.render({canvasContext:ctx,viewport:vp2}).promise
        .then(()=>{ ctx.restore(); done++; if(done===total) document.title='READY'; });
    });
  });
});
<\/script></body></html>`

          const tmpHtml = path.join(os.tmpdir(), `verex-pdf-${Date.now()}.html`)
          fs.writeFileSync(tmpHtml, html, 'utf8')

          const result = await new Promise((resolve) => {
            let settled = false
            const done = v => { if (!settled) { settled = true; resolve(v) } }
            setTimeout(() => done({ success: false, error: 'Timeout renderizando PDF' }), 45000)

            const LW_CSS = Math.round(54 * 96 / 25.4), LH_CSS = Math.round(17 * 96 / 25.4), LSCALE = 4
            const GW_CSS = Math.round(62 * 96 / 25.4), GSCALE = 3
            const DK14W  = Math.round(50 * 96 / 25.4) * 4  // 756px — DK-2214 50mm @96dpi×4
            const DK14H  = Math.round(12 * 96 / 25.4) * 4  // 182px — DK-2214 12mm @96dpi×4
            const winW = isDK2214srv ? DK14W : (isLabel ? LW_CSS * LSCALE : Math.round(widthMm * 96 / 25.4) * GSCALE)
            const winH = isDK2214srv ? DK14H * pages : (isLabel ? LH_CSS * LSCALE * pages : (heightMm > 0 ? Math.round(heightMm * 96 / 25.4) * GSCALE : 4500))

            const win = new BrowserWindow({
              show: false, width: winW, height: winH,
              webPreferences: { nodeIntegration: false, contextIsolation: true, offscreen: true, webSecurity: false }
            })
            win.loadFile(tmpHtml)

            const checkReady = setInterval(async () => {
              try {
                const title = await win.webContents.getTitle()
                if (title !== 'READY') return
              } catch { return }
              clearInterval(checkReady)
              await new Promise(r => setTimeout(r, 300))

              try {
                const captureW = winW, captureH = isDK2214srv ? DK14H * pages : ((isLabel && !isMini) ? LH_CSS * LSCALE * pages : winH)
                const img = await win.webContents.capturePage({ x: 0, y: 0, width: captureW, height: captureH })
                win.close()
                fs.unlink(tmpHtml, () => {}); fs.unlink(pdfPath, () => {})
                if (!img || img.isEmpty()) { done({ success: false, error: 'Captura vacía' }); return }

                const pngBuf = img.toPNG()
                const tmpPng = path.join(os.tmpdir(), `verex-lbl-${Date.now()}.png`)
                fs.writeFileSync(tmpPng, pngBuf)
                fs.writeFileSync(path.join(app.getPath('desktop'), 'verex-debug-label.png'), pngBuf)

                const cfg = loadConfig()
                let printerIp = body.printerIp || cfg.printerIp
                if (!printerIp) {
                  // Auto-detectar impresora si no hay IP guardada
                  printerIp = await autoDiscoverPrinter()
                  if (printerIp) saveConfig({ printerIp })
                  else { done({ success: false, error: 'Impresora no encontrada. Verifica que esté encendida y en WiFi.' }); return }
                }
                // Si vino del browser, persistir para futuras impresiones
                if (body.printerIp && body.printerIp !== cfg.printerIp) saveConfig({ printerIp: body.printerIp })

                // Mapa rollo → label brother_ql
                const labelMap = {
                  'rojo':  '62red',
                  'mono':  '62',
                  'guia':  '62',
                  'recibo':'62',
                }
                // Dimensiones en pixels para canvas de 696px (px_mm = 696/62 = 11.226)
                // Valores replicados del sistema original sistema_impresion_verex.py
                const P = 696 / 62  // 11.226 px/mm
                const formatPx = {
                  'producto': { w: Math.round(54 * P), h: 117  },  // original: 606×117
                  'mini':     { w: 306, h: 991 },  // DK-11201 29×90mm: dots_printable exactos
                  'dk1204':   { w: Math.round(54 * P), h: Math.round(17 * P) }, // 606×191
                  'vertical': { w: Math.round(17 * P), h: Math.round(54 * P) }, // 191×606
                  'tarjeta':  { w: Math.round(25 * P), h: Math.round(15 * P) }, // 281×168
                  'guia':     { w: 696, h: 1063 },
                  'recibo':   { w: 696, h: 0    },
                  'etiqueta': { w: Math.round(54 * P), h: 117  },
                  'dk2214':   { w: 106, h: 591 },  // 12mm tape: 106 dots imprimibles, 50mm=591 líneas
                }
                // Algunos formatos tienen rollo fijo independiente del selector
                const formatLabelOverride = { 'mini': '29x90', 'dk2214': '12' }
                const labelId = formatLabelOverride[formato] || labelMap[rollo] || '62'
                const px = formatPx[formato] || { w: 696, h: 117 }
                const rotateDeg = formato === 'dk2214' ? 90 : 0
                const pyScript = path.join(__dirname, 'verex_print.py')
                const r = await new Promise(resolve => {
                  const cmd = `python "${pyScript}" --png "${tmpPng}" --ip "${printerIp}" --label "${labelId}" --target-w ${px.w} --target-h ${px.h} --rotate ${rotateDeg}`
                  exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
                    if (err) resolve({ ok: false, error: stderr || err.message })
                    else     resolve({ ok: true })
                  })
                })
                fs.unlink(tmpPng, () => {})
                done({ success: r.ok, error: r.ok ? null : r.error })
              } catch (e) {
                try { win.close() } catch {}
                done({ success: false, error: e.message })
              }
            }, 500)
          })

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: result.success, etiquetas: pages, error: result.error || null }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
      return
    }

    // GET /wifi — devuelve IP guardada
    if (req.method === 'GET' && req.url === '/wifi') {
      const cfg = loadConfig()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, ip: cfg.printerIp || null }))
      return
    }

    // POST /wifi — guarda IP { ip: "192.168.x.x" }
    if (req.method === 'POST' && req.url === '/wifi') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          saveConfig({ printerIp: body.ip ? body.ip.trim() : null })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
      return
    }

    // POST /wifi-test — prueba conexión { ip: "192.168.x.x" }
    // Intenta puerto 80 (web Brother, siempre activo) y 9100 (RAW print)
    if (req.method === 'POST' && req.url === '/wifi-test') {
      const chunks = []
      req.on('data', c => chunks.push(c))
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          const ip = body.ip
          let settled = false
          function ok80() {
            if (settled) return; settled = true
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, via: 'web' }))
          }
          function ok9100() {
            if (settled) return; settled = true
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, via: 'print' }))
          }
          function fail(msg) {
            if (settled) return; settled = true
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: msg }))
          }
          // HTTP GET puerto 80 (página web Brother — siempre disponible)
          const hreq = http.get({ hostname: ip, port: 80, path: '/', timeout: 3000 }, hres => {
            hres.destroy(); ok80()
          })
          hreq.on('error', () => {})
          hreq.on('timeout', () => { hreq.destroy() })
          // Puerto 9100 RAW (solo responde al imprimir, intento igual)
          const s9100 = net.createConnection({ host: ip, port: 9100, timeout: 3000 })
          s9100.on('connect', () => { s9100.destroy(); ok9100() })
          s9100.on('timeout', () => { s9100.destroy() })
          s9100.on('error', () => {})
          // Si ninguno responde en 4s → fallo
          setTimeout(() => fail('Sin respuesta — verifica que la impresora esté encendida y en WiFi'), 4000)
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: e.message }))
        }
      })
      return
    }

    // GET /wifi-discover — descubrimiento automático Brother via UDP broadcast puerto 54925
    if (req.method === 'GET' && req.url === '/wifi-discover') {
      const dgram = require('dgram')
      const found = new Set()
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      let settled = false
      function finish(ips) {
        if (settled) return; settled = true
        try { sock.close() } catch {}
        const list = Array.from(ips)
        // Auto-guardar la primera IP encontrada
        if (list.length > 0) saveConfig({ printerIp: list[0] })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, found: list, autoSaved: list.length > 0 }))
      }
      sock.on('message', (msg, rinfo) => {
        found.add(rinfo.address)
      })
      sock.on('error', () => finish(found))
      sock.bind(0, () => {
        sock.setBroadcast(true)
        // Probe de descubrimiento Brother QL/P-touch (puerto 54925)
        const probe = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])
        sock.send(probe, 54925, '255.255.255.255', () => {})
        setTimeout(() => finish(found), 3000)
      })
      return
    }

    // GET /wifi-scan — detecta Brother QL por ARP + HTTP/puerto 80 + puerto 9100
    if (req.method === 'GET' && req.url === '/wifi-scan') {
      const os2    = require('os')
      const dgram  = require('dgram')
      const candidates = new Set()

      // 1. ARP cache — dispositivos que el PC ya conoce (más rápido)
      try {
        const arpOut = exec('arp -a', { timeout: 3000 })
        // exec es async, usamos execSync aquí
      } catch {}
      try {
        const { execSync: es } = require('child_process')
        const arpOut = es('arp -a', { timeout: 3000 }).toString()
        for (const m of arpOut.matchAll(/(\d+\.\d+\.\d+\.\d+)/g)) {
          const ip = m[1]
          if (!ip.startsWith('224.') && !ip.startsWith('239.') &&
              ip !== '255.255.255.255' && !ip.startsWith('169.254.'))
            candidates.add(ip)
        }
      } catch {}

      // 2. Subnet propia /24
      for (const iface of Object.values(os2.networkInterfaces())) {
        for (const addr of iface) {
          if (addr.family === 'IPv4' && !addr.internal) {
            const parts = addr.address.split('.')
            const subnet = parts.slice(0, 3).join('.')
            for (let i = 1; i <= 254; i++) candidates.add(`${subnet}.${i}`)
          }
        }
      }

      const ips = Array.from(candidates)
      const found = new Set()
      if (ips.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, found: [] }))
        return
      }

      let pending = ips.length * 2
      let sent = false
      function finish() {
        if (--pending <= 0 && !sent) { sent = true; sendResult() }
      }
      function sendResult() {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, found: Array.from(found) }))
      }
      // Timeout máximo 8s por si algún IP congela
      setTimeout(() => { if (!sent) { sent = true; sendResult() } }, 8000)

      // Ruta A: TCP puerto 9100
      ips.forEach(ip => {
        let done = false
        function doneA() { if (!done) { done = true; finish() } }
        const s = net.createConnection({ host: ip, port: 9100, timeout: 700 })
        s.on('connect', () => { found.add(ip); s.destroy(); doneA() })
        s.on('timeout', () => { s.destroy(); doneA() })
        s.on('error', () => doneA())
      })

      // Ruta B: HTTP puerto 80 — Brother redirige a /home/status.html con "Brother" en el body
      ips.forEach(ip => {
        let done = false
        function doneB() { if (!done) { done = true; finish() } }
        function checkUrl(path) {
          const hreq = http.get({ hostname: ip, port: 80, path, timeout: 1500 }, hres => {
            // Si redirige → seguir redirect (Brother redirige a /home/status.html)
            if (hres.statusCode === 301 || hres.statusCode === 302) {
              const loc = hres.headers['location'] || ''
              hres.destroy()
              if (loc && !loc.startsWith('http') && loc !== path) {
                checkUrl(loc)  // seguir redirect interno
              } else {
                // Redirige a HTTPS u otra cosa → marcar como Brother igual (solo impresoras redirigen así)
                found.add(ip); doneB()
              }
              return
            }
            let body = ''; hres.setEncoding('utf8')
            hres.on('data', d => {
              body += d
              if (body.toLowerCase().includes('brother')) { found.add(ip); hres.destroy(); doneB() }
              else if (body.length > 4000) { hres.destroy(); doneB() }
            })
            hres.on('end', () => doneB())
            hres.on('close', () => doneB())
          })
          hreq.on('error', () => doneB())
          hreq.on('timeout', () => { hreq.destroy(); doneB() })
        }
        checkUrl('/')
      })
      return
    }

    // GET /wifi-autoconnect — descubre y guarda IP automáticamente (UDP + TCP)
    if (req.method === 'GET' && req.url === '/wifi-autoconnect') {
      autoDiscoverPrinter().then(ip => {
        if (ip) {
          saveConfig({ printerIp: ip })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, ip }))
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: 'Impresora no encontrada en la red' }))
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

// ── Auto-descubrimiento de impresora Brother QL ──────────────────────────────
// Intenta UDP broadcast (rápido 3s) → luego ARP+TCP scan (hasta 8s)
async function autoDiscoverPrinter() {
  // 1. UDP broadcast Brother (puerto 54925) — método más rápido
  const udpIp = await new Promise(resolve => {
    const dgram = require('dgram')
    const found = new Set()
    let settled = false
    function finish(ip) { if (!settled) { settled = true; resolve(ip || null) } }
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      sock.on('error', () => finish(null))
      sock.on('message', (msg, rinfo) => { found.add(rinfo.address) })
      sock.bind(() => {
        try { sock.setBroadcast(true) } catch {}
        const probe = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01])
        sock.send(probe, 54925, '255.255.255.255', () => {})
        setTimeout(() => { try { sock.close() } catch {}; finish([...found][0] || null) }, 3000)
      })
    } catch { finish(null) }
  })
  if (udpIp) return udpIp

  // 2. ARP cache + subnet /24 scan en puertos 9100 y 80 (hasta 8s)
  const { execSync: es } = require('child_process')
  const candidates = new Set()
  try {
    const arpOut = es('arp -a', { timeout: 3000 }).toString()
    for (const m of arpOut.matchAll(/(\d+\.\d+\.\d+\.\d+)/g)) {
      const ip = m[1]
      if (!ip.startsWith('224.') && !ip.startsWith('239.') &&
          ip !== '255.255.255.255' && !ip.startsWith('169.254.'))
        candidates.add(ip)
    }
  } catch {}
  const os3 = require('os')
  for (const iface of Object.values(os3.networkInterfaces())) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        const parts = addr.address.split('.')
        const subnet = parts.slice(0, 3).join('.')
        for (let i = 1; i <= 254; i++) candidates.add(`${subnet}.${i}`)
      }
    }
  }
  const ips = Array.from(candidates)
  if (!ips.length) return null

  return new Promise(resolve => {
    const found = new Set()
    let pending = ips.length * 2, sent = false
    function finish() { if (--pending <= 0 && !sent) { sent = true; resolve([...found][0] || null) } }
    setTimeout(() => { if (!sent) { sent = true; resolve([...found][0] || null) } }, 8000)
    ips.forEach(ip => {
      let d = false; function done() { if (!d) { d = true; finish() } }
      const s = net.createConnection({ host: ip, port: 9100, timeout: 700 })
      s.on('connect', () => { found.add(ip); s.destroy(); done() })
      s.on('timeout', () => { s.destroy(); done() })
      s.on('error', () => done())
    })
    ips.forEach(ip => {
      let d = false; function done() { if (!d) { d = true; finish() } }
      const hreq = http.get({ hostname: ip, port: 80, path: '/', timeout: 1500 }, hres => {
        let body = ''; hres.setEncoding('utf8')
        hres.on('data', c => { body += c; if (body.toLowerCase().includes('brother')) { found.add(ip); hres.destroy(); done() } else if (body.length > 2000) { hres.destroy(); done() } })
        hres.on('end', done); hres.on('close', done)
      })
      hreq.on('error', done); hreq.on('timeout', () => { hreq.destroy(); done() })
    })
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

// ── Config JSON (WiFi IP, etc.) ───────────────────────────────────────────────
function getConfigPath() {
  return path.join(app.getPath('userData'), 'verex-config.json')
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8')) } catch { return {} }
}
function saveConfig(obj) {
  const updated = { ...loadConfig(), ...obj }
  fs.writeFileSync(getConfigPath(), JSON.stringify(updated, null, 2), 'utf8')
}

// ── WiFi IPC handlers ─────────────────────────────────────────────────────────
ipcMain.handle('get-wifi-config', () => {
  const cfg = loadConfig()
  return { ip: cfg.printerIp || null }
})

ipcMain.handle('save-wifi-config', (_, { ip }) => {
  saveConfig({ printerIp: ip ? ip.trim() : null })
  return { ok: true }
})

ipcMain.handle('test-wifi-config', (_, { ip }) => {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: ip, port: 9100, timeout: 3000 })
    socket.on('connect', () => { socket.destroy(); resolve({ ok: true }) })
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, error: 'Sin respuesta (timeout)' }) })
    socket.on('error', (e) => { resolve({ ok: false, error: e.message }) })
  })
})

ipcMain.handle('scan-wifi-printers', async () => {
  // Escanea dispositivos del ARP cache + subnet propia buscando puerto 9100
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Net.Sockets;
using System.Collections.Generic;
using System.Threading.Tasks;
public class NetScan {
    public static List<string> Scan(string[] ips, int port, int ms) {
        var found = new List<string>();
        var tasks = new List<Task<string>>();
        foreach (var ip in ips) {
            var ipCopy = ip;
            tasks.Add(Task.Run(() => {
                try {
                    using (var c = new TcpClient()) {
                        if (c.ConnectAsync(ipCopy, port).Wait(ms)) return ipCopy;
                    }
                } catch {}
                return null;
            }));
        }
        Task.WaitAll(tasks.ToArray());
        foreach (var t in tasks) { if (t.Result != null) found.Add(t.Result); }
        return found;
    }
}
"@ -Language CSharp

$candidates = [System.Collections.Generic.HashSet[string]]::new()

# 1. ARP cache
$arpLines = arp -a
foreach ($line in $arpLines) {
    if ($line -match '\s+(\d+\.\d+\.\d+\.\d+)\s+') {
        $ip = $matches[1]
        if (-not ($ip -like '224.*' -or $ip -like '239.*' -or $ip -eq '255.255.255.255' -or $ip -like '169.254.*')) {
            [void]$candidates.Add($ip)
        }
    }
}

# 2. Subnet propia (primeros 254 hosts)
$localIps = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
    Where-Object { $_.AddressFamily -eq 'InterNetwork' }
foreach ($localIp in $localIps) {
    $parts = $localIp.ToString().Split('.')
    if ($parts.Length -eq 4) {
        $base = "$($parts[0]).$($parts[1]).$($parts[2])."
        1..254 | ForEach-Object { [void]$candidates.Add($base + $_) }
    }
}

$ips = @($candidates)
if ($ips.Count -eq 0) { Write-Output ""; exit 0 }
$found = [NetScan]::Scan($ips, 9100, 500)
if ($found.Count -gt 0) { $found -join ',' } else { Write-Output "" }
`
  const r = await runPs1(script, 45000)
  const ips = (r.ok && r.out) ? r.out.split(',').map(s => s.trim()).filter(Boolean) : []
  return { ok: r.ok, ips, error: r.error }
})

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
// Ruta 1 (WiFi): TCP directo port 9100  → sin driver, sin RFID
// Ruta 2 (USB) : CreateFile "\\.\USBxxx" → sin spooler, sin driver, sin RFID
// Nunca usa WritePrinter/spooler (ese camino bloquea por RFID DK-1201).
function buildRawPrintScript(printerName, pngFile, pageCount, forcedIp = null, printW = 638, printH = 201, headDots = 720, mediaWidthMm = 62) {
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
    // USB directo — bypasa spooler y driver completamente
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr CreateFile(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSec, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplate);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool WriteFile(IntPtr hFile, byte[] lpBuffer, uint nBytes,
        out uint lpWritten, IntPtr lpOverlapped);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern bool CloseHandle(IntPtr hFile);
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
        // Mini-job completo por etiqueta: init + config + raster + 0x1A
        // valid_flag=0x02 → valida solo tipo de media (no ancho) para aceptar cualquier rollo continuo
        int leftPad=(headDots-printW)/2, rowBytes=headDots/8;
        var o=new List<byte>();
        using(var src=new Bitmap(pngPath)) {
            int sliceH=src.Height/pages;
            for(int page=0;page<pages;page++) {
                o.AddRange(new byte[]{0x1B,0x40});
                o.AddRange(new byte[]{0x1B,0x69,0x61,0x01});
                // valid_flag=0x86: PI_RECOVER(0x80)+PI_WIDTH(0x04)+PI_TYPE(0x02)
                // Valor estándar en capturas reales de QL-810W — el firmware lo acepta sin error
                int rLines = printH;
                o.AddRange(new byte[]{0x1B,0x69,0x7A,
                    0x86, 0x0A, mediaWidthMm, 0,
                    (byte)(rLines&0xFF),(byte)((rLines>>8)&0xFF),(byte)((rLines>>16)&0xFF),(byte)((rLines>>24)&0xFF),
                    0, 0});
                o.AddRange(new byte[]{0x1B,0x69,0x4D,0x40});
                o.AddRange(new byte[]{0x1B,0x69,0x41,0x01});
                o.AddRange(new byte[]{0x1B,0x69,0x4B,0x08});
                o.AddRange(new byte[]{0x1B,0x69,0x64,0x00,0x00});
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
                            if(c.R*0.299+c.G*0.587+c.B*0.114<160) {
                                int pos=leftPad+x;
                                if(pos>=0&&pos<headDots) row[pos/8]|=(byte)(0x80>>(pos%8));
                            }
                        }
                        var cmp=PackBits(row);
                        o.Add(0x67); o.Add(0x00); o.Add((byte)cmp.Length);
                        o.AddRange(cmp);
                    }
                }
                o.Add(0x1A);  // continuo: corta exactamente al terminar los 201 dots (17mm)
            }
        }
        return o.ToArray();
    }
}
"@ -Language CSharp -ReferencedAssemblies "System.Drawing"

$pages = ${pageCount}
Write-Output "RAW-PRINT impresora='${pn}' paginas=$pages printW=${printW} printH=${printH}"
$rawData = [BrotherRaw]::MakeRaster('${png}',$pages,${printW},${printH},${headDots})
Write-Output "Raster: $($rawData.Length) bytes"

$sentOK = $false

# ── Ruta 1: TCP directo port 9100 (WiFi) ────────────────────────────────────
${forcedIp
    ? `$ip = '${forcedIp.replace(/'/g, "''")}'
Write-Output "IP configurada: $ip"`
    : `$ip = $null
$wmiPrinter = Get-WmiObject Win32_Printer -Filter "Name='${pn}'" -ErrorAction SilentlyContinue
if ($wmiPrinter) {
    $portName2 = $wmiPrinter.PortName
    $wmiPort = Get-WmiObject Win32_TCPIPPrinterPort -Filter "Name='$portName2'" -ErrorAction SilentlyContinue
    if ($wmiPort) { $ip = $wmiPort.HostAddress }
}
Write-Output "IP detectada: $ip"`
}

if ($ip) {
    Write-Output "TCP $ip:9100"
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect($ip, 9100)
        $ns = $tcp.GetStream()
        $ns.Write($rawData, 0, $rawData.Length)
        $ns.Flush()
        Start-Sleep -Milliseconds 2000
        $tcp.Close()
        Write-Output "TCP OK"
        $sentOK = $true
    } catch {
        Write-Output "TCP fallo: $_"
    }
}

# ── Ruta 2: USB directo via CreateFile (bypasa spooler y driver) ─────────────
if (-not $sentOK) {
    $wmiP = Get-WmiObject Win32_Printer -Filter "Name='${pn}'" -ErrorAction SilentlyContinue
    $usbPort = if ($wmiP) { $wmiP.PortName } else { $null }
    Write-Output "Puerto USB: $usbPort"

    if ($usbPort -and $usbPort -like 'USB*') {
        $devPath = "\\\\.\\" + $usbPort
        Write-Output "USB CreateFile: $devPath"
        $GENERIC_WRITE  = [uint32]0x40000000
        $FILE_SHARE_READ = [uint32]0x00000001
        $OPEN_EXISTING   = [uint32]3
        $FILE_ATTR_NORMAL = [uint32]0x80
        $h = [BrotherRaw]::CreateFile($devPath, $GENERIC_WRITE, $FILE_SHARE_READ,
                [IntPtr]::Zero, $OPEN_EXISTING, $FILE_ATTR_NORMAL, [IntPtr]::Zero)
        $INVALID = [IntPtr](-1)
        if ($h -eq $INVALID -or $h -eq [IntPtr]::Zero) {
            $err = [BrotherRaw]::GetLastError()
            Write-Error "CreateFile fallo en $devPath Win32=$err"
            exit 1
        }
        try {
            $written = [uint32]0
            $ok = [BrotherRaw]::WriteFile($h, $rawData, [uint32]$rawData.Length, [ref]$written, [IntPtr]::Zero)
            if ($ok) {
                Write-Output "USB OK written=$written"
                $sentOK = $true
            } else {
                $err = [BrotherRaw]::GetLastError()
                Write-Error "WriteFile fallo Win32=$err"
                exit 1
            }
        } finally {
            [BrotherRaw]::CloseHandle($h) | Out-Null
        }
    } else {
        Write-Error "Sin IP WiFi ni puerto USB disponible. Conecta la impresora o configura la IP en VEREX."
        exit 1
    }
}
exit 0
`
}

// ── Guías/Recibos 62mm: GDI via driver Brother QL ────────────────────────────
// Configura el DEVMODE (tamaño de papel) e imprime el PNG con PrintDocument.
// El driver sabe exactamente el formato RAW que espera la QL-810W — no hay
// que adivinar el protocolo raster. Solo para guías y recibos (62mm).
function buildGdiPrintScript(printerName, pngFile, widthTenths, heightTenths) {
  const pn  = printerName.replace(/'/g, "''")
  const png = pngFile.replace(/\\/g, '\\\\').replace(/'/g, "''")
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Printing;
using System.Drawing.Drawing2D;
public class GdiHelper {
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern bool OpenPrinter(string n,out IntPtr h,IntPtr d);
    [DllImport("winspool.drv",SetLastError=true)]
    static extern bool ClosePrinter(IntPtr h);
    [DllImport("winspool.drv",CharSet=CharSet.Unicode,SetLastError=true)]
    static extern int DocumentProperties(IntPtr hw,IntPtr hp,string dev,IntPtr dmOut,IntPtr dmIn,int fMode);
    [DllImport("winspool.drv",SetLastError=true)]
    static extern bool SetPrinter(IntPtr h,int level,IntPtr p,int cmd);
    public static void SetDevMode(string name,int wT,int hT) {
        var M=System.Runtime.InteropServices.Marshal;
        IntPtr hP=IntPtr.Zero;
        if(!OpenPrinter(name,out hP,IntPtr.Zero)) { Console.Error.WriteLine("OpenPrinter fallo"); return; }
        try {
            int sz=DocumentProperties(IntPtr.Zero,hP,name,IntPtr.Zero,IntPtr.Zero,0);
            if(sz<=0) { Console.Error.WriteLine("DocumentProperties fallo sz="+sz); return; }
            IntPtr dm=M.AllocHGlobal(sz);
            try {
                if(DocumentProperties(IntPtr.Zero,hP,name,dm,IntPtr.Zero,2)<=0) { Console.Error.WriteLine("DP lectura fallo"); return; }
                M.WriteInt32(dm,72,M.ReadInt32(dm,72)|14);
                M.WriteInt16(dm,78,256);
                M.WriteInt16(dm,80,(short)hT);
                M.WriteInt16(dm,82,(short)wT);
                IntPtr dm2=M.AllocHGlobal(sz);
                try {
                    if(DocumentProperties(IntPtr.Zero,hP,name,dm2,dm,10)>0) {
                        IntPtr pi=M.AllocHGlobal(IntPtr.Size);
                        try{M.WriteIntPtr(pi,dm2);SetPrinter(hP,9,pi,0);}
                        finally{M.FreeHGlobal(pi);}
                    }
                } finally{M.FreeHGlobal(dm2);}
            } finally{M.FreeHGlobal(dm);}
        } finally{ClosePrinter(hP);}
    }
    public static void Print(string name,string pngPath) {
        var pd=new PrintDocument();
        pd.PrinterSettings.PrinterName=name;
        pd.DefaultPageSettings.Margins=new Margins(0,0,0,0);
        using(var img=Image.FromFile(pngPath)) {
            pd.PrintPage+=(s,e)=>{
                e.Graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;
                e.Graphics.DrawImage(img,e.PageBounds);
                e.HasMorePages=false;
            };
            pd.Print();
        }
    }
}
"@ -Language CSharp -ReferencedAssemblies "System.Drawing"
$name='${pn}'; $png='${png}'; $wT=${widthTenths}; $hT=${heightTenths}
Write-Output "GDI-PRINT name='$name' wT=$wT hT=$hT"
[GdiHelper]::SetDevMode($name,$wT,$hT)
Start-Sleep -Milliseconds 500
[GdiHelper]::Print($name,$png)
Write-Output "GDI-PRINT OK"
`
}

// ── Imprimir sin diálogo ──
//   widthMm=0   → Etiquetas 54mm×17mm  → RAW TCP directo (bypasa driver), printW=638, printH=201
//   widthMm=62  → Guía/Recibo 62mm     → RAW TCP directo (bypasa GDI/spooler), printW=720, printH=dinámico
ipcMain.handle('print-content', async (event, { html, widthMm, heightMm, printerName, pageCount }) => {
  const PC = Math.max(1, parseInt(pageCount) || 1)

  // ── Constantes de renderizado ──────────────────────────────────────────────
  // Etiquetas: 54mm×17mm @96dpi×4 = 816×256px → C# escala a 638×201 dots (300dpi)
  const LW_CSS = Math.round(54 * 96 / 25.4)  // 204px virtual
  const LH_CSS = Math.round(17 * 96 / 25.4)  // 64px  virtual
  const LSCALE = 4
  const LWS    = LW_CSS * LSCALE              // 816px captura física
  const LHS    = LH_CSS * LSCALE              // 256px captura física

  // Guías/Recibos: 62mm @96dpi×3 = 702px → C# escala a 720 dots (300dpi)
  const GW_CSS = Math.round(62 * 96 / 25.4)  // 234px virtual
  const GSCALE = 3
  const GWS    = GW_CSS * GSCALE              // 702px captura física

  const isDK2214 = widthMm === -12
  const isLabel  = widthMm === 0
  const is62mm   = widthMm === 62

  // DK-2214: 50mm × 12mm cinta
  const DKW_CSS  = Math.round(50 * 96 / 25.4)  // 189px virtual
  const DKH_CSS  = Math.round(12 * 96 / 25.4)  // 45px  virtual
  const DKSCALE  = 4
  const DKWS     = DKW_CSS * DKSCALE            // 756px captura
  const DKHS     = DKH_CSS * DKSCALE            // 182px captura

  // Tamaño de ventana offscreen según módulo
  let winW, winH, zoomFactor
  if (isDK2214) {
    winW = DKWS; winH = DKHS * PC; zoomFactor = DKSCALE
  } else if (isLabel) {
    winW = LWS; winH = LHS * PC; zoomFactor = LSCALE
  } else if (is62mm) {
    winW = GWS
    winH = heightMm > 0
      ? Math.round(heightMm * 96 / 25.4) * GSCALE  // guía: fija
      : 4500                                         // recibo: generoso para cualquier largo
    zoomFactor = GSCALE
  } else {
    winW = 1100; winH = 750; zoomFactor = 1
  }

  return new Promise((resolve) => {
    let settled = false
    const done = (val) => { if (!settled) { settled = true; resolve(val) } }
    const guard = setTimeout(() => done({ success: false, error: 'Tiempo agotado — revisa la impresora' }), 60000)

    const tmpFile = path.join(os.tmpdir(), `verex-${Date.now()}.html`)
    fs.writeFileSync(tmpFile, html, 'utf8')

    const offscreen = isLabel || is62mm
    const win = new BrowserWindow({
      show: false,
      width: winW,
      height: winH,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen,
        zoomFactor: offscreen ? zoomFactor : 1,
      },
    })

    win.loadFile(tmpFile)

    win.webContents.once('did-finish-load', async () => {

      // ── Impresión: etiquetas (RAW TCP) + guías/recibos (GDI driver) ─────────
      if (isDK2214 || isLabel || is62mm) {
        try {
          let captureW, captureH, reciboCssPx = 0

          if (isDK2214) {
            // ── DK-2214: 50mm×12mm cinta — RAW TCP ──
            await win.webContents.insertCSS(
              'html,body{overflow:hidden!important;margin:0!important;padding:0!important;' +
              'width:50mm!important;height:' + (12 * PC) + 'mm!important;}'
            )
            await new Promise(r => setTimeout(r, 800))
            captureW = DKWS
            captureH = DKHS * PC

          } else if (isLabel) {
            // ── Etiquetas DK-2251: 54mm×17mm — RAW TCP ──
            await win.webContents.insertCSS(
              'html,body{overflow:hidden!important;margin:0!important;padding:0!important;' +
              'width:54mm!important;height:' + (17 * PC) + 'mm!important;}'
            )
            await new Promise(r => setTimeout(r, 800))
            captureW = LWS
            captureH = LHS * PC

          } else if (heightMm > 0) {
            // ── Guía de Envío: 62mm × 90mm — RAW TCP ──
            await win.webContents.insertCSS(
              'html,body{overflow:hidden!important;margin:0!important;padding:0!important;' +
              'width:62mm!important;height:' + heightMm + 'mm!important;}'
            )
            await new Promise(r => setTimeout(r, 1000))
            captureW = GWS
            captureH = Math.round(heightMm * 96 / 25.4) * GSCALE

          } else {
            // ── Recibo Térmico: 62mm × altura automática — RAW TCP ──
            await win.webContents.insertCSS(
              'html,body{overflow:hidden!important;margin:0!important;padding:0!important;' +
              'width:62mm!important;}'
            )
            await new Promise(r => setTimeout(r, 1000))
            reciboCssPx = await win.webContents.executeJavaScript('document.body.scrollHeight')
            captureH = Math.max(reciboCssPx, 100) * GSCALE
            captureW = GWS
          }

          const img = await win.webContents.capturePage({ x: 0, y: 0, width: captureW, height: captureH })
          clearTimeout(guard)
          win.close(); fs.unlink(tmpFile, () => {})

          if (!img || img.isEmpty()) {
            done({ success: false, error: 'Captura vacía — intenta de nuevo' }); return
          }

          const pngBuf = img.toPNG()
          const dbgName = isLabel ? 'verex-debug-label.png' : 'verex-debug-print.png'
          fs.writeFileSync(path.join(app.getPath('desktop'), dbgName), pngBuf)

          const tmpPng = path.join(os.tmpdir(), `verex-lbl-${Date.now()}.png`)
          fs.writeFileSync(tmpPng, pngBuf)

          let r
          if (isDK2214) {
            // DK-2214: cinta 12mm — 106 dots imprimibles, 591 líneas por 50mm
            const cfg = loadConfig()
            const DK_W = 106                              // 12mm @ 300dpi printable
            const DK_H = Math.round(50 * 300 / 25.4)     // 591 dots por etiqueta
            r = await runPs1(
              buildRawPrintScript(printerName || '', tmpPng, PC, cfg.printerIp || null, DK_W, DK_H * PC, 720, 12),
              35000
            )
          } else if (isLabel) {
            // Etiquetas: RAW TCP directo (bypasa driver — probado funcionando)
            const cfg = loadConfig()
            r = await runPs1(
              buildRawPrintScript(printerName || '', tmpPng, PC, cfg.printerIp || null, 638, 201, 720),
              35000
            )
          } else {
            // Guías/Recibos: RAW TCP 62mm — mismo protocolo que etiquetas, bypasa GDI/spooler
            // printW=720: rollo 62mm continuo usa el ancho completo del cabezal (720 dots)
            // printH: líneas raster exactas según contenido → corte limpio con 0x1A
            const cfg = loadConfig()
            // printW=696: área imprimible para 62mm continuo en QL-810W
            // (720 dots totales − 12 dots margen por lado = 696 dots imprimibles, leftPad=12)
            const printH62 = heightMm > 0
              ? Math.round(heightMm * 300 / 25.4)                 // guía: 90mm → 1063 líneas
              : Math.max(Math.round(reciboCssPx * 300 / 96), 300) // recibo: dinámico, mín ~30mm
            r = await runPs1(
              buildRawPrintScript(printerName || '', tmpPng, 1, cfg.printerIp || null, 696, printH62, 720),
              35000
            )
          }

          fs.unlink(tmpPng, () => {})
          done({ success: r.ok, error: r.ok ? null : r.error, debug: r.out })

        } catch (e) {
          clearTimeout(guard)
          try { win.close() } catch (_) {}
          fs.unlink(tmpFile, () => {})
          done({ success: false, error: 'Error RAW: ' + e.message })
        }
        return
      }

      // ── Fallback webContents.print() para tamaños no estándar ────────────
      try {
        await new Promise(r => setTimeout(r, 500))
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
      } catch (e) {
        clearTimeout(guard)
        try { win.close() } catch (_) {}
        fs.unlink(tmpFile, () => {})
        done({ success: false, error: 'Error impresión: ' + e.message })
      }
    })
  })
})
