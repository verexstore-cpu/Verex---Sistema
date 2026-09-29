/* Web Worker: ejecuta el pipeline fuera del hilo de la interfaz. Todo es local. */
'use strict';
importScripts('core/presets.js', 'core/pipeline.js');

let cached = null; // fuente de la vista previa (no se muta jamás: el pipeline trabaja sobre copias)

function run(id, src, params, opts, transferBase) {
  try {
    const t0 = Date.now();
    const r = VXP.process(src, params, opts);
    const out = { id, ok: true, width: r.width, height: r.height, data: r.data.buffer, qc: r.qc, info: r.info, ms: Date.now() - t0 };
    const tr = [out.data];
    if (transferBase && opts.wantBase) { out.base = r.base.buffer; tr.push(out.base); }
    postMessage(out, tr);
  } catch (err) {
    postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'setSource') {
    cached = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) };
    postMessage({ id: m.id, ok: true, source: true });
  } else if (m.type === 'run') {
    if (!cached) return postMessage({ id: m.id, ok: false, error: 'Sin imagen cargada' });
    run(m.id, cached, m.params, m.opts || {}, true);
  } else if (m.type === 'process') { // lote: una imagen, un solo uso
    run(m.id, { width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) }, m.params, m.opts || {}, false);
  }
};
