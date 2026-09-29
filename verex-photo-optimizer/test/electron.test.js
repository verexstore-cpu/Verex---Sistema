'use strict';
// Prueba de humo con Electron REAL (main.js + preload + disco). Ejecutar: xvfb-run -a node test/electron.test.js
const { _electron } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let pass = 0, fail = 0; const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); c ? pass++ : fail++; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-'));
  const src = path.join(tmp, 'fotos'), out = path.join(tmp, 'salida'); fs.mkdirSync(src);
  for (const f of ['anillo-plata.png', 'anillo-oro.png']) fs.copyFileSync(path.join(__dirname, 'fixtures', f), path.join(src, f));
  const orig = Object.fromEntries(fs.readdirSync(src).map((f) => [f, sha(path.join(src, f))]));
  const userData = path.join(tmp, 'ud');
  const app = await _electron.launch({ executablePath: require(path.join(root, 'node_modules/electron')), args: [root, '--no-sandbox', '--user-data-dir=' + userData] });
  const page = await app.firstWindow(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  console.log('Electron real — pruebas de humo\n');
  await page.waitForFunction(() => window.__vx && window.api);
  ok(await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined'), 'la página no tiene acceso a Node (aislamiento de contexto)');
  ok((await page.title()) === 'VEREX PHOTO OPTIMIZER', 'título de la ventana');

  await page.evaluate((d) => __vx.addPaths([d]), src);            // carpeta → main.js la expande
  await page.waitForSelector('#stage:not([hidden])');
  await page.waitForFunction(() => document.querySelector('#busy').hidden && __vx.S.result, null, { timeout: 90000 });
  ok((await page.locator('.file').count()) === 2, 'agregar carpeta: 2 fotos encontradas');
  const worker = await page.evaluate(() => __vx.S.result.info.ms.total > 0); ok(worker, 'worker procesó la vista previa (bajo file://)');
  await page.click('.preset[data-name="VEREX ECOMMERCE"]'); await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 60000 }); await page.waitForTimeout(200);
  await page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + '/electron.png' : path.join(tmp, 'electron.png') });

  const run = async (dest, scope, extra) => {
    await page.evaluate(([dest, out, scope]) => { __vx.S.settings.confirmOverwrite = false; __vx.S.exp.folder = out; }, [dest, out, scope]);
    await page.click('#btn-export');
    await page.check('input[name=scope][value=' + scope + ']'); await page.check('input[name=dest][value=' + dest + ']');
    await page.uncheck('#ex-png'); await page.check('#ex-jpg'); await page.check('#ex-webp');
    await page.click('#ex-go'); await page.waitForFunction(() => /Terminado/.test(document.querySelector('#pg-cur').textContent), null, { timeout: 120000 });
    const errsN = await page.locator('#pg-err').innerText(); await page.click('#ex-cancel'); return errsN;
  };

  // 1) carpeta
  ok((await run('folder', 'all')) === '0', 'exportar a carpeta sin errores');
  const outFiles = fs.readdirSync(out).sort(); console.log('      ' + outFiles.join(', '));
  ok(outFiles.join() === 'anillo-oro.jpg,anillo-oro.webp,anillo-plata.jpg,anillo-plata.webp', 'nombres: producto.jpg + producto.webp por foto');
  const head = (f, n) => fs.readFileSync(path.join(out, f)).subarray(0, n);
  ok(head('anillo-oro.jpg', 2).equals(Buffer.from([0xff, 0xd8])) && head('anillo-plata.webp', 4).toString() === 'RIFF', 'JPG y WEBP válidos en disco');
  const kb = fs.statSync(path.join(out, 'anillo-plata.webp')).size / 1024; console.log('      peso webp 1600×1600: ' + kb.toFixed(0) + ' KB');
  ok(Object.entries(orig).every(([f, h]) => sha(path.join(src, f)) === h), 'originales intactos tras exportar a carpeta');

  // 2) copia junto al original
  ok((await run('copy', 'current')) === '0', 'crear copia sin errores');
  const cur = await page.evaluate(() => __vx.S.items[__vx.S.cur].name.replace(/\.[^.]+$/, ''));
  ok(fs.existsSync(path.join(src, cur + '_verex.jpg')) && fs.existsSync(path.join(src, cur + '_verex.webp')), 'copias con sufijo _verex junto al original');
  await run('copy', 'current'); ok(fs.existsSync(path.join(src, cur + '_verex (2).jpg')), 'segunda copia no pisa la primera: numera (2)');
  ok(Object.entries(orig).every(([f, h]) => sha(path.join(src, f)) === h), 'originales intactos tras crear copias');

  // 3) sobrescribir (JPG sobre PNG cambia extensión; forzamos formato PNG para pisar el mismo archivo)
  await page.evaluate(() => { __vx.S.params.output.format = 'png'; });
  await page.click('#btn-export'); await page.check('input[name=scope][value=current]'); await page.check('input[name=dest][value=overwrite]');
  await page.uncheck('#ex-jpg'); await page.uncheck('#ex-webp'); await page.check('#ex-png'); await page.click('#ex-go');
  await page.waitForFunction(() => /Terminado/.test(document.querySelector('#pg-cur').textContent), null, { timeout: 120000 }); await page.click('#ex-cancel');
  const bak = path.join(src, '_originales_verex', cur + '.png');
  ok(fs.existsSync(bak) && sha(bak) === orig[cur + '.png'], 'sobrescribir: copia de seguridad idéntica al original en _originales_verex');
  ok(sha(path.join(src, cur + '.png')) !== orig[cur + '.png'], 'sobrescribir: el archivo original fue reemplazado por el resultado');

  ok(fs.existsSync(path.join(userData, 'verex-photo-optimizer.json')), 'ajustes guardados en la carpeta de usuario');
  ok(errs.length === 0, 'sin errores de consola' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await app.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} correctas, ${fail} con fallo`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
