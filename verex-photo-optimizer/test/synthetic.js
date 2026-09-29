'use strict';
// Foto sintética de "joyería": fondo con gradiente + ruido + motas, anillo plateado con piedra y grabado.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function make(w, h, opts = {}) {
  const rnd = rng(opts.seed || 7), data = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2, cy = h / 2, R0 = Math.min(w, h) * 0.30, R1 = R0 * 0.72;
  const gold = !!opts.gold;
  const isProduct = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    let v = 238 + 10 * (x / w) - 6 * (y / h);              // gradiente de iluminación
    let R = v, G = v, B = v;
    if (r < R0 && r > R1) {                                 // aro
      const t = (r - R1) / (R0 - R1), a = Math.atan2(dy, dx);
      let l = 90 + 120 * Math.abs(Math.sin(a * 2 + t * 3)) * (0.5 + 0.5 * Math.sin(t * Math.PI));
      l += 12 * Math.sin(a * 40);                            // grabado fino
      if (gold) { R = l * 1.0; G = l * 0.82; B = l * 0.42; } else { R = l; G = l * 1.0; B = l * 1.03; }
      isProduct[i] = 1;
    }
    if (Math.hypot(dx, dy + R0 * 1.05) < R0 * 0.22) {       // piedra facetada arriba
      const a = Math.atan2(dy + R0 * 1.05, dx), f = 120 + 110 * Math.abs(Math.sin(a * 3));
      R = f * 0.95; G = f * 0.98; B = f; isProduct[i] = 1;
    }
    const n = (rnd() - 0.5) * (opts.noise ?? 8);
    data[i * 4] = R + n; data[i * 4 + 1] = G + n * 0.9 + (rnd() - 0.5) * 3; data[i * 4 + 2] = B + n * 0.9 + (rnd() - 0.5) * 3; data[i * 4 + 3] = 255;
  }
  // motas en el fondo
  for (let k = 0; k < 12; k++) {
    const sx = (rnd() * w) | 0, sy = (rnd() * h) | 0, i0 = sy * w + sx;
    if (isProduct[i0] || Math.hypot(sx - cx, sy - cy) < R0 * 1.3) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = ((sy + dy) * w + sx + dx) * 4; data[i] -= 25; data[i + 1] -= 25; data[i + 2] -= 25; }
  }
  return { width: w, height: h, data, isProduct };
}
module.exports = { make };
