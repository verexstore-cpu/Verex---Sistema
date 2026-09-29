/* VEREX PHOTO OPTIMIZER — interfaz.
 * Todo el procesamiento es local (Web Workers). Los originales solo se LEEN. */
'use strict';
(function () {
  const PR = window.VXPresets, clone = PR.clone;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ───────────────────────── Estado ─────────────────────────
  const S = {
    items: [], cur: -1, bitmap: null, src: null, srcVer: 0, result: null,
    params: PR.presetParams(PR.DEFAULT_PRESET), presetName: PR.DEFAULT_PRESET,
    view: { mode: 'split-h', zoom: 'fit', pos: 50, hold: false },
    settings: { previewMax: 2400, threads: Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)), confirmOverwrite: true, qcWarn: true, userPresets: {}, last: null },
    exp: { formats: { jpg: false, png: false, webp: true }, dest: 'copy', suffix: '_verex', folder: '', scope: 'current' },
    hist: { stack: [], i: -1 }, prepKey: '', busy: false, exporting: false,
  };

  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms || 3200);
  }

  // ───────────────────────── Controles ─────────────────────────
  const getP = (path) => path.split('.').reduce((o, k) => o[k], S.params);
  const setP = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], S.params)[last] = v; };
  const sliders = [];

  const SECTIONS = [
    { id: 'preset', title: 'PRESETS', open: true, custom: 'presets' },
    { id: 'opt', title: 'OPTIMIZACIÓN', open: true, items: [
      { k: 'intensity', label: 'INTENSIDAD DE OPTIMIZACIÓN', key: true, warn: true },
      { k: 'fidelity', label: 'FIDELIDAD DEL PRODUCTO', key: true } ] },
    { id: 'detail', title: 'DETALLE', open: true, items: [
      { k: 'sharpness', label: 'NITIDEZ', key: true, warn: true },
      { k: 'denoise', label: 'REDUCCIÓN DE RUIDO', key: true },
      { k: 'contrast', label: 'CONTRASTE', key: true } ] },
    { id: 'light', title: 'ILUMINACIÓN', items: [
      { k: 'exposure', label: 'Exposición', min: -100 }, { k: 'highlights', label: 'Altas luces', min: -100 },
      { k: 'shadows', label: 'Sombras', min: -100 }, { k: 'whites', label: 'Blancos', min: -100 }, { k: 'blacks', label: 'Negros', min: -100 } ] },
    { id: 'color', title: 'COLOR', items: [
      { k: 'temperature', label: 'Temperatura', min: -100 }, { k: 'tint', label: 'Tinte', min: -100 },
      { k: 'saturation', label: 'Saturación', min: -100 }, { k: 'vibrance', label: 'Vibrancia', min: -100 } ], custom: 'jewelry' },
    { id: 'bg', title: 'FONDO', custom: 'bg' },
    { id: 'out', title: 'SALIDA', open: true, custom: 'out' },
  ];

  function makeSlider(spec, host) {
    const min = spec.min != null ? spec.min : 0, max = spec.max != null ? spec.max : 100;
    const wrap = el('div', 'sl');
    const top = el('div', 'sl-top');
    const label = el('label', spec.key ? 'key' : '', esc(spec.label)); label.title = 'Doble clic: valor del preset';
    const num = el('input'); num.type = 'text'; num.inputMode = 'numeric';
    top.append(label, num);
    const rng = el('input'); rng.type = 'range'; rng.min = min; rng.max = max; rng.step = 1;
    wrap.append(top, rng); host.append(wrap);
    const paint = () => { rng.style.setProperty('--p', ((rng.value - min) / (max - min)) * 100 + '%'); num.value = rng.value; };
    rng.addEventListener('input', () => { setP(spec.k, +rng.value); paint(); liveChanged(spec); });
    rng.addEventListener('change', () => commit(spec.label));
    num.addEventListener('change', () => {
      const v = Math.round(Math.min(max, Math.max(min, parseFloat(num.value) || 0)));
      rng.value = v; setP(spec.k, v); paint(); liveChanged(spec); commit(spec.label);
    });
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });
    label.addEventListener('dblclick', () => {
      const base = S.presetName && (PR.LOOKS[S.presetName]) ? PR.presetParams(S.presetName, S.settings.userPresets) : PR.NEUTRAL;
      const v = spec.k.split('.').reduce((o, k) => o[k], base);
      rng.value = v; setP(spec.k, v); paint(); liveChanged(spec); commit(spec.label);
    });
    const s = { spec, rng, num, wrap, paint, sync() { rng.value = getP(spec.k); paint(); } };
    sliders.push(s); s.sync(); return s;
  }

  let warnBox = null;
  function updateWarnBox() {
    if (!warnBox) return;
    const hi = S.params.intensity > 85 || S.params.sharpness > 85;
    warnBox.hidden = !hi;
  }

  function buildControls() {
    const root = $('#controls'); root.innerHTML = '';
    for (const sec of SECTIONS) {
      const d = el('details'); if (sec.open) d.open = true;
      d.append(el('summary', '', sec.title));
      const body = el('div', 'sec'); d.append(body);
      if (sec.custom === 'presets') buildPresets(body);
      (sec.items || []).forEach((it) => makeSlider(it, body));
      if (sec.id === 'opt') {
        warnBox = el('div', 'warn-box', 'Valores elevados pueden producir una apariencia poco natural.'); warnBox.hidden = true; body.append(warnBox);
      }
      if (sec.custom === 'jewelry') { buildWB(body); buildJewelry(body); }
      if (sec.custom === 'bg') buildBg(body);
      if (sec.custom === 'out') buildOut(body);
      root.append(d);
    }
    const qc = el('div', 'qc'); qc.id = 'qc'; qc.innerHTML = '<h4>CONTROL DE CALIDAD</h4><div class="muted">Abre una foto para analizarla.</div>'; root.append(qc);
  }

  // Presets
  let presetGrid, presetDesc, btnSavePreset, btnResetPreset;
  function buildPresets(host) {
    presetGrid = el('div', 'presets');
    PR.ORDER.forEach((name) => {
      const b = el('button', 'preset', esc(name.replace('VEREX ', '')) + '<small>VEREX</small>'); b.dataset.name = name;
      b.addEventListener('click', () => applyPreset(name)); presetGrid.append(b);
    });
    presetDesc = el('div', 'preset-desc');
    const act = el('div', 'preset-actions');
    btnSavePreset = el('button', 'btn small', 'Guardar cambios en el preset'); btnResetPreset = el('button', 'btn small', 'Restablecer preset');
    btnSavePreset.addEventListener('click', () => {
      if (!S.presetName) return;
      S.settings.userPresets[S.presetName] = clone(S.params); persistSettings(); refreshPresetUI(); toast('Preset «' + S.presetName + '» actualizado');
    });
    btnResetPreset.addEventListener('click', () => {
      if (!S.presetName) return;
      delete S.settings.userPresets[S.presetName]; persistSettings(); applyPreset(S.presetName); toast('Preset restablecido a los valores de fábrica');
    });
    act.append(btnSavePreset, btnResetPreset); host.append(presetGrid, presetDesc, act);
  }
  function refreshPresetUI() {
    $$('.preset', presetGrid).forEach((b) => {
      const on = b.dataset.name === S.presetName; b.classList.toggle('on', on);
      b.classList.toggle('mod', on && !PR.equal(S.params, PR.presetParams(b.dataset.name, S.settings.userPresets)));
    });
    const L = PR.LOOKS[S.presetName];
    const custom = S.presetName && S.settings.userPresets[S.presetName] ? ' (personalizado)' : '';
    presetDesc.textContent = L ? L.desc + custom : 'Sin preset — ajustes manuales.';
    btnSavePreset.disabled = !S.presetName || PR.equal(S.params, PR.presetParams(S.presetName, S.settings.userPresets));
    btnResetPreset.disabled = !S.presetName || !S.settings.userPresets[S.presetName];
  }
  function applyPreset(name) {
    S.params = PR.presetParams(name, S.settings.userPresets); S.presetName = name;
    commit('Preset ' + name); refreshAll(); afterParamsChanged();
  }

  // Corrección automática del tinte
  let wbChk, wbSl;
  function buildWB(host) {
    const lab = el('label', 'chk'); wbChk = el('input'); wbChk.type = 'checkbox';
    lab.append(wbChk, el('span', '', '<b style="letter-spacing:.06em">CORREGIR TINTE</b> — automático'));
    lab.title = 'Usa el fondo de la foto como referencia de blanco y neutraliza el tinte (luz amarillenta, verdosa…) en toda la imagen.';
    wbChk.addEventListener('change', () => { S.params.whiteBalance.auto = wbChk.checked; commit('Corregir tinte'); refreshWB(); afterParamsChanged(); });
    host.append(lab);
    wbSl = makeSlider({ k: 'whiteBalance.strength', label: 'Intensidad de la corrección' }, host);
    host.append(el('p', 'fine', 'Solo actúa con fondo claro y tinte moderado; con fondo oscuro o de color no toca nada.'));
  }
  function refreshWB() {
    wbChk.checked = !!S.params.whiteBalance.auto;
    wbSl.rng.disabled = !S.params.whiteBalance.auto; wbSl.num.disabled = !S.params.whiteBalance.auto; wbSl.wrap.style.opacity = S.params.whiteBalance.auto ? 1 : .4;
  }

  // Joyería
  let jewelryChk, metalSel, protectSl;
  function buildJewelry(host) {
    const sep = el('div'); sep.style.cssText = 'height:1px;background:var(--line);margin:14px 0 4px'; host.append(sep);
    const lab = el('label', 'chk'); jewelryChk = el('input'); jewelryChk.type = 'checkbox';
    lab.append(jewelryChk, el('span', '', '<b style="letter-spacing:.06em">JOYERÍA VEREX</b> — preservar colores reales'));
    jewelryChk.addEventListener('change', () => { S.params.jewelry.on = jewelryChk.checked; commit('Joyería VEREX'); refreshJewelry(); afterParamsChanged(); });
    const f = el('div', 'field'); f.append(el('label', '', 'Metal'));
    metalSel = el('select', 'sel');
    [['auto', 'Detectar automáticamente'], ['silver', 'Plata 925'], ['gold', 'Oro laminado'], ['steel', 'Acero 316L']].forEach(([v, t]) => metalSel.append(new Option(t, v)));
    metalSel.addEventListener('change', () => { S.params.jewelry.metal = metalSel.value; commit('Metal'); afterParamsChanged(); });
    f.append(metalSel); host.append(lab, f);
    protectSl = makeSlider({ k: 'jewelry.protect', label: 'Protección de color del metal' }, host);
  }
  function refreshJewelry() {
    jewelryChk.checked = S.params.jewelry.on; metalSel.value = S.params.jewelry.metal;
    metalSel.disabled = !S.params.jewelry.on; protectSl.rng.disabled = !S.params.jewelry.on; protectSl.wrap.style.opacity = S.params.jewelry.on ? 1 : .4;
  }

  // Fondo
  let bgOpt, bgWhite, bgSliders = [];
  function buildBg(host) {
    const l1 = el('label', 'chk'); bgOpt = el('input'); bgOpt.type = 'checkbox'; l1.append(bgOpt, el('span', '', 'Optimizar fondo'));
    const l2 = el('label', 'chk'); bgWhite = el('input'); bgWhite.type = 'checkbox'; l2.append(bgWhite, el('span', '', 'Fondo blanco <b>#FFFFFF</b>'));
    bgOpt.addEventListener('change', () => { S.params.bg.optimize = bgOpt.checked; if (!bgOpt.checked) S.params.bg.pureWhite = false; commit('Fondo'); refreshBg(); afterParamsChanged(); });
    bgWhite.addEventListener('change', () => { S.params.bg.pureWhite = bgWhite.checked; if (bgWhite.checked) S.params.bg.optimize = true; commit('Fondo blanco'); refreshBg(); afterParamsChanged(); });
    host.append(l1, l2);
    bgSliders = [
      makeSlider({ k: 'bg.clean', label: 'Limpiar manchas' }, host),
      makeSlider({ k: 'bg.uniform', label: 'Uniformar iluminación' }, host),
      makeSlider({ k: 'bg.whiten', label: 'Mejorar blancura' }, host)];
    host.append(el('p', 'fine', 'Solo actúa donde no hay producto. Nunca añade sombras ni toca la joya.'));
  }
  function refreshBg() {
    bgOpt.checked = S.params.bg.optimize; bgWhite.checked = S.params.bg.pureWhite;
    bgSliders.forEach((s, i) => {
      const off = !S.params.bg.optimize || (S.params.bg.pureWhite && i > 0);
      s.rng.disabled = off; s.num.disabled = off; s.wrap.style.opacity = off ? .4 : 1;
    });
  }

  // Salida
  let outMode, outSize, outNoUp, outFmt, outQ, outInfo;
  function buildOut(host) {
    const f1 = el('div', 'field'); f1.append(el('label', '', 'Tamaño'));
    outMode = el('select', 'sel'); outMode.append(new Option('Original', 'original'), new Option('Cuadrado (ajustar)', 'fit')); f1.append(outMode);
    const f2 = el('div', 'field'); f2.append(el('label', '', 'Lado del lienzo (px)'));
    outSize = el('input', 'txt'); outSize.type = 'number'; outSize.min = 200; outSize.max = 8000; outSize.step = 50; outSize.style.width = '84px'; f2.append(outSize);
    const l3 = el('label', 'chk'); outNoUp = el('input'); outNoUp.type = 'checkbox'; l3.append(outNoUp, el('span', '', 'No ampliar fotos pequeñas'));
    const f4 = el('div', 'field'); f4.append(el('label', '', 'Formato'));
    outFmt = el('select', 'sel'); outFmt.append(new Option('WEBP', 'webp'), new Option('JPG', 'jpg'), new Option('PNG', 'png')); f4.append(outFmt);
    outQ = makeSlider({ k: 'output.quality', label: 'Calidad', min: 40, max: 100 }, host);
    outInfo = el('div', 'fine'); outInfo.style.marginTop = '8px';
    host.prepend(f1, f2, l3, f4); host.append(outInfo);
    const chg = () => {
      const o = S.params.output; o.mode = outMode.value; o.size = Math.max(200, Math.min(8000, +outSize.value || 1600)); o.noUpscale = outNoUp.checked; o.format = outFmt.value;
      commit('Salida'); refreshOut(); afterParamsChanged();
    };
    [outMode, outSize, outNoUp, outFmt].forEach((e) => e.addEventListener('change', chg));
  }
  function refreshOut() {
    const o = S.params.output;
    outMode.value = o.mode; outSize.value = o.size; outNoUp.checked = o.noUpscale; outFmt.value = o.format;
    outSize.disabled = o.mode !== 'fit'; outNoUp.disabled = o.mode !== 'fit';
    outQ.wrap.style.display = o.format === 'png' ? 'none' : '';
  }

  function refreshAll() {
    sliders.forEach((s) => s.sync()); refreshPresetUI(); refreshWB(); refreshJewelry(); refreshBg(); refreshOut(); updateWarnBox(); updateHistButtons();
  }

  function liveChanged(spec) {
    if (spec.k.startsWith('output.')) { S.params.output.format = S.params.output.format; }
    updateWarnBox(); refreshPresetUI(); schedule(160); saveLastSoon();
  }
  function afterParamsChanged() {
    updateWarnBox(); refreshPresetUI();
    const key = prepKeyOf();
    if (S.bitmap && key !== S.prepKey) prepareSource(); else schedule(60);
    saveLastSoon();
  }
  const prepKeyOf = () => JSON.stringify([S.params.output.mode, S.params.output.size, S.params.output.noUpscale, S.settings.previewMax]);

  // ───────────────────────── Historial ─────────────────────────
  function commit(label) {
    const snap = { p: clone(S.params), name: S.presetName, label };
    const h = S.hist, cur = h.stack[h.i];
    if (cur && PR.equal(cur.p, snap.p) && cur.name === snap.name) return;
    h.stack.length = h.i + 1; h.stack.push(snap); if (h.stack.length > 200) h.stack.shift(); h.i = h.stack.length - 1;
    updateHistButtons();
  }
  function restoreSnap(snap) { S.params = clone(snap.p); S.presetName = snap.name; refreshAll(); afterParamsChanged(); }
  function undo() { const h = S.hist; if (h.i > 0) { h.i--; restoreSnap(h.stack[h.i]); } }
  function redo() { const h = S.hist; if (h.i < h.stack.length - 1) { h.i++; restoreSnap(h.stack[h.i]); } }
  function updateHistButtons() { $('#btn-undo').disabled = S.hist.i <= 0; $('#btn-redo').disabled = S.hist.i >= S.hist.stack.length - 1; }
  function restoreOriginal() {
    S.params = clone(PR.NEUTRAL); S.presetName = null; commit('Restaurar original'); refreshAll(); afterParamsChanged();
    toast('Foto original: sin ningún ajuste');
  }

  // ───────────────────────── Ajustes persistentes ─────────────────────────
  let saveTimer = null;
  async function persistSettings() { try { await window.api.saveSettings(S.settings); } catch (_) { /* sin persistencia */ } }
  function saveLastSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { S.settings.last = { params: S.params, presetName: S.presetName, exp: S.exp }; persistSettings(); }, 800);
  }

  // ───────────────────────── Archivos ─────────────────────────
  let uid = 1;
  async function addPaths(paths) {
    if (!paths || !paths.length) return;
    const list = await window.api.expandPaths(paths);
    const have = new Set(S.items.map((i) => i.path.toLowerCase()));
    let added = 0, first = -1;
    for (const p of list) {
      if (have.has(p.toLowerCase())) continue;
      have.add(p.toLowerCase());
      S.items.push({ id: uid++, path: p, name: p.split(/[\\/]/).pop(), thumb: null, status: null });
      if (first < 0) first = S.items.length - 1; added++;
    }
    if (!added) { toast(list.length ? 'Esas fotos ya estaban en la lista' : 'No se encontraron imágenes JPG, PNG o WEBP'); return; }
    renderList(); toast(added + (added === 1 ? ' foto agregada' : ' fotos agregadas'));
    if (S.cur < 0 || S.items.length === added) selectItem(first);
    queueThumbs();
  }

  let thumbBusy = false;
  async function queueThumbs() {
    if (thumbBusy) return; thumbBusy = true;
    try {
      for (const it of S.items) {
        if (it.thumb || it.thumbFail) continue;
        try {
          const bytes = await window.api.readFile(it.path);
          const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image', resizeWidth: 96, resizeQuality: 'medium' });
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
          it.thumb = c.toDataURL('image/jpeg', 0.7);
          const img = $('.file[data-id="' + it.id + '"] img'); if (img) img.src = it.thumb;
        } catch (_) { it.thumbFail = true; it.status = it.status || 'err'; }
        await sleep(0);
      }
    } finally { thumbBusy = false; }
  }

  function renderList() {
    const host = $('#file-list'); host.innerHTML = '';
    S.items.forEach((it, i) => {
      const d = el('div', 'file' + (i === S.cur ? ' sel' : '')); d.dataset.id = it.id;
      const img = el('img'); if (it.thumb) img.src = it.thumb; img.alt = '';
      const meta = el('div'); meta.style.minWidth = 0;
      meta.append(el('div', 'nm', esc(it.name)), el('div', 'sub', it.w ? it.w + '×' + it.h : ' '));
      d.append(img, meta, el('span', 'dot ' + (it.status || '')));
      d.title = it.path; d.addEventListener('click', () => selectItem(i)); host.append(d);
    });
    $('#file-count').textContent = S.items.length;
    $('#btn-remove').disabled = S.cur < 0; $('#btn-clear').disabled = !S.items.length; $('#btn-export').disabled = !S.items.length;
    $('#empty').hidden = S.items.length > 0 || !!S.src;
  }

  async function selectItem(i) {
    if (i < 0 || i >= S.items.length) return;
    S.cur = i; renderList();
    const it = S.items[i]; const ver = ++S.loadVer || (S.loadVer = 1);
    setBusy(true, 'Cargando ' + it.name + '…');
    try {
      const bytes = await window.api.readFile(it.path);
      const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
      if (ver !== S.loadVer) { bmp.close(); return; }
      if (S.bitmap) S.bitmap.close(); S.bitmap = bmp; it.w = bmp.width; it.h = bmp.height;
      $('#st-name').textContent = it.name; $('#st-dims').textContent = bmp.width + ' × ' + bmp.height + ' px';
      renderList(); await prepareSource();
    } catch (e) {
      it.status = 'err'; renderList(); setBusy(false); toast('No se pudo abrir «' + it.name + '»: ' + (e.message || e), 5000);
    }
  }

  function removeCurrent() {
    if (S.cur < 0) return;
    S.items.splice(S.cur, 1);
    if (!S.items.length) return clearAll();
    S.cur = Math.min(S.cur, S.items.length - 1); renderList(); selectItem(S.cur);
  }
  function clearAll() {
    S.items = []; S.cur = -1; S.src = null; S.result = null; if (S.bitmap) { S.bitmap.close(); S.bitmap = null; }
    S.srcVer++; $('#stage').hidden = true; $('#empty').hidden = false; $('#st-name').textContent = '—'; $('#st-dims').textContent = ''; $('#st-ms').textContent = '';
    renderList(); renderQC(null); setBusy(false);
  }

  // ───────────────────────── Preparación de la fuente ─────────────────────────
  function planSize(sw, sh, out, cap) {
    let fw = sw, fh = sh, padSize = 0;
    if (out.mode === 'fit') {
      let s = Math.min(out.size / sw, out.size / sh); if (out.noUpscale) s = Math.min(1, s);
      fw = Math.max(1, Math.round(sw * s)); fh = Math.max(1, Math.round(sh * s)); padSize = Math.max(fw, fh);
    }
    const big = padSize || Math.max(fw, fh);
    const ps = cap && big > cap ? cap / big : 1;
    const q = (v) => Math.max(1, Math.round(v * ps));
    return {
      scale: ps,
      export: { w: fw, h: fh, pad: padSize ? { width: padSize, height: padSize } : null },
      preview: { w: q(fw), h: q(fh), pad: padSize ? { width: q(padSize), height: q(padSize) } : null },
    };
  }

  /** Reduce por pasos (calidad tipo Lanczos) y aplana la transparencia sobre blanco. */
  function rasterize(bmp, w, h) {
    let src = bmp, cw = bmp.width, ch = bmp.height;
    while (cw >= w * 2 && ch >= h * 2) {
      const nw = Math.max(w, Math.floor(cw / 2)), nh = Math.max(h, Math.floor(ch / 2));
      const c = new OffscreenCanvas(nw, nh), x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, nw, nh); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, nw, nh);
      src = c; cw = nw; ch = nh;
    }
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
    return x.getImageData(0, 0, w, h);
  }

  async function prepareSource() {
    if (!S.bitmap) return;
    S.prepKey = prepKeyOf();
    const plan = planSize(S.bitmap.width, S.bitmap.height, S.params.output, S.settings.previewMax);
    const img = rasterize(S.bitmap, plan.preview.w, plan.preview.h);
    S.src = { pad: plan.preview.pad, scale: plan.scale, w: img.width, h: img.height };
    S.srcVer++;
    ensurePreviewWorker();
    pv.worker.postMessage({ type: 'setSource', id: ++pv.id, width: img.width, height: img.height, buffer: img.data.buffer }, [img.data.buffer]);
    $('#empty').hidden = true; $('#stage').hidden = false;
    pv.pending = false; kick();
  }

  // ───────────────────────── Vista previa (worker) ─────────────────────────
  const pv = { worker: null, id: 0, inflight: false, pending: false, timer: null, ver: 0, reqId: 0 };
  function ensurePreviewWorker() {
    if (pv.worker) return;
    pv.worker = new Worker('worker.js');
    pv.worker.onmessage = (e) => {
      const m = e.data; if (m.source) return;
      if (m.id !== pv.reqId) return;
      pv.inflight = false;
      if (!m.ok) { setBusy(false); toast('Error de procesamiento: ' + m.error.split('\n')[0], 6000); return; }
      if (pv.ver !== S.srcVer || pv.pending) { pv.pending = false; kick(); return; }
      setBusy(false); showResult(m);
    };
    pv.worker.onerror = (e) => { pv.inflight = false; setBusy(false); toast('Error del worker: ' + e.message, 6000); };
  }
  function schedule(ms) { clearTimeout(pv.timer); pv.timer = setTimeout(kick, ms == null ? 120 : ms); }
  function kick() {
    if (!S.src || !pv.worker) return;
    if (pv.inflight) { pv.pending = true; return; }
    pv.inflight = true; pv.pending = false; pv.ver = S.srcVer; pv.reqId = ++pv.id;
    setBusy(true, 'Procesando…');
    pv.worker.postMessage({ type: 'run', id: pv.reqId, params: clone(S.params), opts: { analyze: true, wantBase: true, pad: S.src.pad } });
  }
  function setBusy(on, text) {
    S.busy = on; $('#busy').hidden = !on; if (text) $('#busy-text').textContent = text;
  }

  // ───────────────────────── Visor ─────────────────────────
  const stage = $('#stage'), viewer = $('#viewer'), cvA = $('#cv-after'), cvB = $('#cv-before'), divider = $('#divider');
  let dims = { w: 0, h: 0 };

  function showResult(m) {
    const W = m.width, H = m.height;
    for (const c of [cvA, cvB]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    cvA.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.data), W, H), 0, 0);
    if (m.base) cvB.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(m.base), W, H), 0, 0);
    S.result = { w: W, h: H, qc: m.qc, info: m.info, ms: m.ms };
    const first = dims.w !== W || dims.h !== H; dims = { w: W, h: H };
    applyZoom(first); updateCompare();
    $('#st-ms').textContent = (m.info.ms.total / 1000).toFixed(2) + ' s' + (m.info.metal ? ' · metal: ' + ({ gold: 'oro', silver: 'plata', steel: 'acero' }[m.info.metal] || m.info.metal) : '') +
      (m.info.wb ? (m.info.wb.applied ? ' · tinte corregido' : ' · tinte: sin corregir (' + (m.info.wb.reason || 'ya neutro') + ')') : '');
    const badge = $('#badge');
    if (S.src && S.src.scale < 0.999) { badge.hidden = false; badge.textContent = 'Vista previa al ' + Math.round(S.src.scale * 100) + ' % de la resolución final (ver Configuración)'; } else badge.hidden = true;
    renderQC(m.qc); scheduleSizeEstimate();
  }

  function fitZoom() { return Math.max(0.02, Math.min((viewer.clientWidth - 32) / dims.w, (viewer.clientHeight - 32) / dims.h)); }
  function curZoom() { return S.view.zoom === 'fit' ? fitZoom() : S.view.zoom; }
  function applyZoom(reset) {
    if (!dims.w) return;
    const z = curZoom();
    stage.style.width = Math.round(dims.w * z) + 'px'; stage.style.height = Math.round(dims.h * z) + 'px';
    stage.classList.toggle('pix', z >= 1.5);
    $$('#seg-zoom button').forEach((b) => b.classList.toggle('on', String(b.dataset.zoom) === String(S.view.zoom)));
    if (reset) { viewer.scrollLeft = (viewer.scrollWidth - viewer.clientWidth) / 2; viewer.scrollTop = (viewer.scrollHeight - viewer.clientHeight) / 2; }
  }
  function setZoom(z, cx, cy) {
    const before = stage.getBoundingClientRect(); const fx = cx != null ? (cx - before.left) / before.width : 0.5, fy = cy != null ? (cy - before.top) / before.height : 0.5;
    S.view.zoom = z; applyZoom(false);
    if (z !== 'fit') {
      const a = stage.getBoundingClientRect();
      viewer.scrollLeft += a.left + fx * a.width - (cx != null ? cx : before.left + before.width / 2);
      viewer.scrollTop += a.top + fy * a.height - (cy != null ? cy : before.top + before.height / 2);
    }
  }

  function updateCompare() {
    const v = S.view, mode = v.hold ? 'before' : v.mode, pos = v.pos;
    $$('#seg-view button').forEach((b) => b.classList.toggle('on', b.dataset.mode === v.mode));
    const split = mode === 'split-h' || mode === 'split-v';
    cvA.style.visibility = mode === 'before' ? 'hidden' : 'visible';
    cvA.style.clipPath = mode === 'split-h' ? `inset(0 0 0 ${pos}%)` : mode === 'split-v' ? `inset(${pos}% 0 0 0)` : 'none';
    divider.hidden = !split; divider.classList.toggle('v', mode === 'split-v');
    if (mode === 'split-h') { divider.style.left = pos + '%'; divider.style.top = ''; } else if (mode === 'split-v') { divider.style.top = pos + '%'; divider.style.left = ''; }
    $('#lbl-before').hidden = !(split || mode === 'before'); $('#lbl-after').hidden = !(split || mode === 'after');
    $('#lbl-before').className = 'tag ' + (mode === 'split-v' ? '' : 'tag-l'); $('#lbl-after').className = 'tag ' + (mode === 'split-v' ? '' : 'tag-r');
    if (mode === 'split-v') { $('#lbl-before').style.cssText = 'left:10px;top:10px'; $('#lbl-after').style.cssText = 'left:10px;bottom:10px;top:auto'; }
    else { $('#lbl-before').style.cssText = ''; $('#lbl-after').style.cssText = ''; }
  }

  // Arrastre del divisor + desplazamiento (pan)
  let drag = null;
  divider.querySelector('.knob').addEventListener('pointerdown', (e) => { drag = { type: 'div' }; e.target.setPointerCapture(e.pointerId); e.stopPropagation(); });
  stage.addEventListener('pointerdown', (e) => {
    if (drag) return;
    drag = { type: 'pan', x: e.clientX, y: e.clientY, sl: viewer.scrollLeft, st: viewer.scrollTop, moved: 0 };
    stage.setPointerCapture(e.pointerId); stage.classList.add('panning');
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.type === 'div') {
      const r = stage.getBoundingClientRect(); const v = S.view;
      v.pos = Math.max(0, Math.min(100, (v.mode === 'split-v' ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width) * 100)); updateCompare();
    } else {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
      viewer.scrollLeft = drag.sl - dx; viewer.scrollTop = drag.st - dy;
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (drag && drag.type === 'pan' && drag.moved < 4 && (S.view.mode === 'split-h' || S.view.mode === 'split-v')) {
      const r = stage.getBoundingClientRect(); const v = S.view;
      v.pos = Math.max(0, Math.min(100, (v.mode === 'split-v' ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width) * 100)); updateCompare();
    }
    drag = null; stage.classList.remove('panning');
  });
  viewer.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !dims.w) return; e.preventDefault();
    setZoom(Math.max(0.1, Math.min(6, curZoom() * (e.deltaY < 0 ? 1.15 : 1 / 1.15))), e.clientX, e.clientY);
  }, { passive: false });
  new ResizeObserver(() => { if (S.view.zoom === 'fit') applyZoom(false); }).observe(viewer);

  $$('#seg-view button').forEach((b) => b.addEventListener('click', () => { S.view.mode = b.dataset.mode; updateCompare(); }));
  $$('#seg-zoom button').forEach((b) => b.addEventListener('click', () => setZoom(b.dataset.zoom === 'fit' ? 'fit' : parseFloat(b.dataset.zoom))));
  $('#btn-flip').addEventListener('click', () => { S.view.mode = S.view.mode === 'before' ? 'after' : 'before'; updateCompare(); });

  // ───────────────────────── Control de calidad / peso estimado ─────────────────────────
  function renderQC(qc) {
    const host = $('#qc'); if (!host) return;
    if (!qc) { host.innerHTML = '<h4>CONTROL DE CALIDAD</h4><div class="muted">Abre una foto para analizarla.</div>'; return; }
    const m = qc.metrics, pct = (v) => Math.round(v * 100) + ' %';
    let html = '<h4>CONTROL DE CALIDAD</h4>';
    html += qc.warnings.length ? '<ul>' + qc.warnings.map((w) => `<li class="${w.level}">${esc(w.text)}</li>`).join('') + '</ul>' : '<div class="ok">✓ Sin problemas detectados</div>';
    html += '<div class="metrics">' +
      `<span>Integridad estructural</span><b>${pct(m.structure)}</b>` +
      `<span>Microdetalle</span><b>${pct(m.detailRatio)}</b>` +
      `<span>Halos</span><b>${((m.haloRatio || 0) * 100).toFixed(1)} %</b>` +
      `<span>Cambio de color</span><b>ΔC ${(m.colorShift || 0).toFixed(1)}</b>` +
      `<span>Luces quemadas</span><b>+${Math.max(0, (m.clipIncrease || 0) * 100).toFixed(2)} %</b>` +
      '</div>';
    host.innerHTML = html;
  }

  let sizeTimer = null;
  function scheduleSizeEstimate() { clearTimeout(sizeTimer); sizeTimer = setTimeout(estimateSize, 500); }
  async function estimateSize() {
    if (!S.result || !outInfo) return;
    try {
      const o = S.params.output, c = new OffscreenCanvas(dims.w, dims.h); c.getContext('2d').drawImage(cvA, 0, 0);
      const blob = await c.convertToBlob({ type: MIME[o.format], quality: o.quality / 100 });
      const k = S.src && S.src.scale < 0.999 ? 1 / (S.src.scale * S.src.scale) : 1;
      const kb = (blob.size * k) / 1024, size = kb > 1024 ? (kb / 1024).toFixed(2) + ' MB' : Math.round(kb) + ' KB';
      const full = S.bitmap ? planSize(S.bitmap.width, S.bitmap.height, o, 0).export : null;
      const px = full ? (full.pad ? full.pad.width + '×' + full.pad.height : full.w + '×' + full.h) : '';
      outInfo.innerHTML = `Resultado: <b style="color:var(--text)">${px} px · ${o.format.toUpperCase()} · ${size}${k > 1 ? ' (estim.)' : ''}</b><br>Perfil de color: sRGB.`;
    } catch (_) { /* estimación opcional */ }
  }

  // ───────────────────────── Exportación / lote ─────────────────────────
  const dlg = $('#dlg-export');
  const fmtTime = (s) => (!isFinite(s) ? '—' : s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min' : s >= 60 ? Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s' : Math.max(0, Math.round(s)) + ' s');

  function openExport() {
    if (!S.items.length) return;
    const e = S.exp, o = S.params.output;
    e.formats = { jpg: false, png: false, webp: false }; e.formats[o.format] = true;
    $('#ex-jpg').checked = e.formats.jpg; $('#ex-png').checked = e.formats.png; $('#ex-webp').checked = e.formats.webp;
    $('#ex-count').textContent = S.items.length; $('#ex-suffix').value = e.suffix;
    $$('input[name=scope]').forEach((r) => (r.checked = r.value === (S.items.length > 1 && e.scope === 'all' ? 'all' : 'current')));
    $$('input[name=dest]').forEach((r) => (r.checked = r.value === e.dest));
    $('#ex-folder').textContent = e.folder || 'ninguna'; $('#ex-progress').hidden = true; $('#ex-open').hidden = true;
    $('#ex-go').disabled = false; $('#ex-go').textContent = 'Exportar'; $('#ex-cancel').textContent = 'Cerrar';
    updateExportSummary(); dlg.hidden = false;
  }
  function readExportForm() {
    const e = S.exp;
    e.formats = { jpg: $('#ex-jpg').checked, png: $('#ex-png').checked, webp: $('#ex-webp').checked };
    e.scope = ($('input[name=scope]:checked') || {}).value || 'current'; e.dest = ($('input[name=dest]:checked') || {}).value || 'copy';
    e.suffix = $('#ex-suffix').value.replace(/[\\/:*?"<>|]/g, '') || '_verex';
  }
  function updateExportSummary() {
    readExportForm(); const e = S.exp, o = S.params.output;
    const n = e.scope === 'all' ? S.items.length : 1, fm = Object.keys(e.formats).filter((k) => e.formats[k]);
    const plan = S.bitmap ? planSize(S.bitmap.width, S.bitmap.height, o, 0).export : null;
    const dim = o.mode === 'fit' ? (plan && plan.pad ? plan.pad.width + '×' + plan.pad.height : o.size + '×' + o.size) + ' px' : 'tamaño original';
    const ej = S.items[Math.max(0, S.cur)], stem = ej ? ej.name.replace(/\.[^.]+$/, '') : 'producto01';
    const nm = fm.map((f) => stem + (e.dest === 'copy' ? e.suffix : '') + '.' + f).join(' · ');
    $('#ex-summary').innerHTML = `<b>${n}</b> ${n === 1 ? 'foto' : 'fotos'} × <b>${fm.length}</b> ${fm.length === 1 ? 'formato' : 'formatos'} = <b>${n * fm.length}</b> ${n * fm.length === 1 ? 'archivo' : 'archivos'}<br>` +
      `Preset: <b>${esc(S.presetName || 'ajustes manuales')}</b> · ${dim} · calidad ${o.quality}<br>Ejemplo: <b>${esc(nm || '—')}</b>`;
  }
  ['#ex-jpg', '#ex-png', '#ex-webp', '#ex-suffix'].forEach((s) => $(s).addEventListener('input', updateExportSummary));
  $$('input[name=scope],input[name=dest]').forEach((r) => r.addEventListener('change', updateExportSummary));
  $('#ex-choose').addEventListener('click', async () => {
    const f = await window.api.chooseFolder('Carpeta de destino'); if (!f) return;
    S.exp.folder = f; $('#ex-folder').textContent = f; $('input[name=dest][value=folder]').checked = true; updateExportSummary();
  });

  const batch = { running: false, cancel: false, workers: [] };
  function logLine(cls, text) { const l = $('#pg-log'); const d = el('div', cls, esc(text)); l.append(d); l.scrollTop = l.scrollHeight; }

  function workerCall(w, msg, transfer) {
    return new Promise((resolve, reject) => {
      w.onmessage = (e) => (e.data.ok ? resolve(e.data) : reject(new Error(e.data.error.split('\n')[0])));
      w.onerror = (e) => reject(new Error(e.message));
      w.postMessage(msg, transfer || []);
    });
  }

  async function processItem(it, worker, params, fmts, ex) {
    const bytes = await window.api.readFile(it.path);
    const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
    const plan = planSize(bmp.width, bmp.height, params.output, 0).export;
    const img = rasterize(bmp, plan.w, plan.h); bmp.close();
    const res = await workerCall(worker, { type: 'process', id: ++pv.id, width: img.width, height: img.height, buffer: img.data.buffer, params, opts: { analyze: true, pad: plan.pad } }, [img.data.buffer]);
    const c = new OffscreenCanvas(res.width, res.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(res.data), res.width, res.height), 0, 0);
    const outs = [];
    for (const f of fmts) {
      const blob = await c.convertToBlob({ type: MIME[f], quality: f === 'png' ? undefined : params.output.quality / 100 });
      const p = await window.api.exportWrite({ srcPath: it.path, mode: ex.dest, folder: ex.folder, suffix: ex.suffix, ext: '.' + f, data: new Uint8Array(await blob.arrayBuffer()) });
      outs.push(p);
    }
    return { warnings: (res.qc && res.qc.warnings) || [], outs };
  }

  async function runExport() {
    if (batch.running) return;
    readExportForm(); const ex = clone(S.exp), fmts = Object.keys(ex.formats).filter((k) => ex.formats[k]);
    if (!fmts.length) return toast('Elige al menos un formato');
    if (ex.dest === 'folder' && !ex.folder) return toast('Elige la carpeta de destino');
    const items = ex.scope === 'all' ? S.items.slice() : [S.items[S.cur]];
    if (!items[0]) return;
    if (ex.dest === 'overwrite' && S.settings.confirmOverwrite) {
      const r = await window.api.confirm({ message: 'Vas a sobrescribir ' + (items.length === 1 ? 'la foto original' : items.length + ' fotos originales') + '.', detail: 'Antes de escribir, el primer original se guarda en la carpeta «_originales_verex» junto a cada foto.', buttons: ['Sobrescribir', 'Cancelar'] });
      if (r !== 0) return;
    }
    const cq = S.result && S.result.qc;
    if (ex.scope === 'current' && S.settings.qcWarn && cq && cq.warnings.length) {
      const r = await window.api.confirm({ message: 'El control de calidad detectó ' + cq.warnings.length + (cq.warnings.length === 1 ? ' aviso' : ' avisos') + '.', detail: cq.warnings.map((w) => '• ' + w.text).join('\n'), buttons: ['Exportar de todas formas', 'Revisar'] });
      if (r !== 0) return;
    }

    const params = clone(S.params); batch.running = true; batch.cancel = false;
    $('#ex-progress').hidden = false; $('#pg-log').innerHTML = ''; $('#ex-go').disabled = true; $('#ex-cancel').textContent = 'Cancelar'; $('#ex-open').hidden = true;
    const total = items.length; let done = 0, ok = 0, err = 0, warn = 0, lastOut = null; const t0 = performance.now(); let next = 0;
    const lanes = Math.min(total, ex.scope === 'all' ? S.settings.threads : 1);
    batch.workers = Array.from({ length: lanes }, () => new Worker('worker.js'));
    const upd = (cur) => {
      $('#pg-bar').style.width = (done / total) * 100 + '%'; $('#pg-num').textContent = done + ' / ' + total; $('#pg-ok').textContent = ok; $('#pg-err').textContent = err; $('#pg-warn').textContent = warn;
      if (cur) $('#pg-cur').textContent = cur;
      const el_ = (performance.now() - t0) / 1000; $('#pg-eta').textContent = done ? fmtTime((el_ / done) * (total - done)) : 'calculando…';
    };
    upd('—');
    await Promise.all(batch.workers.map(async (w) => {
      while (!batch.cancel) {
        const idx = next++; if (idx >= total) break;
        const it = items[idx]; upd(it.name);
        try {
          const r = await processItem(it, w, params, fmts, ex); ok++; lastOut = r.outs[r.outs.length - 1];
          it.status = r.warnings.length ? 'warn' : 'ok';
          if (r.warnings.length) { warn++; logLine('w', '⚠ ' + it.name + ': ' + r.warnings.map((x) => x.text).join(' | ')); } else logLine('o', '✓ ' + it.name);
        } catch (e) { err++; it.status = 'err'; logLine('e', '✕ ' + it.name + ': ' + (e.message || e)); }
        done++; upd(); const dot = $('.file[data-id="' + it.id + '"] .dot'); if (dot) dot.className = 'dot ' + it.status;
      }
    }));
    batch.workers.forEach((w) => w.terminate()); batch.workers = []; batch.running = false;
    upd(batch.cancel ? 'Cancelado' : 'Terminado');
    logLine(err ? 'e' : 'o', (batch.cancel ? 'Cancelado. ' : 'Listo. ') + ok + ' completadas, ' + err + ' con error, ' + warn + ' con avisos · ' + fmtTime((performance.now() - t0) / 1000));
    $('#ex-go').disabled = false; $('#ex-go').textContent = 'Exportar de nuevo'; $('#ex-cancel').textContent = 'Cerrar';
    if (lastOut) { $('#ex-open').hidden = false; $('#ex-open').onclick = () => window.api.showItem(lastOut); }
    S.settings.last = { params: S.params, presetName: S.presetName, exp: S.exp }; persistSettings();
  }

  $('#ex-go').addEventListener('click', runExport);
  $('#ex-cancel').addEventListener('click', () => { if (batch.running) { batch.cancel = true; logLine('w', 'Cancelando… termina la imagen en curso.'); } else dlg.hidden = true; });
  dlg.querySelector('[data-close].x').addEventListener('click', () => { if (batch.running) { batch.cancel = true; } dlg.hidden = true; });

  // ───────────────────────── Configuración ─────────────────────────
  const sdlg = $('#dlg-settings');
  function openSettings() {
    $('#set-preview').value = String(S.settings.previewMax); $('#set-confirm').checked = S.settings.confirmOverwrite; $('#set-qcwarn').checked = S.settings.qcWarn;
    const th = $('#set-threads'); th.innerHTML = ''; for (let i = 1; i <= Math.max(2, navigator.hardwareConcurrency || 4); i++) th.append(new Option(i + (i === 1 ? ' (más ligero)' : ''), i));
    th.value = S.settings.threads; window.api.version().then((v) => ($('#set-ver').textContent = 'v' + v)); sdlg.hidden = false;
  }
  function closeSettings() {
    S.settings.previewMax = +$('#set-preview').value; S.settings.threads = +$('#set-threads').value;
    S.settings.confirmOverwrite = $('#set-confirm').checked; S.settings.qcWarn = $('#set-qcwarn').checked; persistSettings(); sdlg.hidden = true; afterParamsChanged();
  }
  $('#btn-settings').addEventListener('click', openSettings);
  $$('[data-close]', sdlg).forEach((b) => b.addEventListener('click', closeSettings));

  // ───────────────────────── Eventos generales ─────────────────────────
  $('#btn-open').addEventListener('click', async () => addPaths(await window.api.openImages()));
  $('#btn-open2').addEventListener('click', async () => addPaths(await window.api.openImages()));
  $('#btn-add-folder').addEventListener('click', async () => { const f = await window.api.chooseFolder('Carpeta con fotografías'); if (f) addPaths([f]); });
  $('#btn-remove').addEventListener('click', removeCurrent);
  $('#btn-clear').addEventListener('click', clearAll);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-restore').addEventListener('click', restoreOriginal);
  $('#btn-export').addEventListener('click', openExport);
  window.api.onOpenFiles((p) => addPaths(p));

  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
    addPaths(Array.from(e.dataTransfer.files || []).map((f) => window.api.pathForFile(f)).filter(Boolean));
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox' && e.target.type !== 'radio';
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (k === 'o') { e.preventDefault(); window.api.openImages().then(addPaths); }
      else if (k === 'e') { e.preventDefault(); openExport(); }
      else if (k === '0') { e.preventDefault(); setZoom('fit'); } else if (k === '1') { e.preventDefault(); setZoom(1); }
      return;
    }
    if (typing || !dlg.hidden || !sdlg.hidden) return;
    if (e.key === '\\') { if (!S.view.hold) { S.view.hold = true; updateCompare(); } }
    else if (e.key === 'ArrowDown' && S.cur < S.items.length - 1) { e.preventDefault(); selectItem(S.cur + 1); }
    else if (e.key === 'ArrowUp' && S.cur > 0) { e.preventDefault(); selectItem(S.cur - 1); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === '\\') { S.view.hold = false; updateCompare(); } });
  window.addEventListener('error', (e) => toast('Error: ' + e.message, 6000));
  window.addEventListener('unhandledrejection', (e) => toast('Error: ' + ((e.reason && e.reason.message) || e.reason), 6000));

  // ───────────────────────── Arranque ─────────────────────────
  async function boot() {
    try { const saved = await window.api.loadSettings(); Object.assign(S.settings, saved || {}); S.settings.userPresets = S.settings.userPresets || {}; } catch (_) { /* primer arranque */ }
    const last = S.settings.last;
    if (last && last.params) { S.params = PR.merge(PR.NEUTRAL, last.params); S.presetName = last.presetName || null; if (last.exp) S.exp = Object.assign(S.exp, last.exp, { scope: 'current' }); }
    else S.params = PR.presetParams(PR.DEFAULT_PRESET, S.settings.userPresets);
    buildControls(); refreshAll(); commit('Inicio'); updateCompare();
    window.__vx = { S, addPaths, PR }; // depuración y pruebas de interfaz
  }
  boot();
})();
