'use strict';
// Codificador PNG mínimo (sin dependencias) para generar fotos de prueba.
const zlib = require('zlib');
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(img) {
  const { width: w, height: h, data } = img, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = y * (w * 3 + 1) + 1 + x * 3; raw[d] = data[s]; raw[d + 1] = data[s + 1]; raw[d + 2] = data[s + 2]; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))]);
}
module.exports = { png };
if (require.main === module) {
  const fs = require('fs'), path = require('path'), { make } = require('./synthetic.js');
  const dir = path.join(__dirname, 'fixtures'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'anillo-plata.png'), png(make(1800, 1500, { seed: 11 })));
  fs.writeFileSync(path.join(dir, 'anillo-oro.png'), png(make(1200, 1200, { gold: true, seed: 5, noise: 12 })));
  fs.writeFileSync(path.join(dir, 'producto03.png'), png(make(900, 700, { seed: 21 })));
  console.log('fixtures listos en', dir);
}
