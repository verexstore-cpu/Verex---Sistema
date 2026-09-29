'use strict';
const assert = require('assert');
const VXP = require('../src/core/pipeline.js');
const PR = require('../src/core/presets.js');
const { make } = require('./synthetic.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log('  ✓', name); pass++; } catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; } }
const W = 800, H = 800;
const img = make(W, H);
const clone = (i) => ({ width: i.width, height: i.height, data: new Uint8ClampedArray(i.data) });

console.log('Motor VEREX — pruebas de fidelidad\n');

t('neutral = imagen idéntica byte a byte', () => {
  const r = VXP.process(clone(img), PR.NEUTRAL, {});
  assert(Buffer.compare(Buffer.from(r.data), Buffer.from(img.data)) === 0, "difieren");
});

t('es determinista (mismos parámetros → mismo resultado)', () => {
  const p = PR.presetParams('VEREX PROFESSIONAL');
  const a = VXP.process(clone(img), p, {}), b = VXP.process(clone(img), p, {});
  assert(Buffer.compare(Buffer.from(a.data), Buffer.from(b.data)) === 0, "difieren");
});

t('no muta la imagen de entrada (el original nunca se modifica)', () => {
  const src = clone(img), before = Buffer.from(src.data);
  VXP.process(src, PR.presetParams('VEREX PROFESSIONAL'), {});
  assert(Buffer.compare(Buffer.from(src.data), before) === 0, "entrada mutada");
});

t('detección: la máscara cubre el aro y la piedra, no el fondo', () => {
  const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) { R[i] = img.data[i * 4]; G[i] = img.data[i * 4 + 1]; B[i] = img.data[i * 4 + 2]; }
  const d = VXP.detectProduct(R, G, B, W, H);
  let inP = 0, inHit = 0, bgN = 0, bgHit = 0;
  for (let i = 0; i < W * H; i++) {
    if (img.isProduct[i]) { inP++; if (d.mask[i] > 0.9) inHit++; }
    else { const x = i % W, y = (i / W) | 0; if (Math.hypot(x - W / 2, y - H / 2) > W * 0.42) { bgN++; if (d.mask[i] > 0.1) bgHit++; } }
  }
  console.log(`      producto detectado ${(inHit / inP * 100).toFixed(1)} %, fondo lejano marcado como producto ${(bgHit / bgN * 100).toFixed(2)} %`);
  assert(inHit / inP > 0.97); assert(bgHit / bgN < 0.02);
});

t('SOLO fondo: el producto queda intacto (≥ 99.4 % de sus píxeles idénticos)', () => {
  // Límite honesto: metal casi idéntico al color del fondo no se puede separar por color/bordes.
  const p = PR.merge(PR.NEUTRAL, { bg: { optimize: true, pureWhite: true, clean: 90, uniform: 100, whiten: 100 } });
  const r = VXP.process(clone(img), p, {});
  let changed = 0, total = 0, strong = 0;
  for (let i = 0; i < W * H; i++) if (img.isProduct[i]) {
    total++;
    let d = 0; for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(r.data[i * 4 + c] - img.data[i * 4 + c]));
    if (d > 0) changed++; if (d > 12) strong++;
  }
  console.log(`      píxeles de producto modificados: ${changed}/${total} (${(changed / total * 100).toFixed(2)} %), cambios > 12 niveles: ${strong}`);
  assert(changed / total < 0.006); assert(strong / total < 0.004);
});

t('fondo #FFFFFF: el fondo lejano queda exactamente blanco y sin motas', () => {
  const p = PR.presetParams('VEREX ECOMMERCE');
  const r = VXP.process(clone(img), p, {});
  let bad = 0, n = 0;
  for (let i = 0; i < W * H; i++) { const x = i % W, y = (i / W) | 0; if (Math.hypot(x - W / 2, y - H / 2) > W * 0.42) { n++; if (r.data[i * 4] < 254 || r.data[i * 4 + 1] < 254 || r.data[i * 4 + 2] < 254) bad++; } }
  console.log(`      fondo no blanco: ${bad}/${n}`);
  assert(bad / n < 0.002);
});

for (const name of PR.ORDER) {
  t(`${name}: estructura intacta, sin halos, sin clipping, color estable`, () => {
    const pp = PR.presetParams(name);
    const r = VXP.process(clone(img), pp, { analyze: true });
    const m = r.qc.metrics;
    console.log(`      estructura ${(m.structure * 100).toFixed(1)} % · detalle ${(m.detailRatio * 100).toFixed(0)} % · halos ${((m.haloRatio || 0) * 100).toFixed(2)} % · clip +${(m.clipIncrease * 100).toFixed(2)} % · sat ×${m.satRatio.toFixed(2)} · ΔC ${m.colorShift.toFixed(1)} · ${r.info.ms.total} ms`);
    assert(m.structure > 0.97, 'estructura'); assert(m.detailRatio > 0.9, 'detalle');
    assert((m.haloRatio || 0) < 0.02, 'halos'); assert(m.clipIncrease < 0.006, 'clip');
    assert(r.qc.warnings.length === 0, 'advertencias: ' + r.qc.warnings.map((w) => w.text).join(' | '));
  });
}

t('la nitidez sube el microdetalle sin superar el rango local (anti-halo)', () => {
  const p = PR.merge(PR.NEUTRAL, { sharpness: 80 });
  const r = VXP.process(clone(img), p, { analyze: true });
  assert(r.qc.metrics.detailRatio > 1.05, 'detalle ' + r.qc.metrics.detailRatio);
  assert(r.qc.metrics.haloRatio < 0.01, 'halo ' + r.qc.metrics.haloRatio);
});

t('reducción de ruido baja el ruido del fondo y conserva bordes', () => {
  const noisy = make(W, H, { noise: 22, seed: 3 });
  const p = PR.merge(PR.NEUTRAL, { denoise: 60 });
  const r = VXP.process(clone(noisy), p, { analyze: true });
  const sd = (buf) => { let s = 0, s2 = 0, n = 0; for (let y = 20; y < 120; y++) for (let x = 20; x < 120; x++) { const v = buf[(y * W + x) * 4]; s += v; s2 += v * v; n++; } return Math.sqrt(s2 / n - (s / n) ** 2); };
  const a = sd(noisy.data), b = sd(r.data);
  console.log(`      desviación del fondo ${a.toFixed(2)} → ${b.toFixed(2)} · estructura ${(r.qc.metrics.structure * 100).toFixed(1)} %`);
  assert(b < a * 0.7); assert(r.qc.metrics.structure > 0.97);
});

t('JOYERÍA VEREX oro: la temperatura extrema no vuelve el oro naranja', () => {
  const g = make(W, H, { gold: true });
  const extreme = { temperature: 100, saturation: 100, vibrance: 100, jewelry: { on: true, metal: 'gold', protect: 90 } };
  const hue = (buf, mask) => { let r = 0, gg = 0, b = 0, n = 0; for (let i = 0; i < W * H; i++) if (mask[i]) { r += buf[i * 4]; gg += buf[i * 4 + 1]; b += buf[i * 4 + 2]; n++; } return [r / n, gg / n, b / n]; };
  const withG = VXP.process(clone(g), PR.merge(PR.NEUTRAL, extreme), {});
  const noG = VXP.process(clone(g), PR.merge(PR.NEUTRAL, Object.assign({}, extreme, { jewelry: { on: false } })), {});
  const o = hue(g.data, g.isProduct), a = hue(withG.data, g.isProduct), b = hue(noG.data, g.isProduct);
  const ratio = (c) => c[1] / c[0];  // G/R: menor = más naranja
  console.log(`      G/R original ${ratio(o).toFixed(3)} · con guarda ${ratio(a).toFixed(3)} · sin guarda ${ratio(b).toFixed(3)}`);
  assert(Math.abs(ratio(a) - ratio(o)) < Math.abs(ratio(b) - ratio(o)) * 0.6);
});

t('metal automático: plata con tinte amarillento en toda la foto NO se detecta como oro', () => {
  const cast = (im, r, g, b) => { const c = clone(im); for (let i = 0; i < c.data.length; i += 4) { c.data[i] = Math.min(255, c.data[i] * r); c.data[i + 1] = Math.min(255, c.data[i + 1] * g); c.data[i + 2] = Math.min(255, c.data[i + 2] * b); } return c; };
  const auto = PR.merge(PR.NEUTRAL, { sharpness: 30, jewelry: { on: true, metal: 'auto', protect: 75 } });
  const det = (im) => VXP.process(im, auto, {}).info.metal;
  const silverWarm = cast(img, 1.07, 1.05, 0.80), goldWhite = make(W, H, { gold: true }), goldWarm = cast(make(W, H, { gold: true }), 1.07, 1.05, 0.80);
  const r = [det(clone(img)), det(silverWarm), det(clone(goldWhite)), det(goldWarm)];
  console.log('      plata neutra → ' + r[0] + ' · plata con tinte → ' + r[1] + ' · oro neutro → ' + r[2] + ' · oro con tinte → ' + r[3]);
  assert.deepStrictEqual(r, ['silver', 'silver', 'gold', 'gold']);
});

t('plata: con guarda la plata no pasa a blanco puro/gris', () => {
  const p = PR.merge(PR.NEUTRAL, { saturation: -100, jewelry: { on: true, metal: 'silver', protect: 90 } });
  const r = VXP.process(clone(img), p, {});
  let cO = 0, cN = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (img.isProduct[i]) { cO += Math.abs(img.data[i * 4 + 2] - img.data[i * 4]); cN += Math.abs(r.data[i * 4 + 2] - r.data[i * 4]); n++; }
  console.log(`      croma medio R–B: original ${(cO / n).toFixed(2)} · resultado ${(cN / n).toFixed(2)}`);
  assert(cN / n > 0.5 * cO / n);
});

t('tamaño y padding: lienzo cuadrado sin escalar el producto', () => {
  const small = make(600, 400);
  const r = VXP.process(clone(small), PR.presetParams('VEREX ECOMMERCE'), { pad: { width: 800, height: 800 } });
  assert.strictEqual(r.width, 800); assert.strictEqual(r.height, 800);
  assert.strictEqual(r.data[0], 255); assert.strictEqual(r.data[3], 255);
});

t('intensidad 0 → sin cambios apreciables', () => {
  const p = Object.assign(PR.presetParams('VEREX PROFESSIONAL'), { intensity: 0 });
  const r = VXP.process(clone(img), p, {});
  let maxd = 0; for (let i = 0; i < r.data.length; i++) if (i % 4 !== 3) maxd = Math.max(maxd, Math.abs(r.data[i] - img.data[i]));
  console.log(`      diferencia máxima por canal: ${maxd}`);
  assert(maxd <= 12);
});

t('valores extremos disparan advertencias del control de calidad', () => {
  const p = PR.merge(PR.NEUTRAL, { sharpness: 100, denoise: 100, saturation: 100, exposure: 60, intensity: 100, fidelity: 0 });
  const r = VXP.process(clone(img), p, { analyze: true });
  console.log('      ' + r.qc.warnings.map((w) => w.id).join(', '));
  assert(r.qc.warnings.length >= 1);
});

t('rendimiento: 1600×1600 con ECOMMERCE', () => {
  const big = make(1600, 1600);
  const t0 = Date.now(); VXP.process(clone(big), PR.presetParams('VEREX ECOMMERCE'), { analyze: true });
  const ms = Date.now() - t0; console.log(`      ${ms} ms`); assert(ms < 20000);
});

console.log(`\n${pass} correctas, ${fail} con fallo`);
process.exit(fail ? 1 : 0);
