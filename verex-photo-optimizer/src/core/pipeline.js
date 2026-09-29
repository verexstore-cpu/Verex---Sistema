/* VEREX PHOTO OPTIMIZER — motor de edición de imagen.
 *
 * PRINCIPIO: MEJORAR LA FOTO, NO CREAR OTRA FOTO.
 * Todo lo que hay aquí es aritmética sobre los píxeles existentes (filtros,
 * curvas, mezclas). No hay generación ni reconstrucción de imagen, no hay
 * ningún remuestreo geométrico (el redimensionado ocurre ANTES, en la capa de
 * carga) y la detección del producto solo produce una MÁSCARA DE PESO que
 * decide "cuánto" se aplica cada ajuste; nunca produce píxeles.
 *
 * Módulo UMD: corre en el Web Worker de la app y en Node (pruebas).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VXP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ───────────────────────── Filtros base (planos Float32 0..255) ─────────────────────────

  function gaussKernel(sigma) {
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + r] = v; s += v; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    return { k, r };
  }

  function gaussBlur(src, w, h, sigma) {
    const { k, r } = gaussKernel(sigma);
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let a = 0;
        if (x >= r && x < w - r) { for (let j = -r; j <= r; j++) a += src[row + x + j] * k[j + r]; }
        else { for (let j = -r; j <= r; j++) { const xx = x + j < 0 ? 0 : x + j >= w ? w - 1 : x + j; a += src[row + xx] * k[j + r]; } }
        tmp[row + x] = a;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let a = 0;
        if (y >= r && y < h - r) { for (let j = -r; j <= r; j++) a += tmp[(y + j) * w + x] * k[j + r]; }
        else { for (let j = -r; j <= r; j++) { const yy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j; a += tmp[yy * w + x] * k[j + r]; } }
        out[y * w + x] = a;
      }
    }
    return out;
  }

  function boxPass(src, dst, w, h, r, horizontal) {
    const len = horizontal ? w : h, lines = horizontal ? h : w, step = horizontal ? 1 : w;
    const inv = 1 / (2 * r + 1);
    for (let l = 0; l < lines; l++) {
      const base = horizontal ? l * w : l;
      const first = src[base];
      let acc = r * first;
      for (let i = 0; i < r; i++) acc += src[base + Math.min(i, len - 1) * step];
      for (let i = 0; i < len; i++) {
        acc += src[base + Math.min(i + r, len - 1) * step];
        dst[base + i * step] = acc * inv;
        acc -= i - r < 0 ? first : src[base + (i - r) * step];
      }
    }
  }

  /** Aproximación gaussiana con 3 cajas (O(n), para sigmas grandes). */
  function boxBlur3(src, w, h, sigma) {
    const n = 3;
    const wi = Math.sqrt((12 * sigma * sigma) / n + 1);
    let wl = Math.floor(wi); if (wl % 2 === 0) wl--;
    const wu = wl + 2;
    const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
    let a = Float32Array.from(src), b = new Float32Array(w * h);
    for (let i = 0; i < n; i++) {
      const r = ((i < m ? wl : wu) - 1) >> 1;
      boxPass(a, b, w, h, r, true);
      boxPass(b, a, w, h, r, false);
    }
    return a;
  }

  function blur(src, w, h, sigma) {
    return sigma <= 3 ? gaussBlur(src, w, h, sigma) : boxBlur3(src, w, h, sigma);
  }

  /** Mínimo/máximo local (ventana cuadrada de radio r), separable. */
  function minMax(src, w, h, r) {
    const mn1 = new Float32Array(w * h), mx1 = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let lo = 1e9, hi = -1e9;
        const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
        for (let xx = a; xx <= b; xx++) { const v = src[row + xx]; if (v < lo) lo = v; if (v > hi) hi = v; }
        mn1[row + x] = lo; mx1[row + x] = hi;
      }
    }
    const mn = new Float32Array(w * h), mx = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let lo = 1e9, hi = -1e9;
        const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
        for (let yy = a; yy <= b; yy++) { const i = yy * w + x; if (mn1[i] < lo) lo = mn1[i]; if (mx1[i] > hi) hi = mx1[i]; }
        mn[y * w + x] = lo; mx[y * w + x] = hi;
      }
    }
    return { mn, mx };
  }

  /** Bilateral guiado (preserva bordes): filtra P usando G como guía. */
  function bilateral(P, G, w, h, radius, sigmaS, sigmaR) {
    const out = new Float32Array(w * h);
    const size = 2 * radius + 1;
    const sw = new Float32Array(size * size);
    for (let j = -radius; j <= radius; j++) for (let i = -radius; i <= radius; i++)
      sw[(j + radius) * size + i + radius] = Math.exp(-(i * i + j * j) / (2 * sigmaS * sigmaS));
    const lut = new Float32Array(256);
    for (let d = 0; d < 256; d++) lut[d] = Math.exp(-(d * d) / (2 * sigmaR * sigmaR));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = y * w + x, gc = G[c];
        let acc = 0, wsum = 0;
        for (let j = -radius; j <= radius; j++) {
          const yy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j;
          for (let i = -radius; i <= radius; i++) {
            const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
            const n = yy * w + xx;
            const d = G[n] - gc;
            const ad = d < 0 ? -d : d;
            const wt = sw[(j + radius) * size + i + radius] * lut[ad > 255 ? 255 : (ad + 0.5) | 0];
            acc += P[n] * wt; wsum += wt;
          }
        }
        out[c] = acc / wsum;
      }
    }
    return out;
  }

  function downsample(plane, w, h, f) {
    const sw = Math.ceil(w / f), sh = Math.ceil(h / f);
    const out = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      let a = 0, n = 0;
      const y1 = Math.min(h, (y + 1) * f), x1 = Math.min(w, (x + 1) * f);
      for (let yy = y * f; yy < y1; yy++) for (let xx = x * f; xx < x1; xx++) { a += plane[yy * w + xx]; n++; }
      out[y * sw + x] = a / n;
    }
    return { data: out, w: sw, h: sh };
  }

  function upsample(plane, sw, sh, w, h) {
    const out = new Float32Array(w * h);
    const fx = sw / w, fy = sh / h;
    for (let y = 0; y < h; y++) {
      const sy = clamp((y + 0.5) * fy - 0.5, 0, sh - 1);
      const y0 = sy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = sy - y0;
      for (let x = 0; x < w; x++) {
        const sx = clamp((x + 0.5) * fx - 0.5, 0, sw - 1);
        const x0 = sx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = sx - x0;
        const a = plane[y0 * sw + x0], b = plane[y0 * sw + x1], c = plane[y1 * sw + x0], d = plane[y1 * sw + x1];
        out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      }
    }
    return out;
  }

  function median(arr) { const a = Array.from(arr).sort((x, y) => x - y); return a[a.length >> 1]; }

  // ───────────────────────── Detección del producto (solo una máscara de peso) ─────────────────────────

  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < hist.length; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, thr = 0;
    for (let i = 0; i < hist.length; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sB += i * hist[i];
      const mB = sB / wB, mF = (sum - sB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = i; }
    }
    return thr;
  }

  /**
   * Estima qué es producto y qué es fondo. Método clásico (sin IA generativa):
   * color de fondo desde el borde → modelo de iluminación suave → umbral Otsu
   * → limpieza morfológica. Devuelve:
   *   mask   Float32 0..1 (1 = producto, con margen de protección alrededor)
   *   bgR/G/B  modelo de iluminación del fondo a resolución completa
   *   bgColor  color medio del fondo
   */
  function detectProduct(R, G, B, w, h) {
    const f = Math.max(1, Math.ceil(Math.max(w, h) / 640));
    const n0 = w * h;
    const Y0 = new Float32Array(n0), Cb0 = new Float32Array(n0), Cr0 = new Float32Array(n0);
    for (let i = 0; i < n0; i++) {
      const y = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
      Y0[i] = y; Cb0[i] = (B[i] - y) * 0.564; Cr0[i] = (R[i] - y) * 0.713;
    }
    const dY = downsample(Y0, w, h, f), dCb = downsample(Cb0, w, h, f), dCr = downsample(Cr0, w, h, f);
    const sw = dY.w, sh = dY.h, N = sw * sh;
    const Y = dY.data, Cb = dCb.data, Cr = dCr.data;

    // Color de fondo: mediana del anillo exterior.
    const bw = Math.max(2, Math.round(0.02 * Math.min(sw, sh)));
    const ring = { y: [], cb: [], cr: [] };
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      if (x < bw || y < bw || x >= sw - bw || y >= sh - bw) { const i = y * sw + x; ring.y.push(Y[i]); ring.cb.push(Cb[i]); ring.cr.push(Cr[i]); }
    }
    let mY = new Float32Array(N).fill(median(ring.y));
    let mCb = new Float32Array(N).fill(median(ring.cb));
    let mCr = new Float32Array(N).fill(median(ring.cr));

    const dist = new Float32Array(N);
    let bg = new Uint8Array(N), T = 20;
    for (let it = 0; it < 2; it++) {
      const hist = new Float64Array(128); let tot = 0;
      for (let i = 0; i < N; i++) {
        const a = Y[i] - mY[i], b = Cb[i] - mCb[i], c = Cr[i] - mCr[i];
        const d = Math.sqrt(a * a + 1.6 * (b * b + c * c));
        dist[i] = d; hist[Math.min(127, d | 0)]++; tot++;
      }
      T = clamp(otsu(hist, tot), 12, 48);
      for (let i = 0; i < N; i++) bg[i] = dist[i] < T ? 1 : 0;
      // Modelo de iluminación suave a partir de los píxeles de fondo.
      const sg = 0.08 * Math.max(sw, sh);
      const num = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], den = new Float32Array(N);
      for (let i = 0; i < N; i++) { const m = bg[i]; num[0][i] = Y[i] * m; num[1][i] = Cb[i] * m; num[2][i] = Cr[i] * m; den[i] = m; }
      const bn = num.map((p) => boxBlur3(p, sw, sh, sg)), bd = boxBlur3(den, sw, sh, sg);
      const gy = median(ring.y), gcb = median(ring.cb), gcr = median(ring.cr);
      for (let i = 0; i < N; i++) {
        if (bd[i] > 0.02) { mY[i] = bn[0][i] / bd[i]; mCb[i] = bn[1][i] / bd[i]; mCr[i] = bn[2][i] / bd[i]; }
        else { mY[i] = gy; mCb[i] = gcb; mCr[i] = gcr; }
      }
    }

    // Distancia final al modelo de fondo (para proteger píxeles ambiguos y validar huecos).
    for (let i = 0; i < N; i++) {
      const a = Y[i] - mY[i], b = Cb[i] - mCb[i], c = Cr[i] - mCr[i];
      dist[i] = Math.sqrt(a * a + 1.6 * (b * b + c * c));
    }

    // Componentes conexas de producto: quitar motas diminutas (se tratarán como fondo).
    const prod = new Uint8Array(N); for (let i = 0; i < N; i++) prod[i] = bg[i] ? 0 : 1;
    const speck = new Uint8Array(N);
    const label = new Int32Array(N), stack = new Int32Array(N);
    const minArea = Math.max(6, Math.round(0.00004 * N));
    for (let s = 0; s < N; s++) {
      if (!prod[s] || label[s]) continue;
      let sp = 0, cnt = 0; stack[sp++] = s; label[s] = 1; const members = [];
      while (sp) {
        const p = stack[--sp]; cnt++; members.push(p);
        const x = p % sw, y = (p / sw) | 0;
        if (x > 0 && prod[p - 1] && !label[p - 1]) { label[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < sw - 1 && prod[p + 1] && !label[p + 1]) { label[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && prod[p - sw] && !label[p - sw]) { label[p - sw] = 1; stack[sp++] = p - sw; }
        if (y < sh - 1 && prod[p + sw] && !label[p + sw]) { label[p + sw] = 1; stack[sp++] = p + sw; }
      }
      if (cnt < minArea) for (const p of members) { prod[p] = 0; speck[p] = 1; }
    }

    // Motas de bajo contraste: manchas pequeñas y aisladas sobre el fondo (por debajo del umbral de producto).
    {
      const tSpot = Math.max(7, 0.22 * T), spotMax = Math.max(10, Math.round(0.0002 * N));
      const cand = new Uint8Array(N); for (let i = 0; i < N; i++) cand[i] = !prod[i] && dist[i] >= tSpot ? 1 : 0;
      const nearProd = minMax(Float32Array.from(prod), sw, sh, 2).mx;
      const lab2 = new Uint8Array(N);
      for (let s0 = 0; s0 < N; s0++) {
        if (!cand[s0] || lab2[s0]) continue;
        let sp2 = 0, cnt = 0, touches = false; const members = []; stack[sp2++] = s0; lab2[s0] = 1;
        while (sp2 && cnt <= spotMax + 1) {
          const q = stack[--sp2]; cnt++; members.push(q); if (nearProd[q] > 0) touches = true;
          const x = q % sw, y = (q / sw) | 0;
          if (x > 0 && cand[q - 1] && !lab2[q - 1]) { lab2[q - 1] = 1; stack[sp2++] = q - 1; }
          if (x < sw - 1 && cand[q + 1] && !lab2[q + 1]) { lab2[q + 1] = 1; stack[sp2++] = q + 1; }
          if (y > 0 && cand[q - sw] && !lab2[q - sw]) { lab2[q - sw] = 1; stack[sp2++] = q - sw; }
          if (y < sh - 1 && cand[q + sw] && !lab2[q + sw]) { lab2[q + sw] = 1; stack[sp2++] = q + sw; }
        }
        if (cnt <= spotMax && sp2 === 0 && !touches) for (const q of members) speck[q] = 1;
      }
    }

    // Huecos: fondo NO conectado al borde. Los pequeños son brillos/zonas claras del producto
    // (se protegen); los grandes (interior de un anillo, huecos de cadena) son fondo real.
    const reach = new Uint8Array(N); let sp = 0;
    const push = (p) => { if (!prod[p] && !reach[p]) { reach[p] = 1; stack[sp++] = p; } };
    for (let x = 0; x < sw; x++) { push(x); push((sh - 1) * sw + x); }
    for (let y = 0; y < sh; y++) { push(y * sw); push(y * sw + sw - 1); }
    while (sp) {
      const p = stack[--sp]; const x = p % sw, y = (p / sw) | 0;
      if (x > 0) push(p - 1); if (x < sw - 1) push(p + 1); if (y > 0) push(p - sw); if (y < sh - 1) push(p + sw);
    }
    const seen = new Uint8Array(N);
    const holeMax = 0.03 * N;
    for (let s = 0; s < N; s++) {
      if (prod[s] || reach[s] || seen[s]) continue;
      let cnt = 0; const members = []; sp = 0; stack[sp++] = s; seen[s] = 1;
      while (sp) {
        const p = stack[--sp]; cnt++; members.push(p);
        const x = p % sw, y = (p / sw) | 0;
        const tryN = (q) => { if (!prod[q] && !reach[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; } };
        if (x > 0) tryN(p - 1); if (x < sw - 1) tryN(p + 1); if (y > 0) tryN(p - sw); if (y < sh - 1) tryN(p + sw);
      }
      // Un hueco cerrado es fondo real solo si es grande Y coincide casi exactamente con el fondo;
      // un reflejo claro dentro del metal se aparta del modelo de fondo y se protege.
      let md = 0; for (const p of members) md += dist[p]; md /= cnt;
      if (cnt <= holeMax || md > 0.3 * T) for (const p of members) prod[p] = 1;
    }

    // Margen de protección pequeño + borde suave.
    const rd = 1;   // dilatación mínima: el resto de la protección la da la desviación de color y los bordes
    const pf = Float32Array.from(prod);
    const { mx } = minMax(pf, sw, sh, rd);
    const spk = minMax(Float32Array.from(speck), sw, sh, 1).mx;
    const soft = gaussBlur(mx, sw, sh, 0.7);
    // Iluminación de fondo → RGB a resolución completa.
    const bgY = upsample(mY, sw, sh, w, h), bgCb = upsample(mCb, sw, sh, w, h), bgCr = upsample(mCr, sw, sh, w, h);
    const bgR = new Float32Array(n0), bgG = new Float32Array(n0), bgB = new Float32Array(n0);
    for (let i = 0; i < n0; i++) {
      const y = bgY[i], r = y + bgCr[i] / 0.713, b = y + bgCb[i] / 0.564;
      bgR[i] = r; bgB[i] = b; bgG[i] = (y - 0.299 * r - 0.114 * b) / 0.587;
    }
    const mask = upsample(soft, sw, sh, w, h);
    // Protección a resolución completa: cualquier píxel que se aparte del modelo de fondo
    // (metal muy claro, reflejos, bordes suaves) queda protegido aunque el umbral lo viera como fondo.
    const speckFull = new Uint8Array(n0);
    for (let y = 0; y < h; y++) { const srow = ((y / f) | 0) * sw; for (let x = 0; x < w; x++) speckFull[y * w + x] = spk[srow + ((x / f) | 0)] > 0 ? 1 : 0; }
    const prot = new Float32Array(n0);
    for (let i = 0; i < n0; i++) {
      if (speckFull[i]) continue;                                  // motas: se limpian, no se protegen
      const a = Y0[i] - bgY[i], b = Cb0[i] - bgCb[i], c = Cr0[i] - bgCr[i];
      prot[i] = smooth(0.25 * T, 0.6 * T, Math.sqrt(a * a + 1.6 * (b * b + c * c)));
    }
    // Guarda espacial: el fondo real es liso; junto a un borde fuerte hay producto.
    const Yb = gaussBlur(Y0, w, h, 1), thr = Math.max(6, 5 * estimateNoise(Y0, w, h));
    const edge = new Float32Array(n0);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, gx = Yb[i + 1] - Yb[i - 1], gy = Yb[i + w] - Yb[i - w];
      edge[i] = smooth(thr, 2 * thr, Math.sqrt(gx * gx + gy * gy));
    }
    const edgeD = minMax(edge, w, h, 2).mx;
    for (let i = 0; i < n0; i++) if (!speckFull[i] && edgeD[i] > prot[i]) prot[i] = edgeD[i];
    const protB = gaussBlur(prot, w, h, Math.max(0.8, 0.8 * f));
    for (let i = 0; i < n0; i++) { const v = Math.min(1, protB[i] * 1.6); if (v > mask[i]) mask[i] = v; }
    let cr = 0, cg = 0, cb = 0, cn = 0;
    for (let i = 0; i < N; i++) if (!prod[i]) { const p = ((i / sw) | 0) * f * w + (i % sw) * f; if (p < n0) { cr += bgR[p]; cg += bgG[p]; cb += bgB[p]; cn++; } }
    const bgColor = cn ? [cr / cn, cg / cn, cb / cn] : [255, 255, 255];
    let cover = 0; for (let i = 0; i < N; i++) cover += prod[i];
    return { mask, bgR, bgG, bgB, bgColor, speck: speckFull, threshold: T, coverage: cover / N };
  }

  // ───────────────────────── Utilidades de color ─────────────────────────

  function luma(R, G, B, n) {
    const Y = new Float32Array(n);
    for (let i = 0; i < n; i++) Y[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    return Y;
  }

  /** Limita el aumento de ganancia para no quemar los canales (rodilla suave). */
  function softGain(m0, gain) {
    if (gain <= 1 || m0 <= 1) return gain;
    const m = (m0 * gain) / 255;
    if (m <= 0.92) return gain;
    const target = 0.92 + 0.08 * Math.tanh((m - 0.92) / 0.08);
    return Math.max(1, (target * 255) / m0);
  }

  function estimateNoise(Y, w, h) {
    const g = gaussBlur(Y, w, h, 1);
    const hist = new Float64Array(256); let n = 0;
    for (let y = 1; y < h - 1; y += 3) for (let x = 1; x < w - 1; x += 3) {
      const i = y * w + x; const d = Math.abs(Y[i] - g[i]);
      hist[Math.min(255, (d * 8) | 0)]++; n++;
    }
    let acc = 0, med = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n / 2) { med = i / 8; break; } }
    return (med / 0.6745) * 1.3;
  }

  // ───────────────────────── Pipeline ─────────────────────────

  function isNeutral(p) {
    return !p.sharpness && !p.denoise && !p.contrast && !p.exposure && !p.highlights && !p.shadows &&
      !p.whites && !p.blacks && !p.temperature && !p.tint && !p.saturation && !p.vibrance && !p.bg.optimize &&
      !(p.whiteBalance && p.whiteBalance.auto);
  }

  /**
   * @param src    {data: Uint8ClampedArray RGBA, width, height} — imagen ya escalada al tamaño de trabajo
   * @param params ver presets.js
   * @param opts   {analyze, pad:{width,height}|null}
   */
  function process(src, params, opts) {
    opts = opts || {};
    const w = src.width, h = src.height, n = w * h;
    const t0 = Date.now();
    const P = params;
    const scale = Math.max(w, h) / 1600;          // los radios se expresan para 1600 px
    const fid = clamp(P.fidelity, 0, 100) / 100;
    const fidScale = lerp(1.15, 0.6, fid);         // más fidelidad → ajustes más contenidos
    const k = (clamp(P.intensity, 0, 100) / 70) * fidScale / 0.64; // =1 con intensidad 70 y fidelidad 95

    // Planos flotantes.
    let R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
    const d = src.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = d[j]; G[i] = d[j + 1]; B[i] = d[j + 2]; }
    const baseR = Float32Array.from(R), baseG = Float32Array.from(G), baseB = Float32Array.from(B);
    // Referencia del original para la guarda de color y el control de calidad. Si se corrige el tinte,
    // pasa a ser el original YA corregido (así esas etapas no pelean contra la corrección).
    let refR = baseR, refG = baseG, refB = baseB;

    const neutral = isNeutral(P) && !P.jewelry.on;
    let det = null, metal = null;
    const needDet = !neutral && (P.sharpness || P.contrast || P.bg.optimize || P.jewelry.on || (P.whiteBalance && P.whiteBalance.auto)) || opts.analyze;
    if (needDet) det = detectProduct(R, G, B, w, h);
    const M = det ? det.mask : null;

    const info = { scale, k, noise: 0, metal: null, coverage: det ? det.coverage : null, ms: {} };
    const tick = (name, t) => { info.ms[name] = Date.now() - t; };

    let denoisedY = null;
    let outR = R, outG = G, outB = B;
    let preSharpY = null;

    if (!neutral) {
      // 1 ── REDUCCIÓN DE RUIDO: bilateral guiado por luma. Prioridad DETALLE > SUAVIDAD.
      let t = Date.now();
      const nr = clamp((P.denoise / 100) * k, 0, 1.3);
      if (nr > 0.001) {
        const Y = luma(R, G, B, n);
        info.noise = estimateNoise(Y, w, h);
        const rad = scale > 1.6 ? 3 : 2;
        const sS = 0.9 + 0.5 * scale, sR = clamp(info.noise * 1.4 + 3 + 14 * nr, 3, 40);
        const strength = clamp(nr, 0, 1) * 0.85;      // tope: nunca 100 % suavizado
        const Yf = bilateral(Y, Y, w, h, rad, sS, sR);
        // Croma: filtrado más fuerte (el ruido de color no es "detalle").
        const Cb = new Float32Array(n), Cr = new Float32Array(n);
        for (let i = 0; i < n; i++) { Cb[i] = (B[i] - Y[i]) * 0.564; Cr[i] = (R[i] - Y[i]) * 0.713; }
        const Cbf = bilateral(Cb, Y, w, h, rad, sS * 1.5, sR * 1.6), Crf = bilateral(Cr, Y, w, h, rad, sS * 1.5, sR * 1.6);
        const cs = clamp(0.35 + strength, 0, 1);
        for (let i = 0; i < n; i++) {
          const y = Y[i] + (Yf[i] - Y[i]) * strength;
          const cb = Cb[i] + (Cbf[i] - Cb[i]) * cs, cr = Cr[i] + (Crf[i] - Cr[i]) * cs;
          const r = y + cr / 0.713, b = y + cb / 0.564;
          R[i] = r; B[i] = b; G[i] = (y - 0.299 * r - 0.114 * b) / 0.587;
        }
        denoisedY = luma(R, G, B, n);
      }
      tick('denoise', t);

      // 1b ── BALANCE DE BLANCOS AUTOMÁTICO: el fondo de estudio debe ser blanco/gris neutro; si tiene tinte
      //       (luz amarillenta, verdosa…) esa desviación afecta a toda la foto. Se calcula la ganancia por canal
      //       que neutraliza el fondo y se aplica global (como el balance de blancos de la cámara).
      //       Solo con fondo claro y tinte moderado: un fondo oscuro o de color deliberado no se toca.
      if (P.whiteBalance && P.whiteBalance.auto && det) {
        const bc = det.bgColor, yb = 0.299 * bc[0] + 0.587 * bc[1] + 0.114 * bc[2];
        const mxc = Math.max(bc[0], bc[1], bc[2]), mnc = Math.max(1, Math.min(bc[0], bc[1], bc[2]));
        if (yb < 110) info.wb = { applied: false, reason: 'fondo oscuro' };
        else if (mxc / mnc > 1.35) info.wb = { applied: false, reason: 'fondo con color' };
        else {
          const st = clamp(P.whiteBalance.strength == null ? 80 : P.whiteBalance.strength, 0, 100) / 100;
          const g = bc.map((c) => clamp(1 + (yb / Math.max(c, 1) - 1) * st, 0.75, 1.3));
          const dev = Math.max(Math.abs(g[0] - 1), Math.abs(g[1] - 1), Math.abs(g[2] - 1));
          info.wb = { applied: dev > 0.005, gains: g.map((v) => +v.toFixed(3)), bgBefore: bc.map((v) => Math.round(v)) };
          if (dev > 0.005) {
            refR = new Float32Array(n); refG = new Float32Array(n); refB = new Float32Array(n);
            for (let i = 0; i < n; i++) {
              R[i] = Math.min(255, R[i] * g[0]); G[i] = Math.min(255, G[i] * g[1]); B[i] = Math.min(255, B[i] * g[2]);
              refR[i] = Math.min(255, baseR[i] * g[0]); refG[i] = Math.min(255, baseG[i] * g[1]); refB[i] = Math.min(255, baseB[i] * g[2]);
              det.bgR[i] *= g[0]; det.bgG[i] *= g[1]; det.bgB[i] *= g[2];   // el modelo de fondo sigue a la foto
            }
            det.bgColor = [bc[0] * g[0], bc[1] * g[1], bc[2] * g[2]];
          }
        }
      }

      // 2 ── ILUMINACIÓN: exposición, altas luces, sombras, blancos, negros (sobre luma, matiz intacto).
      t = Date.now();
      if (P.exposure || P.highlights || P.shadows || P.whites || P.blacks) {
        const ge = Math.pow(2, (P.exposure / 100) * 1.5 * Math.min(k, 1.3) / 2.2);
        const hh = (P.highlights / 100) * 0.25 * Math.min(k, 1.5), ss = (P.shadows / 100) * 0.22 * Math.min(k, 1.5);
        const wp = 1 - (P.whites / 100) * 0.12, bp = -(P.blacks / 100) * 0.06;
        for (let i = 0; i < n; i++) {
          const y0 = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
          if (y0 < 0.5) continue;
          let v = (y0 / 255) * ge;
          v = (v - bp) / (wp - bp);
          v += ss * smooth(0, 0.15, v) * (1 - smooth(0.15, 0.65, v));
          v += hh * smooth(0.4, 0.9, v);
          v = clamp(v, 0, 1.2) * 255;
          const gain = softGain(Math.max(R[i], G[i], B[i]), v / y0);
          R[i] *= gain; G[i] *= gain; B[i] *= gain;
        }
      }
      tick('tone', t);

      // 3 ── COLOR: temperatura, tinte, saturación, vibrance.
      t = Date.now();
      if (P.temperature || P.tint || P.saturation || P.vibrance) {
        const tt = (P.temperature / 100) * Math.min(k, 1.3), ti = (P.tint / 100) * Math.min(k, 1.3);
        const tr = 1 + 0.10 * tt, tb = 1 - 0.10 * tt, tg = 1 - 0.06 * ti;
        const sat = (P.saturation / 100) * 0.6 * Math.min(k, 1.3), vib = (P.vibrance / 100) * 0.6 * Math.min(k, 1.3);
        for (let i = 0; i < n; i++) {
          let r = R[i], g = G[i], b = B[i];
          const y0 = 0.299 * r + 0.587 * g + 0.114 * b;
          if (tt || ti) {
            r *= tr; g *= tg; b *= tb;
            const y1 = 0.299 * r + 0.587 * g + 0.114 * b;
            if (y1 > 0.5) { const q = y0 / y1; r *= q; g *= q; b *= q; }
          }
          if (sat || vib) {
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const cs = mx > 1 ? (mx - mn) / mx : 0;
            const f = 1 + sat + vib * (1 - cs);
            const y = 0.299 * r + 0.587 * g + 0.114 * b;
            r = y + (r - y) * f; g = y + (g - y) * f; b = y + (b - y) * f;
          }
          R[i] = clamp(r, 0, 255); G[i] = clamp(g, 0, 255); B[i] = clamp(b, 0, 255);
        }
      }
      tick('color', t);

      // 4 ── CONTRASTE: curva S suave + micro-contraste local solo sobre el producto.
      t = Date.now();
      if (P.contrast > 0) {
        const kc = (P.contrast / 100) * 0.32 * Math.min(k, 1.5);
        const cl = (P.contrast / 100) * 0.22 * Math.min(k, 1.5);
        const Y = luma(R, G, B, n);
        const big = cl > 0 ? blur(Y, w, h, Math.max(4, 0.03 * Math.max(w, h))) : null;
        for (let i = 0; i < n; i++) {
          const y = Y[i]; if (y < 0.5) continue;
          const m = M ? M[i] : 1;
          let y2 = y - ((kc * (0.55 + 0.45 * m)) * Math.sin((2 * Math.PI * y) / 255) * 255) / (2 * Math.PI);
          if (big) y2 += cl * m * (y - big[i]) * (1 - Math.abs((2 * y) / 255 - 1));
          const gain = softGain(Math.max(R[i], G[i], B[i]), clamp(y2, 0, 255) / y);
          R[i] *= gain; G[i] *= gain; B[i] *= gain;
        }
      }
      tick('contrast', t);

      // 5 ── FONDO: solo actúa donde la máscara dice "fondo". El producto no se toca.
      t = Date.now();
      if (P.bg.optimize && det) {
        const pure = P.bg.pureWhite;
        const clean = pure ? Math.max(P.bg.clean, 90) / 100 : P.bg.clean / 100;
        const uni = pure ? 1 : P.bg.uniform / 100;
        const wh = pure ? 1 : P.bg.whiten / 100;
        const bc = det.bgColor;
        const tgt = pure ? [255, 255, 255] : [lerp(bc[0], 255, wh * 0.9), lerp(bc[1], 255, wh * 0.9), lerp(bc[2], 255, wh * 0.9)];
        // Solo se toca lo que coincide con el modelo de fondo dentro de una tolerancia estrecha
        // (ruido, manchas leves) o lo que se detectó como mota. Todo lo demás se deja intacto.
        const tolM = clamp(0.3 * det.threshold, 9, 18);
        for (let i = 0; i < n; i++) {
          const wgt = 1 - M[i];
          if (wgt < 0.004) continue;
          const mr = det.bgR[i], mg = det.bgG[i], mb = det.bgB[i];
          let a = wgt * (1 - smooth(tolM * 0.6, tolM, Math.max(Math.abs(R[i] - mr), Math.abs(G[i] - mg), Math.abs(B[i] - mb))));
          if (det.speck[i]) a = wgt;
          if (a < 0.003) continue;
          // corrección de iluminación (uniformar fondo)
          const gr = lerp(1, clamp(tgt[0] / Math.max(mr, 1), 0.7, 1.45), uni);
          const gg = lerp(1, clamp(tgt[1] / Math.max(mg, 1), 0.7, 1.45), uni);
          const gb = lerp(1, clamp(tgt[2] / Math.max(mb, 1), 0.7, 1.45), uni);
          const r1 = lerp(R[i], R[i] * gr, a), g1 = lerp(G[i], G[i] * gg, a), b1 = lerp(B[i], B[i] * gb, a);
          // limpieza: aplanar hacia el color de fondo ideal
          const flat = clean * a;
          R[i] = clamp(lerp(r1, tgt[0], flat), 0, 255);
          G[i] = clamp(lerp(g1, tgt[1], flat), 0, 255);
          B[i] = clamp(lerp(b1, tgt[2], flat), 0, 255);
        }
      }
      tick('background', t);

      // 6 ── JOYERÍA VEREX: guarda de color del metal (matiz y saturación acotados respecto al original).
      t = Date.now();
      if (P.jewelry.on && det) {
        metal = P.jewelry.metal;
        if (metal === 'auto') {
          let s = 0, c = 0;
          for (let i = 0; i < n; i += 3) if (M[i] > 0.99) {
            const y = 0.299 * refR[i] + 0.587 * refG[i] + 0.114 * refB[i];
            if (y > 25) { s += (refR[i] - refB[i]) / y; c++; }
          }
          // El oro es cálido RESPECTO A LA ESCENA: una foto con tinte amarillento/verdoso (luz mal balanceada)
          // calienta también el fondo y la plata, y eso no la convierte en oro.
          const bc = det.bgColor, yb = 0.299 * bc[0] + 0.587 * bc[1] + 0.114 * bc[2];
          const warmBg = yb > 25 ? (bc[0] - bc[2]) / yb : 0;
          const warm = c ? s / c : 0;
          metal = c && warm > 0.12 && warm - warmBg > 0.08 ? 'gold' : 'silver';
          info.warm = { producto: warm, fondo: warmBg };
        }
        info.metal = metal;
        const p = clamp(P.jewelry.protect, 0, 100) / 100;
        const maxAng = lerp(25, 3, p) * Math.PI / 180;
        const loosen = 1 - p;
        const minR = 1 - 0.5 * loosen - 0.02;
        const maxR = metal === 'gold' ? 1 + 0.35 * loosen + 0.04 : 1 + 0.6 * loosen + 0.06;
        for (let i = 0; i < n; i++) {
          const m = M[i]; if (m < 0.01) continue;
          const yo = 0.299 * refR[i] + 0.587 * refG[i] + 0.114 * refB[i];
          const yn = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
          if (yo < 12 || yn < 12) continue;
          const ob = ((refB[i] - yo) * 0.564) / yo, or_ = ((refR[i] - yo) * 0.713) / yo;
          const nb = ((B[i] - yn) * 0.564) / yn, nr_ = ((R[i] - yn) * 0.713) / yn;
          const mo = Math.hypot(ob, or_), mn = Math.hypot(nb, nr_);
          if (mo < 0.012 && mn < 0.012) continue;
          let ang = 0;
          if (mo > 0.004 && mn > 0.004) ang = Math.atan2(ob * nr_ - or_ * nb, ob * nb + or_ * nr_);
          const angC = clamp(ang, -maxAng, maxAng);
          const magC = clamp(mn, Math.max(mo * minR, 0), Math.max(mo * maxR, 0.012 * maxR));
          if (angC === ang && magC === mn) continue;
          // reconstruir el vector de croma con ángulo/magnitud limitados
          const a0 = Math.atan2(or_, ob) - ang + angC;   // ángulo del original + desviación permitida
          const cbn = Math.cos(a0) * magC, crn = Math.sin(a0) * magC;
          const rr = yn + (crn * yn) / 0.713, bb = yn + (cbn * yn) / 0.564;
          const gg = (yn - 0.299 * rr - 0.114 * bb) / 0.587;
          R[i] = clamp(lerp(R[i], rr, m), 0, 255); G[i] = clamp(lerp(G[i], gg, m), 0, 255); B[i] = clamp(lerp(B[i], bb, m), 0, 255);
        }
      }
      tick('metal', t);

      // 7 ── NITIDEZ INTELIGENTE: unsharp de dos escalas sobre luma, con coring, protección de luces
      //      y limitador de halos (no supera el mínimo/máximo local de la propia foto).
      t = Date.now();
      preSharpY = luma(R, G, B, n);
      if (P.sharpness > 0) {
        const a = (P.sharpness / 100) * Math.min(k, 1.6);
        const Y = preSharpY;
        const g1 = blur(Y, w, h, Math.max(0.55, 0.7 * scale)), g2 = blur(Y, w, h, Math.max(1.2, 1.7 * scale));
        const noise = info.noise || estimateNoise(Y, w, h);
        const tc = Math.max(0.4, 0.7 * noise);
        const rl = Math.max(1, Math.round(1.5 * scale));
        const { mn, mx } = minMax(Y, w, h, rl);
        const over = 2 + 6 * (1 - fid);
        for (let i = 0; i < n; i++) {
          const y = Y[i];
          let D = a * (0.9 * (y - g1[i]) + 0.5 * (y - g2[i]));
          D *= (D * D) / (D * D + tc * tc);                      // coring: no realza ruido
          const wgt = M ? 0.3 + 0.7 * M[i] : 1;                  // producto > fondo
          D *= wgt;
          if (D > 0) D *= 1 - smooth(235, 255, y);               // no quemar luces metálicas
          const y2 = clamp(y + D, mn[i] - over, mx[i] + over);   // anti-halo
          const delta = y2 - y;
          R[i] = clamp(R[i] + delta, 0, 255); G[i] = clamp(G[i] + delta, 0, 255); B[i] = clamp(B[i] + delta, 0, 255);
        }
      }
      tick('sharpen', t);
    }

    // ── Salida: 8 bits + relleno opcional a lienzo cuadrado (sin escalar el producto).
    const outData = new Uint8ClampedArray(n * 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) { outData[j] = (R[i] + 0.5) | 0; outData[j + 1] = (G[i] + 0.5) | 0; outData[j + 2] = (B[i] + 0.5) | 0; outData[j + 3] = 255; }

    let padColor = [255, 255, 255];
    if (opts.pad && !P.bg.pureWhite && det) padColor = det.bgColor.map((v) => clamp(Math.round(v), 0, 255));
    let result = { width: w, height: h, data: outData };
    let base = { width: w, height: h, data: src.data };
    if (opts.pad && (opts.pad.width !== w || opts.pad.height !== h)) {
      result = padImage(result, opts.pad.width, opts.pad.height, padColor);
      base = padImage(flatten(src), opts.pad.width, opts.pad.height, padColor);
    } else if (opts.wantBase) base = flatten(src);

    let qc = null;
    if (opts.analyze && M) {
      const t = Date.now();
      qc = analyze({ baseR: refR, baseG: refG, baseB: refB, R, G, B, preSharpY, denoisedY, M, w, h, P });
      tick('qc', t);
    }
    info.ms.total = Date.now() - t0;
    return { width: result.width, height: result.height, data: result.data, base: base.data, qc, info };
  }

  function flatten(img) {
    const d = new Uint8ClampedArray(img.data);
    for (let j = 3; j < d.length; j += 4) d[j] = 255;
    return { width: img.width, height: img.height, data: d };
  }

  function padImage(img, W, H, color) {
    const out = new Uint8ClampedArray(W * H * 4);
    for (let j = 0; j < out.length; j += 4) { out[j] = color[0]; out[j + 1] = color[1]; out[j + 2] = color[2]; out[j + 3] = 255; }
    const ox = ((W - img.width) / 2) | 0, oy = ((H - img.height) / 2) | 0;
    for (let y = 0; y < img.height; y++) {
      const s = y * img.width * 4, t = ((y + oy) * W + ox) * 4;
      out.set(img.data.subarray(s, s + img.width * 4), t);
    }
    return { width: W, height: H, data: out };
  }

  // ───────────────────────── Control de calidad ─────────────────────────

  function toLab(r, g, b) {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = f(r), G = f(g), B = f(b);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const q = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * q(Y) - 16, 500 * (q(X) - q(Y)), 200 * (q(Y) - q(Z))];
  }

  function lapEnergy(Y, M, w, h) {
    let e = 0, c = 0;
    for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x; if (M[i] < 0.99) continue;
      const l = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w];
      e += l * l; c++;
    }
    return c ? e / c : 0;
  }

  function gradMag(Y, w, h) {
    const g = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, gx = Y[i + 1] - Y[i - 1], gy = Y[i + w] - Y[i - w];
      g[i] = Math.sqrt(gx * gx + gy * gy);
    }
    return g;
  }

  function analyze(c) {
    const { baseR, baseG, baseB, R, G, B, preSharpY, denoisedY, M, w, h, P } = c;
    const n = w * h;
    const baseY = luma(baseR, baseG, baseB, n), finY = luma(R, G, B, n);
    const m = {}, warnings = [];

    // Pérdida de detalle (energía de microdetalle del producto, resultado vs. original).
    const eB = lapEnergy(baseY, M, w, h), eF = lapEnergy(finY, M, w, h);
    m.detailRatio = eB > 1e-6 ? eF / eB : 1;
    if (m.detailRatio < 0.88) warnings.push({ id: 'detail', level: 'warn', text: 'Posible pérdida de detalle en el producto (' + Math.round(m.detailRatio * 100) + ' % del original). Reduce la reducción de ruido.' });

    // Exceso de reducción de ruido.
    if (denoisedY && eB > 1e-6) {
      m.denoiseDetail = lapEnergy(denoisedY, M, w, h) / eB;
      if (m.denoiseDetail < 0.72) warnings.push({ id: 'nr', level: 'warn', text: 'Reducción de ruido excesiva: el microdetalle cayó a ' + Math.round(m.denoiseDetail * 100) + ' %. Bájala para conservar textura.' });
    }

    // Halos de sharpening: píxeles que sobrepasan el rango local de la imagen previa al enfoque.
    if (preSharpY && P.sharpness > 0) {
      const { mn, mx } = minMax(preSharpY, w, h, 2);
      const gp = gradMag(preSharpY, w, h);
      let over = 0, edges = 0;
      for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
        const i = y * w + x; if (M[i] < 0.5 || gp[i] < 20) continue;
        edges++;
        if (finY[i] > mx[i] + 10 || finY[i] < mn[i] - 10) over++;
      }
      m.haloRatio = edges ? over / edges : 0;
      if (m.haloRatio > 0.04) warnings.push({ id: 'halo', level: 'warn', text: 'Se detectan halos de sharpening en ' + (m.haloRatio * 100).toFixed(1) + ' % de los bordes. Baja la nitidez.' });
    }

    // Clipping de luces, saturación y color medio del producto.
    let n0 = 0, clipB = 0, clipF = 0, sB = 0, sF = 0, sn = 0;
    let br = 0, bg_ = 0, bb = 0, fr = 0, fg = 0, fb = 0;
    for (let i = 0; i < n; i += 2) {
      if (M[i] < 0.99) continue;
      n0++;
      const mb = Math.max(baseR[i], baseG[i], baseB[i]), mf = Math.max(R[i], G[i], B[i]);
      if (mb >= 253) clipB++; if (mf >= 253) clipF++;
      if (mb > 40 && mf > 40) {
        sB += (mb - Math.min(baseR[i], baseG[i], baseB[i])) / mb;
        sF += (mf - Math.min(R[i], G[i], B[i])) / mf; sn++;
      }
      br += baseR[i]; bg_ += baseG[i]; bb += baseB[i]; fr += R[i]; fg += G[i]; fb += B[i];
    }
    if (n0) {
      m.clipIncrease = (clipF - clipB) / n0;
      if (m.clipIncrease > 0.006) warnings.push({ id: 'clip', level: 'warn', text: 'Clipping de luces: ' + (m.clipIncrease * 100).toFixed(1) + ' % más de píxeles del producto quemados. Baja exposición/altas luces.' });
      m.satRatio = sn && sB > 1e-6 ? sF / sB : 1;
      if (m.satRatio > 1.25) warnings.push({ id: 'sat', level: 'warn', text: 'Exceso de saturación (+' + Math.round((m.satRatio - 1) * 100) + ' %). El metal puede verse artificial.' });
      const lb = toLab(br / n0 * 1, bg_ / n0, bb / n0), lf = toLab(fr / n0, fg / n0, fb / n0);
      m.colorShift = Math.hypot(lf[1] - lb[1], lf[2] - lb[2]);
      if (m.colorShift > 7) warnings.push({ id: 'color', level: 'warn', text: 'Alteración de color del producto (ΔC ≈ ' + m.colorShift.toFixed(1) + '). Revisa temperatura/tinte y JOYERÍA VEREX.' });
    }

    // Integridad estructural: correlación de bordes (original vs. resultado) sobre el producto.
    const gb2 = gradMag(baseY, w, h), gf = gradMag(finY, w, h);
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, cnt = 0;
    for (let i = 0; i < n; i += 2) {
      if (M[i] < 0.99) continue;
      const a = gb2[i], b = gf[i]; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; cnt++;
    }
    if (cnt > 10) {
      const cov = sab / cnt - (sa / cnt) * (sb / cnt), va = saa / cnt - (sa / cnt) ** 2, vb = sbb / cnt - (sb / cnt) ** 2;
      m.structure = va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : 1;
      if (m.structure < 0.93) warnings.push({ id: 'structure', level: 'danger', text: 'La estructura del producto difiere del original (' + Math.round(m.structure * 100) + ' %). Sube la fidelidad o baja la intensidad.' });
    } else m.structure = 1;

    return { metrics: m, warnings };
  }

  return { process, detectProduct, analyze, isNeutral, gaussBlur, blur, padImage };
});
