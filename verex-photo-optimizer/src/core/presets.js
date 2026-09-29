/* VEREX PHOTO OPTIMIZER — parámetros por defecto y presets.
 * Módulo UMD: se usa en la interfaz, en el worker y en las pruebas de Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VXPresets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Sin ningún ajuste: el pipeline devuelve la imagen idéntica al original. */
  const NEUTRAL = {
    intensity: 70,     // INTENSIDAD DE OPTIMIZACIÓN
    fidelity: 95,      // FIDELIDAD DEL PRODUCTO
    sharpness: 0,      // NITIDEZ
    denoise: 0,        // REDUCCIÓN DE RUIDO
    contrast: 0,       // CONTRASTE
    exposure: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temperature: 0, tint: 0, saturation: 0, vibrance: 0,
    whiteBalance: { auto: false, strength: 80 },         // CORRECCIÓN AUTOMÁTICA DEL TINTE (usa el fondo como blanco)
    jewelry: { on: false, metal: 'auto', protect: 75 }, // JOYERÍA VEREX
    bg: { optimize: false, pureWhite: false, clean: 60, uniform: 60, whiten: 50 },
    output: { mode: 'original', size: 1600, noUpscale: true, format: 'jpg', quality: 92 },
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, over) {
    const out = clone(base);
    (function rec(t, s) {
      for (const k in s) {
        if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) rec(t[k] = t[k] || {}, s[k]);
        else t[k] = s[k];
      }
    })(out, over || {});
    return out;
  }

  const LOOKS = {
    'VEREX NATURAL': {
      desc: 'Mejora muy ligera. Casi imperceptible: limpia y afina sin tocar el carácter de la foto.',
      p: { intensity: 60, sharpness: 40, denoise: 20, contrast: 20, shadows: 8, highlights: -8,
           jewelry: { on: true, metal: 'auto', protect: 80 } },
    },
    'VEREX PROFESSIONAL': {
      desc: 'Mayor nitidez y limpieza, con tono y contraste de estudio.',
      p: { intensity: 75, sharpness: 72, denoise: 35, contrast: 40, shadows: 15, highlights: -15, whites: 6, blacks: -4, vibrance: 8,
           whiteBalance: { auto: true, strength: 80 },
           jewelry: { on: true, metal: 'auto', protect: 75 } },
    },
    'VEREX ECOMMERCE': {
      desc: '1600×1600 px · WEBP 88 · sRGB · fondo #FFFFFF · nitidez para pantalla.',
      p: { intensity: 70, sharpness: 68, denoise: 30, contrast: 32, shadows: 10, highlights: -10, whites: 5,
           whiteBalance: { auto: true, strength: 80 },
           jewelry: { on: true, metal: 'auto', protect: 75 },
           bg: { optimize: true, pureWhite: true, clean: 80, uniform: 100, whiten: 100 },
           output: { mode: 'fit', size: 1600, noUpscale: true, format: 'webp', quality: 88 } },
    },
    'VEREX PRODUCT CARD': {
      desc: 'Tarjeta de producto: 800×800 px · WEBP 82 · fondo #FFFFFF · nitidez algo mayor por la reducción.',
      p: { intensity: 70, sharpness: 74, denoise: 30, contrast: 32, shadows: 10, highlights: -10, whites: 5,
           whiteBalance: { auto: true, strength: 80 },
           jewelry: { on: true, metal: 'auto', protect: 75 },
           bg: { optimize: true, pureWhite: true, clean: 80, uniform: 100, whiten: 100 },
           output: { mode: 'fit', size: 800, noUpscale: true, format: 'webp', quality: 82 } },
    },
    'VEREX SILVER': {
      desc: 'Plata 925: plateado natural, sin blanquear ni verse plástico.',
      p: { intensity: 70, sharpness: 66, denoise: 30, contrast: 30, shadows: 12, highlights: -14, whites: 3,
           whiteBalance: { auto: true, strength: 80 },
           jewelry: { on: true, metal: 'silver', protect: 85 } },
    },
    'VEREX GOLD': {
      desc: 'Oro laminado: dorado elegante y realista, sin exceso de amarillo/naranja.',
      p: { intensity: 70, sharpness: 62, denoise: 30, contrast: 28, shadows: 10, highlights: -12, saturation: -2,
           whiteBalance: { auto: true, strength: 80 },
           jewelry: { on: true, metal: 'gold', protect: 85 } },
    },
    'VEREX STEEL': {
      desc: 'Acero 316L: aspecto metálico natural, neutro y limpio.',
      p: { intensity: 70, sharpness: 70, denoise: 30, contrast: 34, shadows: 10, highlights: -14, whites: 3,
           whiteBalance: { auto: true, strength: 80 },
           jewelry: { on: true, metal: 'steel', protect: 85 } },
    },
  };

  const ORDER = Object.keys(LOOKS);
  const DEFAULT_PRESET = 'VEREX PROFESSIONAL';

  function presetParams(name, userOverrides) {
    const ov = userOverrides && userOverrides[name];
    if (ov) return merge(NEUTRAL, ov);
    return merge(NEUTRAL, LOOKS[name] ? LOOKS[name].p : {});
  }

  /** Comparación estructural de parámetros (para saber si difieren de un preset). */
  function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  return { NEUTRAL, LOOKS, ORDER, DEFAULT_PRESET, presetParams, merge, clone, equal };
});
