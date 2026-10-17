// Hub VEREX — Nota / texto libre para imprimir
// Movido tal cual (antes en js/hub-01..07.js, partidos por tamaño). Script normal: funciones
// globales que el HTML llama por nombre. El orden de carga está en index.html (ver js/README.md).
// NOTA / TEXTO LIBRE — herramienta aparte para imprimir cualquier texto
// (ej. una nota para meter en el paquete de envío) en el rollo que esté
// puesto en ese momento en la Brother QL. Independiente del flujo de
// etiquetas de producto.
// ═══════════════════════════════════════════════════════════════════════
let _notaFormato = localStorage.getItem('verex_nota_formato') || 'producto';

// Escala manual del texto de la nota. El tamaño se sigue calculando solo para
// que el texto entre en la etiqueta, pero esto lo multiplica: sirve para pedir
// letra más grande en notas cortas (donde el automático se queda corto por el
// tope de 14pt) o más chica cuando se quiere que quede discreta.
// El auto-ajuste se mantiene SIEMPRE como tope, así nunca se desborda.
let _notaEscala = parseFloat(localStorage.getItem('verex_nota_escala')) || 1;

// Cuántas copias iguales imprimir de una sola vez. Se arma un PDF con una
// página por copia y se le pide al servidor que las separe en etiquetas
// distintas, en vez de mandar la misma nota N veces a mano.
let _notaCopias = parseInt(localStorage.getItem('verex_nota_copias')) || 1;

const NOTA_DIMS = {
    mini:         { w: 20, h: 12, label: '📎 Mini',       sub: '2×1.2cm · cinta' },
    producto:     { w: 54, h: 15, label: '🏷️ Producto',   sub: '5×1.5cm' },
    dk1204:       { w: 54, h: 17, label: '🏷️ DK-1204',    sub: '5.4×1.7cm' },
    dk2214:       { w: 50, h: 12, label: '🏷️ DK-2214',    sub: '5×1.2cm cinta' },
    'producto-v': { w: 17, h: 54, label: '🏷️ DK Vertical', sub: '1.7×5.4cm' },
    tarjeta25:    { w: 50, h: 15, label: '🏷️ Tarjeta',    sub: '2.5×1.5cm' },
    grande:       { w: 62, h: 90, label: '📦 Grande',     sub: '6.2×9cm · envíos' },
};

function abrirModalNota() {
    let m = document.getElementById('modal-nota-imprimir');
    if (!m) {
        m = document.createElement('div');
        m.id = 'modal-nota-imprimir';
        m.style.cssText = `
            position:fixed;inset:0;z-index:10000;
            background:rgba(0,0,0,0.82);display:flex;
            align-items:center;justify-content:center;
        `;
        const botonesFormato = Object.keys(NOTA_DIMS).map(fmt => {
            const d = NOTA_DIMS[fmt];
            const span = fmt === 'grande' ? 'grid-column:span 3;' : '';
            return `<button onclick="selFormatoNota('${fmt}',this)" data-fmt="${fmt}" style="${span}
                background:#222;color:#aaa;border:1px solid #333;border-radius:8px;
                padding:9px 4px;font-size:11px;font-weight:700;cursor:pointer;line-height:1.3;">
                ${d.label}<br><span style="font-size:9px;font-weight:400;">${d.sub}</span>
            </button>`;
        }).join('');
        m.innerHTML = `
            <div style="background:#111;border:1px solid #7a4ad4;border-radius:16px;
                        padding:20px;width:680px;max-width:97vw;font-family:'DM Sans',sans-serif;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                    <span style="color:#a47ae8;font-size:15px;font-weight:700;">📝 Nota / Texto libre</span>
                    <button onclick="cerrarModalNota()" style="background:none;border:none;color:#666;font-size:20px;cursor:pointer;line-height:1;">×</button>
                </div>
                <div style="display:flex;gap:16px;">
                    <div style="flex:1;min-width:0;">
                        <p style="color:#ccc;font-size:11px;margin-bottom:8px;font-weight:600;">Formato del rollo:</p>
                        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px;" id="nota-format-grid">
                            ${botonesFormato}
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                            <span style="color:#ccc;font-size:11px;font-weight:600;flex:1;">Tamaño del texto:</span>
                            <button onclick="cambiarEscalaNota(-0.1)" title="Más chico"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">−</button>
                            <span id="nota-escala-val" style="color:#a47ae8;font-size:12px;font-weight:700;
                                       min-width:44px;text-align:center;">100%</span>
                            <button onclick="cambiarEscalaNota(0.1)" title="Más grande"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">+</button>
                            <button onclick="cambiarEscalaNota(0, true)" title="Volver al automático"
                                style="height:28px;padding:0 8px;background:#1a1a1a;color:#777;border:1px solid #333;
                                       border-radius:6px;font-size:10px;cursor:pointer;">auto</button>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                            <span style="color:#ccc;font-size:11px;font-weight:600;flex:1;">Copias a imprimir:</span>
                            <button onclick="cambiarCopiasNota(-1)" title="Una menos"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">−</button>
                            <input id="nota-copias-val" type="number" min="1" max="50" value="1"
                                onchange="fijarCopiasNota(this.value)"
                                style="width:52px;height:28px;background:#1a1a1a;color:#a47ae8;border:1px solid #333;
                                       border-radius:6px;text-align:center;font-size:13px;font-weight:700;
                                       font-family:'DM Sans',sans-serif;">
                            <button onclick="cambiarCopiasNota(1)" title="Una más"
                                style="width:30px;height:28px;background:#222;color:#ccc;border:1px solid #333;
                                       border-radius:6px;font-size:16px;font-weight:700;cursor:pointer;line-height:1;">+</button>
                            <button onclick="fijarCopiasNota(1)" title="Volver a una sola"
                                style="height:28px;padding:0 8px;background:#1a1a1a;color:#777;border:1px solid #333;
                                       border-radius:6px;font-size:10px;cursor:pointer;">1×</button>
                        </div>
                        <p style="color:#ccc;font-size:11px;margin-bottom:6px;font-weight:600;">Texto a imprimir:</p>
                        <textarea id="nota-texto-libre" oninput="actualizarPreviewNota()" placeholder="Escribe aquí la nota…"
                            style="width:100%;min-height:90px;background:#1a1a1a;color:#eee;border:1px solid #333;
                                   border-radius:8px;padding:8px;font-size:12px;font-family:'DM Sans',sans-serif;resize:vertical;"></textarea>
                    </div>
                    <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:space-between;">
                        <div id="nota-preview-area" style="border-radius:8px;overflow:hidden;flex:1;margin-bottom:10px;min-height:80px;"></div>
                        <div id="nota-status" style="font-size:11px;color:#888;margin-bottom:8px;min-height:14px;text-align:center;"></div>
                        <button onclick="enviarNotaImpresion()" id="nota-btn-imprimir"
                            style="width:100%;background:linear-gradient(135deg,#7a4ad4,#4a2a8c);
                                   color:#ede0ff;border:none;border-radius:10px;padding:12px;
                                   font-size:13px;font-weight:700;cursor:pointer;">
                            🖨️ Imprimir Nota
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(m);
    }
    m.style.display = 'flex';
    const activo = document.querySelector(`#nota-format-grid button[data-fmt="${_notaFormato}"]`);
    document.querySelectorAll('#nota-format-grid button').forEach(b => {
        b.style.background = '#222'; b.style.color = '#aaa'; b.style.border = '1px solid #333';
    });
    if (activo) { activo.style.background = '#7a4ad4'; activo.style.color = '#fff'; activo.style.border = 'none'; }
    refrescarEscalaNota();
    refrescarCopiasNota();
    actualizarPreviewNota();
}

function cerrarModalNota() {
    const m = document.getElementById('modal-nota-imprimir');
    if (m) m.style.display = 'none';
}

// delta = cuánto mover la escala; reset = volver al automático (100%).
// Se limita entre 50% y 200%: por debajo el texto es ilegible en una etiqueta
// de 5cm, y por encima el auto-ajuste lo termina recortando igual.
function cambiarEscalaNota(delta, reset) {
    _notaEscala = reset ? 1 : Math.min(2, Math.max(0.5, _notaEscala + delta));
    _notaEscala = Math.round(_notaEscala * 10) / 10;   // evita 0.7000000000000001
    localStorage.setItem('verex_nota_escala', String(_notaEscala));
    refrescarEscalaNota();
    actualizarPreviewNota();
}

function refrescarEscalaNota() {
    const el = document.getElementById('nota-escala-val');
    if (el) {
        el.textContent = Math.round(_notaEscala * 100) + '%';
        el.style.color = (_notaEscala === 1) ? '#a47ae8' : '#f0b429';
    }
}

// Tope de 50 copias: es una nota, no una tirada — y evita que un dedazo en el
// campo numérico mande cientos de etiquetas a la impresora.
function fijarCopiasNota(n) {
    _notaCopias = Math.max(1, Math.min(50, parseInt(n) || 1));
    localStorage.setItem('verex_nota_copias', String(_notaCopias));
    refrescarCopiasNota();
}

function cambiarCopiasNota(delta) {
    fijarCopiasNota(_notaCopias + delta);
}

function refrescarCopiasNota() {
    const inp = document.getElementById('nota-copias-val');
    if (inp) {
        inp.value = _notaCopias;
        inp.style.color = (_notaCopias === 1) ? '#a47ae8' : '#f0b429';
    }
    // El botón dice cuántas se van a imprimir, para que no haya sorpresas.
    const btn = document.getElementById('nota-btn-imprimir');
    if (btn) btn.textContent = (_notaCopias === 1)
        ? '🖨️ Imprimir Nota'
        : `🖨️ Imprimir ${_notaCopias} copias`;
}

function selFormatoNota(fmt, btn) {
    _notaFormato = fmt;
    localStorage.setItem('verex_nota_formato', fmt);
    document.querySelectorAll('#nota-format-grid button').forEach(b => {
        b.style.background = '#222'; b.style.color = '#aaa'; b.style.border = '1px solid #333';
    });
    btn.style.background = '#7a4ad4'; btn.style.color = '#fff'; btn.style.border = 'none';
    actualizarPreviewNota();
}

async function actualizarPreviewNota() {
    const area = document.getElementById('nota-preview-area');
    if (!area) return;
    const texto = (document.getElementById('nota-texto-libre')?.value || '').trim();
    if (!texto) { area.innerHTML = ''; return; }
    try {
        const pdfBase64 = await generarPDFNotaLibre(texto, _notaFormato);
        area.innerHTML = `
            <p style="color:#666;font-size:10px;text-align:center;margin-bottom:4px;">Vista previa</p>
            <iframe src="data:application/pdf;base64,${pdfBase64}"
                style="width:100%;height:130px;border:1px solid #333;border-radius:6px;background:#fff;"
                scrolling="no"></iframe>`;
    } catch(e) {
        area.innerHTML = '<p style="color:#444;font-size:11px;text-align:center;padding:8px;">Vista previa no disponible</p>';
    }
}

// Genera un PDF de texto libre centrado, con auto-reducción de tamaño de fuente
// hasta que el texto quepa en las dimensiones del formato elegido.
async function generarPDFNotaLibre(texto, formato, copias) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF no cargado');
    const t = (texto || '').trim();
    if (!t) throw new Error('Escribe el texto de la nota');
    const d = NOTA_DIMS[formato] || NOTA_DIMS.producto;
    const { jsPDF } = window.jspdf;
    const W = d.w, H = d.h, pad = Math.min(4, W * 0.08);
    const orientation = (W >= H) ? 'landscape' : 'portrait';
    const doc = new jsPDF({ unit: 'mm', format: [W, H], orientation });

    // Punto de partida = el automático de siempre, multiplicado por la escala
    // que eligió el usuario. El bucle de abajo lo sigue reduciendo si no entra,
    // así que subir la escala nunca puede desbordar la etiqueta: en el peor
    // caso el texto termina en el mismo tamaño que daba el automático.
    // El piso también se escala, para que al pedir letra chica de verdad baje
    // (con el piso fijo en 5pt no se notaba el cambio en textos largos).
    // El tamaño de partida se ALINEA a una grilla de 0.25pt y se baja por esa
    // misma grilla. Sin esto la escala no era monótona: al 70% arrancaba en
    // 7.14 y entraba de una, mientras que al 100% arrancaba en 10.2 y bajaba
    // de a 0.5 hasta 6.7 — o sea que pedir letra MÁS CHICA la daba MÁS GRANDE.
    // Con la grilla compartida, subir la escala nunca achica.
    const deseado = Math.min(14, H * 0.6) * _notaEscala;
    let fontSize = Math.floor(deseado * 4) / 4;
    const minFont = 3;
    let lineas, lineH;
    doc.setFont('helvetica', 'bold');
    while (fontSize >= minFont) {
        doc.setFontSize(fontSize);
        lineas = doc.splitTextToSize(t, W - pad * 2);
        lineH = fontSize * 0.42;
        if (lineas.length * lineH <= H - pad * 2) break;
        fontSize -= 0.25;
    }
    doc.setTextColor(0, 0, 0);
    const altoTexto = lineas.length * lineH;

    // Una página por copia. El tamaño de fuente ya está resuelto, así que todas
    // salen idénticas; el servidor las separa después en etiquetas distintas.
    const n = Math.max(1, Math.min(50, parseInt(copias) || 1));
    for (let c = 0; c < n; c++) {
        if (c > 0) doc.addPage([W, H], orientation);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize);
        doc.setTextColor(0, 0, 0);
        let y = (H - altoTexto) / 2 + lineH * 0.8;
        lineas.forEach(linea => {
            doc.text(linea, W / 2, y, { align: 'center' });
            y += lineH;
        });
    }
    const raw = doc.output('datauristring');
    return raw.split(',')[1];
}

async function enviarNotaImpresion() {
    const status = document.getElementById('nota-status');
    const texto = (document.getElementById('nota-texto-libre')?.value || '').trim();
    if (!texto) { status.style.color = '#ef4444'; status.textContent = '⚠️ Escribe el texto de la nota'; return; }

    status.style.color = '#a47ae8';
    status.textContent = '⏳ Generando PDF…';
    let pdfBase64 = null;
    try {
        pdfBase64 = await generarPDFNotaLibre(texto, _notaFormato, _notaCopias);
    } catch(err) {
        status.style.color = '#ef4444';
        status.textContent = '⚠️ Error PDF: ' + (err.message || err);
        return;
    }

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
                // separar:true pide que cada página salga como etiqueta aparte y
                // no como una tira larga — si no, las copias vendrían pegadas.
                body: JSON.stringify({ formato: _notaFormato, rollo: _rolloImpresion, pdf_base64: pdfBase64, pageCount: _notaCopias, separar: true, printerIp: localStorage.getItem('verex_wifi_ip') || undefined })
            });
            const json = await res.json();
            if (json.ok) {
                status.style.color = '#22c55e';
                status.textContent = '✅ Nota enviada a Brother QL';
                setTimeout(() => { cerrarModalNota(); }, 1800);
            } else {
                status.style.color = '#ef4444';
                status.textContent = '⚠️ ' + (json.error || 'Error en impresora');
            }
        } catch(e) {
            status.style.color = '#ef4444';
            status.textContent = '⚠️ Error al enviar al servidor';
        }
    } else {
        imprimirPDFNotaNavegador(pdfBase64, _notaFormato);
        status.style.color = '#22c55e';
        status.textContent = '✅ Abriendo diálogo de impresión…';
        setTimeout(() => { cerrarModalNota(); }, 1200);
    }
}

function imprimirPDFNotaNavegador(pdfBase64, formato) {
    const d = NOTA_DIMS[formato] || NOTA_DIMS.producto;
    const orient = (d.w > d.h) ? 'landscape' : 'portrait';
    const cssSize = `${d.w}mm ${d.h}mm`;

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
    setTimeout(function() { window.print(); }, 800);
  };
<\/script>
</body></html>`;

    const w = window.open('', '_blank', `width=${Math.round(d.w * 3.78)},height=${Math.round(d.h * 3.78)}`);
    if (w) { w.document.write(html); w.document.close(); }
}
