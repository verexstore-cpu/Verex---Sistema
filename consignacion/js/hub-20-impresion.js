// Hub VEREX — Cola de etiquetas e impresión directa (impresora WiFi)
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// ── COLA DE ETIQUETAS (sesión) ────────────────────────────────────────
let _colaEtiquetas = []; // [{codigo, qty}] acumulados durante la sesión

function ofrecerEtiquetaRapida(items) {
    // items puede ser string[] (legacy) o {codigo,qty}[]
    if (!items || !items.length) return;
    items.forEach(item => {
        const cod = typeof item === 'string' ? item : item.codigo;
        const qty = typeof item === 'string' ? 1 : (item.qty || 1);
        const existing = _colaEtiquetas.find(x => x.codigo === cod);
        if (existing) existing.qty += qty;
        else _colaEtiquetas.push({ codigo: cod, qty });
    });
    renderBotonCola();
}

function _expandirCola() {
    return _colaEtiquetas.flatMap(x => Array(x.qty).fill(x.codigo));
}

function renderBotonCola() {
    let btn = document.getElementById("btn-cola-etiquetas");
    if (!_colaEtiquetas.length) { if (btn) btn.remove(); return; }

    const n = _colaEtiquetas.reduce((s, x) => s + x.qty, 0);
    const multiplo6 = Math.floor(n / 6) * 6;
    const resto = n % 6;
    let subtexto = "";
    if (multiplo6 > 0 && resto > 0) subtexto = `<div style="font-size:10px;color:#888;margin-top:2px;">${multiplo6} completas + ${resto} pendiente${resto>1?"s":""}</div>`;
    else if (multiplo6 > 0) subtexto = `<div style="font-size:10px;color:#22c55e;margin-top:2px;">¡Listo para imprimir!</div>`;
    else subtexto = `<div style="font-size:10px;color:#888;margin-top:2px;">${6-resto} más para completar hoja</div>`;

    if (!btn) {
        btn = document.createElement("div");
        btn.id = "btn-cola-etiquetas";
        btn.style.cssText = `
            position:fixed; bottom:20px; right:20px; z-index:9998;
            background:#1a1a1a; border:1px solid #C9A84C; border-radius:14px;
            padding:10px 14px; box-shadow:0 4px 20px rgba(0,0,0,.7);
            animation: slideUpIn .25s ease; cursor:pointer; text-align:center;
            min-width:130px;
        `;
        document.body.appendChild(btn);
    }

    btn.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <button onclick="imprimirCola()" style="background:#C9A84C;color:#111;border:none;border-radius:8px;
                padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;flex:1;">
                🖨️ ${n} etiqueta${n>1?"s":""}
            </button>
            <button onclick="limpiarCola()" title="Limpiar cola"
                style="background:none;border:none;color:#555;font-size:16px;cursor:pointer;padding:0 2px;line-height:1;">×</button>
        </div>
        ${subtexto}
    `;
}

function limpiarCola() {
    _colaEtiquetas = [];
    const btn = document.getElementById("btn-cola-etiquetas");
    if (btn) btn.remove();
}

async function imprimirCola() {
    if (!_colaEtiquetas.length) return;
    // Verificar si el Print Server local está vivo
    let serverVivo = false;
    try {
        const res = await Promise.race([
            fetch('http://127.0.0.1:7891/ping'),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1200))
        ]);
        serverVivo = res.ok;
    } catch(e) { serverVivo = false; }

    if (serverVivo) {
        abrirModalImpresion();
        return;
    }

    // Sin servidor de impresión no se puede mandar directo a la Brother. Antes
    // se descargaba el PDF en silencio y encima se limpiaba la cola: el usuario
    // apretaba "imprimir", le aparecía una descarga sin explicación y perdía lo
    // que había cargado. Ahora se avisa qué pasó y se decide.
    const seguir = confirm(
        "No se puede imprimir directo: la app VEREX Impresión no está abierta.\n\n" +
        "Ábrela desde el Hub y volvé a intentar.\n\n" +
        "¿Preferís descargar el PDF de las etiquetas para imprimirlo a mano?"
    );
    if (!seguir) return;   // se conserva la cola para reintentar con el Hub abierto

    await generarEtiquetaRapida(_expandirCola());
    limpiarCola();
}

// ── MODAL DE IMPRESIÓN DIRECTA ────────────────────────────────────────────
let _formatoImpresion = localStorage.getItem('verex_formato_impresion') || 'mini';
let _rolloImpresion = localStorage.getItem('verex_rollo_impresion') || 'mono';

function abrirModalImpresion() {
    let m = document.getElementById('modal-print-server');
    if (!m) {
        m = document.createElement('div');
        m.id = 'modal-print-server';
        m.style.cssText = `
            position:fixed;inset:0;z-index:10000;
            background:rgba(0,0,0,0.82);display:flex;
            align-items:center;justify-content:center;
        `;
        m.innerHTML = `
            <div style="background:#111;border:1px solid #C9A84C;border-radius:16px;
                        padding:20px;width:680px;max-width:97vw;font-family:'DM Sans',sans-serif;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="color:#C9A84C;font-size:15px;font-weight:700;">🖨️ Imprimir etiquetas</span>
                    <button onclick="cerrarModalImpresion()" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;line-height:1;">×</button>
                </div>
                <div style="display:flex;gap:16px;">
                    <!-- Columna izquierda: formatos + rollo -->
                    <div style="flex:1;min-width:0;">
                        <p style="color:#ccc;font-size:11px;margin-bottom:8px;font-weight:600;">Formato:</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;" id="print-format-grid">
                            <button onclick="selFormatoImpresion('mini',this)"
                                style="background:#C9A84C;color:#111;border:none;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                📎 Mini (DK-2214)<br><span style="font-size:9px;font-weight:400;">2×1.2cm · cinta 12mm</span>
                            </button>
                            <button onclick="selFormatoImpresion('mini2',this)" title="Misma mini de 2×1.2cm pero dos por etiqueta DK-1204 — se recortan por las guías punteadas. Para cuando no hay cinta DK-2214."
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                ✂️ Mini ×2<br><span style="font-size:9px;font-weight:400;">2×1.2cm en DK-1204</span>
                            </button>
                            <button onclick="selFormatoImpresion('producto',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ Producto<br><span style="font-size:9px;font-weight:400;">5×1.5cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('dk1204',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ DK-1204<br><span style="font-size:9px;font-weight:400;">5.4×1.7cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('dk2214',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ DK-2214 Grande<br><span style="font-size:9px;font-weight:400;">5×1.2cm · mismo rollo</span>
                            </button>
                            <button onclick="selFormatoImpresion('producto-v',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ DK Vertical<br><span style="font-size:9px;font-weight:400;">1.7×5.4cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('tarjeta25',this)"
                                style="background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🏷️ Tarjeta<br><span style="font-size:9px;font-weight:400;">2.5×1.5cm</span>
                            </button>
                            <button onclick="selFormatoImpresion('recibo',this)" style="grid-column:span 3;
                                background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                                       padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                                🧾 Recibo &nbsp;·&nbsp; <span style="font-size:9px;font-weight:400;">62mm × dinámico</span>
                            </button>
                        </div>
                        <p style="color:#ccc;font-size:11px;margin-bottom:6px;font-weight:600;">🎞️ Rollo:</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;" id="print-rollo-grid">
                            <button onclick="selRolloImpresion('mono',this)"
                                style="background:#161616;color:#C9A84C;border:1px solid #C9A84C;border-radius:8px;
                                       padding:8px 4px;font-size:11px;font-weight:700;cursor:pointer;">
                                ⬜ Monocromo
                            </button>
                            <button onclick="selRolloImpresion('rojo',this)"
                                style="background:#161616;color:#666;border:1px solid #333;border-radius:8px;
                                       padding:8px 4px;font-size:11px;font-weight:700;cursor:pointer;">
                                🔴 Negro/Rojo
                            </button>
                        </div>
                    </div>
                    <!-- Columna derecha: preview + botones -->
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
                        <div id="print-preview-area" style="border-radius:8px;overflow:hidden;flex:1;margin-bottom:10px;min-height:80px;"></div>
                        <div id="print-server-status" style="font-size:11px;color:#888;margin-bottom:8px;min-height:14px;text-align:center;"></div>
                        <button onclick="enviarImpresionServidor()"
                            style="width:100%;background:linear-gradient(135deg,#C9A84C,#a87d20);
                                   color:#111;border:none;border-radius:10px;padding:12px;
                                   font-size:13px;font-weight:700;cursor:pointer;margin-bottom:6px;">
                            🖨️ Imprimir en Brother QL
                        </button>
                        <button onclick="descargarSoloPDF()"
                            style="width:100%;background:none;color:#666;border:1px solid #333;
                                   border-radius:10px;padding:8px;font-size:11px;cursor:pointer;">
                            ⬇️ Solo descargar PDF
                        </button>
                        <button onclick="reconectarImpresora()"
                            style="width:100%;background:none;color:#888;border:1px solid #333;
                                   border-radius:10px;padding:7px;font-size:11px;cursor:pointer;margin-top:5px;">
                            🔄 Reconectar impresora
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(m);
    }
    m.style.display = 'flex';
    // Restaurar formato persistido (o mini por defecto)
    _formatoImpresion = localStorage.getItem('verex_formato_impresion') || 'mini';
    document.querySelectorAll('#print-format-grid button').forEach(b => {
        const fmt = (b.getAttribute('onclick') || '').match(/'([^']+)'/)?.[1];
        const activo = (fmt === _formatoImpresion);
        b.style.background = activo ? '#C9A84C' : '#222';
        b.style.color      = activo ? '#111'    : '#aaa';
        b.style.border     = activo ? 'none'    : '1px solid #333';
    });
    // Aplicar selección de rollo persistida
    document.querySelectorAll('#print-rollo-grid button').forEach((b, i) => {
        const esRollo = (i === 0 ? 'mono' : 'rojo');
        const activo = (esRollo === _rolloImpresion);
        const colorOn = (esRollo === 'rojo') ? '#ef4444' : '#C9A84C';
        b.style.background = activo ? (esRollo === 'rojo' ? 'rgba(239,68,68,.1)' : 'rgba(201,168,76,.1)') : '#161616';
        b.style.color      = activo ? colorOn : '#666';
        b.style.border     = '1px solid ' + (activo ? colorOn : '#333');
    });
    document.getElementById('print-server-status').textContent = '';
    setTimeout(actualizarPreviewImpresion, 50);
    // Auto-detectar impresora en background al abrir el modal
    _autoDetectarImpresora();
}

async function _autoDetectarImpresora() {
    const status = document.getElementById('print-server-status');
    // Si ya tenemos IP no hacer nada
    if (localStorage.getItem('verex_wifi_ip')) return;
    try {
        status.textContent = '🔍 Buscando impresora...';
        status.style.color = '#C9A84C';
        const res = await fetch(PRINT_SERVER + '/wifi-autoconnect', { signal: AbortSignal.timeout(12000) });
        const data = await res.json();
        if (data.ok && data.ip) {
            localStorage.setItem('verex_wifi_ip', data.ip);
            status.textContent = '✅ Impresora encontrada: ' + data.ip;
            status.style.color = '#22c55e';
            setTimeout(() => { if (status.textContent.includes('encontrada')) status.textContent = ''; }, 3000);
        } else {
            status.textContent = '⚠️ Impresora no encontrada en la red';
            status.style.color = '#ef4444';
        }
    } catch {
        // Servidor no disponible — silencioso
        status.textContent = '';
    }
}

function selRolloImpresion(rollo, btn) {
    _rolloImpresion = rollo;
    localStorage.setItem('verex_rollo_impresion', rollo);
    document.querySelectorAll('#print-rollo-grid button').forEach(b => {
        b.style.background = '#161616';
        b.style.color      = '#666';
        b.style.border     = '1px solid #333';
    });
    const esRojo = (rollo === 'rojo');
    btn.style.background = esRojo ? 'rgba(239,68,68,.1)' : 'rgba(201,168,76,.1)';
    btn.style.color      = esRojo ? '#ef4444' : '#C9A84C';
    btn.style.border     = '1px solid ' + (esRojo ? '#ef4444' : '#C9A84C');
}

function cerrarModalImpresion() {
    const m = document.getElementById('modal-print-server');
    if (!m) return;
    if (typeof m._onclose === 'function') { m._onclose(); m._onclose = null; }
    m.style.display = 'none';
}

const PRINT_SERVER = 'http://127.0.0.1:7891';

async function abrirWifiDesdeModal() {
    const panel = document.getElementById('wifi-consig-panel');
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const status = document.getElementById('wifi-consig-status');
    document.getElementById('wifi-consig-candidates').style.display = 'none';

    // Restaurar IP guardada localmente (siempre disponible aunque el server no esté)
    const ipLocal = localStorage.getItem('verex_wifi_ip');
    if (ipLocal) {
        document.getElementById('wifi-consig-ip').value = ipLocal;
        status.textContent = '⏳ Aplicando IP guardada...';
        status.style.color = '#C9A84C';
    }

    try {
        const res = await fetch(PRINT_SERVER + '/wifi', { signal: AbortSignal.timeout(2000) });
        const data = await res.json();
        const ipServidor = data.ip || ipLocal;
        if (ipServidor) {
            document.getElementById('wifi-consig-ip').value = ipServidor;
            localStorage.setItem('verex_wifi_ip', ipServidor);
            status.textContent = '✅ IP activa: ' + ipServidor;
            status.style.color = '#22c55e';
            // Sincronizar IP local al servidor si el servidor no la tenía
            if (!data.ip && ipLocal) {
                fetch(PRINT_SERVER + '/wifi', {
                    method: 'POST', body: JSON.stringify({ ip: ipLocal }),
                    headers: { 'Content-Type': 'application/json' }
                }).catch(() => {});
            }
        } else {
            wifiConsigAutoDescubrir();
        }
    } catch {
        if (ipLocal) {
            // Servidor no responde pero tenemos IP guardada — intentar abrirlo y aplicar
            status.textContent = '⏳ Iniciando app con IP: ' + ipLocal + '...';
            status.style.color = '#C9A84C';
            window.open('verex://open', '_self');
            let intentos = 0;
            const timer = setInterval(async () => {
                intentos++;
                try {
                    await fetch(PRINT_SERVER + '/wifi', {
                        method: 'POST', body: JSON.stringify({ ip: ipLocal }),
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(1500)
                    });
                    clearInterval(timer);
                    status.textContent = '✅ IP aplicada: ' + ipLocal;
                    status.style.color = '#22c55e';
                } catch {
                    if (intentos >= 8) {
                        clearInterval(timer);
                        status.textContent = 'App no disponible. IP guardada: ' + ipLocal;
                        status.style.color = '#888';
                    }
                }
            }, 2000);
        } else {
            status.textContent = '⏳ Abriendo app de impresión...';
            status.style.color = '#C9A84C';
            window.open('verex://open', '_self');
            let intentos = 0;
            const timer = setInterval(async () => {
                intentos++;
                try {
                    const r = await fetch(PRINT_SERVER + '/wifi', { signal: AbortSignal.timeout(1500) });
                    const d = await r.json();
                    clearInterval(timer);
                    if (d.ip) {
                        document.getElementById('wifi-consig-ip').value = d.ip;
                        localStorage.setItem('verex_wifi_ip', d.ip);
                        status.textContent = '✅ IP guardada: ' + d.ip;
                        status.style.color = '#22c55e';
                    } else {
                        wifiConsigAutoDescubrir();
                    }
                } catch {
                    if (intentos >= 8) {
                        clearInterval(timer);
                        status.textContent = 'No se pudo abrir la app. Ábrela manualmente.';
                        status.style.color = '#ef4444';
                    }
                }
            }, 2000);
        }
    }
}

async function wifiConsigAutoDescubrir() {
    const status = document.getElementById('wifi-consig-status');
    const btn = document.getElementById('btn-wifi-consig');
    status.textContent = '🔍 Buscando impresora automáticamente...';
    status.style.color = '#C9A84C';
    try {
        const res = await fetch(PRINT_SERVER + '/wifi-discover');
        const data = await res.json();
        if (data.found && data.found.length > 0) {
            const ip = data.found[0];
            document.getElementById('wifi-consig-ip').value = ip;
            status.textContent = '✅ Impresora encontrada y guardada: ' + ip;
            status.style.color = '#22c55e';
            btn.style.borderColor = '#22c55e';
            btn.style.color = '#22c55e';
        } else {
            // Fallback al escaneo completo
            status.textContent = '🔍 Escaneando red...';
            await wifiConsigScan();
        }
    } catch {
        status.textContent = 'No se pudo detectar la impresora';
        status.style.color = '#ef4444';
    }
}

async function wifiConsigScan() {
    const btn = document.getElementById('btn-wifi-consig-scan');
    const status = document.getElementById('wifi-consig-status');
    const cands = document.getElementById('wifi-consig-candidates');
    btn.textContent = '⏳ Buscando...';
    btn.disabled = true;
    status.textContent = 'Escaneando red, puede tardar ~20s...';
    status.style.color = '#C9A84C';
    cands.style.display = 'none';
    try {
        const res = await fetch(PRINT_SERVER + '/wifi-scan');
        const data = await res.json();
        if (data.found && data.found.length > 0) {
            cands.style.display = 'block';
            cands.innerHTML = data.found.map(ip =>
                `<div onclick="document.getElementById('wifi-consig-ip').value='${ip}';document.getElementById('wifi-consig-candidates').style.display='none';"
                    style="background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:7px 10px;
                           font-size:12px;color:#C9A84C;cursor:pointer;margin-bottom:4px;">
                    🖨️ ${ip}
                </div>`
            ).join('');
            status.textContent = `${data.found.length} impresora(s) encontrada(s)`;
            status.style.color = '#22c55e';
        } else {
            status.textContent = 'No se encontraron impresoras en la red';
            status.style.color = '#ef4444';
        }
    } catch {
        status.textContent = 'App de impresión no está abierta';
        status.style.color = '#ef4444';
    }
    btn.textContent = '🔍 Buscar';
    btn.disabled = false;
}

async function wifiConsigTest() {
    const ip = document.getElementById('wifi-consig-ip').value.trim();
    const status = document.getElementById('wifi-consig-status');
    if (!ip) { status.textContent = 'Ingresa una IP primero'; status.style.color = '#ef4444'; return; }
    status.textContent = 'Probando conexión...';
    status.style.color = '#C9A84C';
    try {
        const res = await fetch(PRINT_SERVER + '/wifi-test', {
            method: 'POST', body: JSON.stringify({ ip }),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.ok) {
            status.textContent = '✅ Conexión exitosa';
            status.style.color = '#22c55e';
        } else {
            status.textContent = '❌ ' + (data.error || 'Sin respuesta');
            status.style.color = '#ef4444';
        }
    } catch {
        status.textContent = 'App de impresión no está abierta';
        status.style.color = '#ef4444';
    }
}

async function wifiConsigSave() {
    const ip = document.getElementById('wifi-consig-ip').value.trim();
    const status = document.getElementById('wifi-consig-status');
    if (!ip) { status.textContent = 'Ingresa una IP primero'; status.style.color = '#ef4444'; return; }
    try {
        const res = await fetch(PRINT_SERVER + '/wifi', {
            method: 'POST', body: JSON.stringify({ ip }),
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.ok) {
            localStorage.setItem('verex_wifi_ip', ip);
            status.textContent = '✅ IP guardada — la app imprimirá por WiFi';
            status.style.color = '#22c55e';
            const btn = document.getElementById('btn-wifi-consig');
            btn.style.borderColor = '#22c55e';
            btn.style.color = '#22c55e';
        } else {
            status.textContent = '❌ No se pudo guardar';
            status.style.color = '#ef4444';
        }
    } catch {
        status.textContent = 'App de impresión no está abierta';
        status.style.color = '#ef4444';
    }
}

function selFormatoImpresion(fmt, btn) {
    _formatoImpresion = fmt;
    localStorage.setItem('verex_formato_impresion', fmt);
    document.querySelectorAll('#print-format-grid button').forEach(b => {
        b.style.background = '#222';
        b.style.color      = '#aaa';
        b.style.border     = '1px solid #333';
    });
    btn.style.background = '#C9A84C';
    btn.style.color      = '#111';
    btn.style.border     = 'none';
    actualizarPreviewImpresion();
}

async function actualizarPreviewImpresion() {
    const area = document.getElementById('print-preview-area');
    if (!area) return;
    area.innerHTML = '<p style="color:#555;font-size:11px;text-align:center;padding:8px;">Generando vista previa…</p>';
    try {
        const codigos = _expandirCola();
        if (!codigos.length) { area.innerHTML = ''; return; }
        const pdfBase64 = await generarPDFParaServidor(codigos, _formatoImpresion);
        if (!pdfBase64) { area.innerHTML = ''; return; }
        area.innerHTML = `
            <p style="color:#666;font-size:10px;text-align:center;margin-bottom:4px;">Vista previa</p>
            <iframe src="data:application/pdf;base64,${pdfBase64}"
                style="width:100%;height:130px;border:1px solid #333;border-radius:6px;background:#fff;"
                scrolling="no"></iframe>`;
    } catch(e) {
        area.innerHTML = '<p style="color:#444;font-size:11px;text-align:center;padding:8px;">Vista previa no disponible</p>';
    }
}

async function reconectarImpresora() {
    const st = document.getElementById('print-server-status');
    if (st) st.innerHTML = '<span style="color:#C9A84C;">Buscando impresora...</span>';
    try {
        const r = await fetch('http://127.0.0.1:7891/wifi-autoconnect', { signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (d.ok && d.ip) {
            localStorage.setItem('verex_wifi_ip', d.ip);
            if (st) st.innerHTML = `<span style="color:#4caf50;">✓ Conectado: ${d.ip}</span>`;
        } else {
            if (st) st.innerHTML = '<span style="color:#e57373;">No se encontró la impresora. Verifica que esté encendida y en WiFi.</span>';
        }
    } catch(e) {
        if (st) st.innerHTML = '<span style="color:#e57373;">Servidor no disponible. Abre el servidor de impresión.</span>';
    }
}

async function enviarImpresionServidor() {
    const status = document.getElementById('print-server-status');
    status.style.color = '#C9A84C';
    status.textContent = '⏳ Generando PDF…';

    const codigos = _expandirCola();

    // 'mini2' arma un PDF de 54×17mm con DOS mini por página, así que:
    //  · a la impresora se le manda 'dk1204', que es el tamaño real del papel
    //    (el servidor no conoce 'mini2' y caería en un formato por defecto)
    //  · pageCount es la mitad — el Hub lo usa para calcular la altura de
    //    captura del PDF, y con el número equivocado sale cortado.
    const esMini2 = _formatoImpresion === 'mini2';
    const formatoImpresora = esMini2 ? 'dk1204' : _formatoImpresion;
    const pageCount = esMini2 ? Math.ceil(codigos.length / 2) : codigos.length;

    // 'mini' (DK-2214, cinta continua) tiene alto variable (px.h=0 en el Hub),
    // así que por defecto el Hub lo trata como tira continua sin cortes entre
    // páginas — correcto para una nota larga, pero al imprimir VARIOS códigos
    // de producto aplasta todos los QR en una sola etiqueta en vez de cortar
    // una por producto. separar:true fuerza al Hub a partir el PNG apilado y
    // cortar una etiqueta física por código, igual que ya hace la nota libre.
    const separarMini = _formatoImpresion === 'mini' && codigos.length > 1;

    let pdfBase64 = null;
    try {
        pdfBase64 = await generarPDFParaServidor(codigos, _formatoImpresion);
    } catch(err) {
        status.style.color = '#ef4444';
        status.textContent = '⚠️ Error PDF: ' + (err.message || err);
        return;
    }
    if (!pdfBase64) { status.style.color='#ef4444'; status.textContent='⚠️ Error generando PDF (null)'; return; }

    // Intentar servidor Electron (7891) — si no está, imprimir directo desde el navegador
    let serverVivo = false;
    try {
        const ping = await fetch(PRINT_SERVER + '/ping', { signal: AbortSignal.timeout(3000) });
        serverVivo = ping.ok;
    } catch {}

    if (serverVivo) {
        status.textContent = '📡 Enviando a impresora…';
        try {
            const res = await fetch(PRINT_SERVER + '/imprimir', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ formato: formatoImpresora, rollo: _rolloImpresion, pdf_base64: pdfBase64, pageCount, separar: separarMini, printerIp: localStorage.getItem('verex_wifi_ip') || undefined })
            });
            const json = await res.json();
            if (json.ok) {
                status.style.color = '#22c55e';
                status.textContent = `✅ ${json.etiquetas} etiqueta(s) enviadas a Brother QL`;
                if (_codigosImpresionRapida) { _codigosImpresionRapida.forEach(c => marcarEtiquetaImpresa(c)); _codigosImpresionRapida = null; }
                setTimeout(() => { cerrarModalImpresion(); limpiarCola(); renderStock(stockData); }, 1800);
            } else {
                const errMsg = (json.error || 'Error en impresora');
                // Traducir errores técnicos que el Hub no filtró
                const errLimpio = /WinError 10061|ConnectionRefused/i.test(errMsg)
                    ? 'Impresora apagada o fuera del WiFi — enciéndela e intentá de nuevo'
                    : /WinError 10060|timed out/i.test(errMsg)
                    ? 'Impresora no responde — verificá que esté encendida'
                    : /deprecat/i.test(errMsg)
                    ? errMsg.replace(/deprecation warning[^\n]*\n?/gi, '').trim() || 'Error en impresora'
                    : errMsg;
                status.style.color = '#ef4444';
                status.textContent = '⚠️ ' + errLimpio;
            }
        } catch(e) {
            status.style.color = '#ef4444';
            status.textContent = '⚠️ Error al enviar al servidor';
        }
    } else {
        // Imprimir directo desde el navegador sin app externa
        imprimirPDFNavegador(pdfBase64, pageCount);
        status.style.color = '#22c55e';
        status.textContent = '✅ Abriendo diálogo de impresión…';
        setTimeout(() => { cerrarModalImpresion(); limpiarCola(); }, 1200);
    }
}

function imprimirPDFNavegador(pdfBase64, pageCount) {
    // Dimensiones según formato (en mm)
    const dims = {
        mini:        { w: 20,   h: 12  },
        mini2:       { w: 47.92, h: 13.97 },  // area imprimible del troquel DK-1204
        dk2214:      { w: 50,   h: 12  },
        producto:    { w: 54,   h: 15  },
        'dk1204':    { w: 54,   h: 17  },
        'producto-v':{ w: 17,   h: 54  },
        tarjeta25:   { w: 50,   h: 15  },
        guia:        { w: 62,   h: 90  },
        recibo:      { w: 62,   h: 0   },
    };
    const d = dims[_formatoImpresion] || { w: 54, h: 15 };
    const orient = (d.w > d.h) ? 'landscape' : 'portrait';
    const cssSize = d.h > 0 ? `${d.w}mm ${d.h}mm` : `${d.w}mm auto`;

    const html = `<!DOCTYPE html><html><head>
<style>
  @page { size: ${cssSize} ${orient}; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; }
  embed { display: block; width: 100vw; height: 100vh; }
</style>
</head><body>
<embed src="data:application/pdf;base64,${pdfBase64}" type="application/pdf" width="100%" height="100%">
<script>
  window.onload = function() {
    // Dar tiempo a que el PDF renderice antes de imprimir
    setTimeout(function() { window.print(); }, 800);
  };
<\/script>
</body></html>`;

    const w = window.open('', '_blank', `width=${Math.round(d.w * 3.78)},height=${Math.round((d.h || 300) * 3.78 * pageCount)}`);
    if (w) { w.document.write(html); w.document.close(); }
}

async function descargarSoloPDF() {
    const codigos = [..._colaEtiquetas];
    cerrarModalImpresion();
    await generarEtiquetaRapida(codigos);
    limpiarCola();
}

// ═══════════════════════════════════════════════════════════════════════
