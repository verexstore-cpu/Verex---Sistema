'use strict';
// Genera build/icon.png y build/icon.ico (256×256, marca «V» dorada sobre negro) sin dependencias.
const fs = require('fs'), path = require('path');
const { png } = require('../test/make-png.js');
const N = 256, data = new Uint8ClampedArray(N * N * 4);
const gold = [201, 169, 110];
const inRound = (x, y, r) => { const cx = Math.max(r, Math.min(N - 1 - r, x)), cy = Math.max(r, Math.min(N - 1 - r, y)); return Math.hypot(x - cx, y - cy) <= r; };
const seg = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = (y * N + x) * 4; let c = [0, 0, 0], a = 255;
  if (!inRound(x, y, 44)) a = 0;
  else {
    c = [11, 11, 12];
    if (!inRound(x, y, 44) || !((x > 10 && x < N - 11 && y > 10 && y < N - 11) && inRound(x, y, 36))) c = gold;                 // borde dorado
    const d = Math.min(seg(x, y, 70, 68, 128, 190), seg(x, y, 186, 68, 128, 190));
    if (d < 13) c = gold;
  }
  data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a;
}
// PNG con alfa (RGBA) — codificador propio simple
const zlib = require('zlib');
function pngRGBA() {
  const raw = Buffer.alloc((N * 4 + 1) * N); for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; Buffer.from(data.buffer, y * N * 4, N * 4).copy(raw, y * (N * 4 + 1) + 1); }
  const t = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const ch = (type, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(type), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(N, 0); ih.writeUInt32BE(N, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw, { level: 9 })), ch('IEND', Buffer.alloc(0))]);
}
const p = pngRGBA(); const dir = path.join(__dirname, '..', 'build'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), p);
const hdr = Buffer.alloc(22); hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4);
hdr[6] = 0; hdr[7] = 0; hdr[8] = 0; hdr[9] = 0; hdr.writeUInt16LE(1, 10); hdr.writeUInt16LE(32, 12); hdr.writeUInt32LE(p.length, 14); hdr.writeUInt32LE(22, 18);
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([hdr, p]));
console.log('icono generado en build/ (', p.length, 'bytes )');
void png;
