'use strict';
// Prueba de interfaz en Chromium real: sirve src/ por HTTP local y simula window.api (sin Electron).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = u.startsWith('/fx/') ? path.join(__dirname, 'fixtures', u.slice(4)) : path.join(__dirname, '..', 'src', u === '/' ? 'index.html' : u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
});
let pass = 0, fail = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? pass++ : fail++; };

(async () => {
  await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__written = []; window.__confirms = [];
    window.api = {
      pathForFile: () => '', openImages: async () => [], chooseFolder: async () => 'C:\\Salida',
      expandPaths: async (p) => p, readFile: async (p) => new Uint8Array(await (await fetch('/fx/' + p)).arrayBuffer()),
      exportWrite: async (j) => { window.__written.push({ src: j.srcPath, ext: j.ext, mode: j.mode, size: j.data.length, head: Array.from(j.data.slice(0, 12)) }); return 'C:\\Salida\\' + j.srcPath + j.ext; },
      showItem: async () => {}, loadSettings: async () => ({}), saveSettings: async () => true, confirm: async (o) => { window.__confirms.push(o); return 0; },
      version: async () => '1.0.0', onOpenFiles: () => {},
    };
  });
  await page.goto('http://localhost:' + port + '/');
  console.log('Interfaz VEREX — pruebas en Chromium\n');
  const waitIdle = () => page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 }).then(() => page.waitForTimeout(150));

  ok(await page.locator('#empty').isVisible(), 'pantalla vacía con zona para arrastrar');
  ok((await page.locator('.preset').count()) === 8, '8 presets visibles (incluye VEREX TIENDA)');
  await page.screenshot({ path: SHOTS + '/1-vacio.png' });

  await page.evaluate(() => __vx.addPaths(['anillo-plata.png', 'anillo-oro.png', 'producto03.png']));
  await page.waitForSelector('#stage:not([hidden])'); await waitIdle();
  ok((await page.locator('.file').count()) === 3, 'lista con 3 fotos');
  ok(await page.locator('#cv-after').evaluate((c) => c.width > 100 && c.height > 100), 'vista previa renderizada');
  const dimsPro = await page.locator('#cv-after').evaluate((c) => [c.width, c.height]); console.log('      lienzo:', dimsPro.join('×'));
  await page.screenshot({ path: SHOTS + '/2-profesional.png' });
  ok(await page.locator('#qc').innerText().then((t) => /Integridad estructural/.test(t)), 'panel de control de calidad con métricas');

  // ECOMMERCE → 1600×1600, fondo blanco
  await page.click('.preset[data-name="VEREX ECOMMERCE"]'); await page.waitForTimeout(700); await waitIdle();   // la vista previa se recalcula tras una pausa breve
  const dimsE = await page.locator('#cv-after').evaluate((c) => [c.width, c.height]);
  ok(dimsE[0] === 1600 && dimsE[1] === 1600 || dimsE[0] === dimsE[1], 'ECOMMERCE: lienzo cuadrado ' + dimsE.join('×') + ' (preview capado a la resolución de vista previa)');
  const corner = await page.locator('#cv-after').evaluate((c) => Array.from(c.getContext('2d').getImageData(5, 5, 1, 1).data));
  ok(corner[0] === 255 && corner[1] === 255 && corner[2] === 255, 'ECOMMERCE: fondo #FFFFFF → ' + corner.slice(0, 3));
  await page.screenshot({ path: SHOTS + '/3-ecommerce.png' });

  // Comparación
  const knob = page.locator('.divider .knob'); const kb = await knob.boundingBox();
  await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2); await page.mouse.down(); await page.mouse.move(kb.x - 200, kb.y + kb.height / 2, { steps: 5 }); await page.mouse.up();
  const pos = await page.evaluate(() => __vx.S.view.pos); ok(pos < 45, 'slider ANTES/DESPUÉS arrastrable (pos ' + pos.toFixed(0) + ' %)');
  await page.screenshot({ path: SHOTS + '/4-comparacion.png' });
  await page.click('#seg-view [data-mode="split-v"]'); ok(await page.locator('#divider.v').count() === 1, 'divisor horizontal disponible');
  await page.click('#seg-view [data-mode="split-h"]');
  await page.click('#btn-flip'); ok(await page.evaluate(() => __vx.S.view.mode) === 'before', 'botón ANTES / DESPUÉS alterna');
  await page.click('#btn-flip');

  // Zoom
  for (const z of ['0.25', '0.5', '1', '2']) {
    await page.click(`#seg-zoom [data-zoom="${z}"]`);
    const w = await page.locator('#stage').evaluate((s) => s.getBoundingClientRect().width); const cw = await page.locator('#cv-after').evaluate((c) => c.width);
    ok(Math.abs(w - cw * parseFloat(z)) < 2, `zoom ${parseFloat(z) * 100}% → ${Math.round(w)} px`);
  }
  await page.screenshot({ path: SHOTS + '/5-zoom200.png' });
  await page.click('#seg-zoom [data-zoom="fit"]');

  // Corrección automática del tinte
  await page.evaluate(() => __vx.addPaths(['anillo-tinte.png']));
  await page.waitForFunction(() => __vx.S.items.length === 4); await page.evaluate(() => document.querySelectorAll('.file')[3].click());
  await page.waitForFunction(() => document.querySelector('#st-name').textContent === 'anillo-tinte.png'); await waitIdle();
  await page.click('.preset[data-name="VEREX PROFESSIONAL"]'); await waitIdle();
  ok(await page.locator('#st-ms').innerText().then((t) => /tinte corregido/.test(t)), 'barra de estado: «tinte corregido» con foto de tinte amarillo-verdoso (' + (await page.locator('#st-ms').innerText()) + ')');
  const spreadOf = (sel) => page.locator(sel).evaluate((c) => { const d = c.getContext('2d').getImageData(20, 20, 60, 60).data; let r = 0, g = 0, b = 0, n = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } const m = [r / n, g / n, b / n]; return (Math.max(...m) - Math.min(...m)) / Math.max(...m); });
  const sb = await spreadOf('#cv-before'), sa = await spreadOf('#cv-after');
  ok(sb > 0.12 && sa < sb / 3, 'fondo (corrección al 80 %): dispersión de color ' + (sb * 100).toFixed(1) + ' % antes → ' + (sa * 100).toFixed(1) + ' % después');
  await page.locator('#seg-view [data-mode="split-h"]').click(); await page.screenshot({ path: SHOTS + '/8-tinte.png' });
  await page.evaluate(() => { const c = [...document.querySelectorAll('details')].find((d) => d.querySelector('summary').textContent === 'COLOR'); c.open = true; });
  const chk = page.locator('label.chk', { hasText: 'CORREGIR TINTE' }).locator('input'); ok(await chk.isChecked(), 'casilla «Corregir tinte» activa en el preset PROFESSIONAL');
  await chk.uncheck(); const quitada = await page.waitForFunction(() => !/tinte corregido/.test(document.querySelector('#st-ms').textContent), null, { timeout: 60000 }).then(() => true).catch(() => false); ok(quitada, 'al desmarcar la casilla se quita la corrección');
  await chk.check(); await page.waitForFunction(() => /tinte corregido/.test(document.querySelector('#st-ms').textContent), null, { timeout: 60000 }); await waitIdle();
  await page.evaluate(() => document.querySelectorAll('.file')[0].click()); await page.waitForFunction(() => document.querySelector('#st-name').textContent === 'anillo-plata.png'); await waitIdle();

  // Sliders + advertencia + historial
  await page.evaluate(() => { const s = document.querySelector('.sl input[type=range]'); s.value = 92; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitIdle();
  ok(await page.locator('.warn-box').isVisible(), 'advertencia de intensidad alta visible');
  ok((await page.locator('.warn-box').innerText()).includes('Valores elevados pueden producir una apariencia poco natural.'), 'texto exacto de la advertencia');
  ok(!(await page.locator('#btn-undo').isDisabled()), 'deshacer disponible'); await page.click('#btn-undo'); await waitIdle();
  ok(!(await page.locator('.warn-box').isVisible()), 'deshacer revierte la intensidad');
  await page.click('#btn-redo'); await page.click('#btn-undo');
  await page.evaluate(() => { window.__prev = __vx.S.result; });
  await page.click('#btn-restore'); await page.waitForFunction(() => __vx.S.result !== window.__prev, null, { timeout: 60000 }); await waitIdle();
  const neutral = await page.evaluate(() => __vx.S.params.sharpness === 0 && !__vx.S.params.bg.optimize);
  ok(neutral, 'Restaurar original quita todos los ajustes');
  const identical = await page.evaluate(() => { const a = document.querySelector('#cv-after').getContext('2d'), b = document.querySelector('#cv-before').getContext('2d'); const W = 400, H = 300; const x = a.getImageData(0, 0, W, H).data, y = b.getImageData(0, 0, W, H).data; for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; });
  ok(identical, 'sin ajustes: DESPUÉS es idéntico a ANTES (píxel a píxel)');
  await page.click('#btn-undo'); await waitIdle();

  // Exportación por lote (2 formatos, 3 fotos)
  await page.click('.preset[data-name="VEREX ECOMMERCE"]'); await page.waitForTimeout(700); await waitIdle();   // la vista previa se recalcula tras una pausa breve
  await page.click('#btn-export'); await page.check('input[name=scope][value=all]'); await page.check('#ex-jpg'); await page.check('#ex-webp');
  await page.check('input[name=dest][value=folder]'); await page.click('#ex-choose');
  const summary = await page.locator('#ex-summary').innerText(); ok(/4 fotos × 2 formatos = 8 archivos/.test(summary), 'resumen de lote: ' + summary.split('\n')[0]);
  await page.screenshot({ path: SHOTS + '/6-exportar.png' });
  await page.click('#ex-go');
  await page.waitForFunction(() => /Terminado/.test(document.querySelector('#pg-cur').textContent), null, { timeout: 120000 });
  const w = await page.evaluate(() => window.__written); const prog = await page.locator('.pg-grid').innerText();
  ok(w.length === 8, 'lote escribió 8 archivos (' + w.map((x) => x.src.replace('.png', '') + x.ext).join(', ') + ')');
  const jpg = w.find((x) => x.ext === '.jpg'), webp = w.find((x) => x.ext === '.webp');
  ok(jpg.head[0] === 0xff && jpg.head[1] === 0xd8, 'JPG válido (cabecera FFD8)'); ok(String.fromCharCode(...webp.head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...webp.head.slice(8, 12)) === 'WEBP', 'WEBP válido (RIFF/WEBP)');
  ok(w.every((x) => x.mode === 'folder'), 'modo carpeta enviado al proceso principal');
  console.log('      ' + prog.replace(/\n/g, ' · ')); await page.screenshot({ path: SHOTS + '/7-lote.png' });
  ok((await page.locator('#pg-err').innerText()) === '0', 'lote sin errores');

  // Exportar 1 foto con sobrescritura → pide confirmación
  await page.click('#ex-cancel'); await page.click('#btn-export'); await page.check('input[name=dest][value=overwrite]'); await page.click('#ex-go');
  await page.waitForFunction(() => /Terminado/.test(document.querySelector('#pg-cur').textContent), null, { timeout: 60000 });
  ok((await page.evaluate(() => window.__confirms.some((c) => /sobrescribir/i.test(c.message)))), 'sobrescribir pide confirmación');
  await page.click('#ex-cancel');

  ok(errors.length === 0, 'sin errores de consola/página' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
