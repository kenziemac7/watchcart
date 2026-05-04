/**
 * Generates icon16.png, icon48.png, icon128.png using only Node.js built-ins.
 * Run once from this directory:  node create_icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf  = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const crcBuf  = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePNG(size, { bg, text }) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB
  // ihdr[10..12] = 0 (deflate, adaptive, no interlace)

  // Raw image: filter byte (0x00) + size*3 bytes per row
  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(rowLen * size);

  const [br, bg2, bb] = bg;
  const [fr, fg, fb]  = text;

  // Draw background
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const o = y * rowLen + 1 + x * 3;
      raw[o] = br; raw[o + 1] = bg2; raw[o + 2] = bb;
    }
  }

  // Draw a simple "W" in the center using pixel art at each resolution
  // Scale a 5×5 grid to the icon size
  const letterW = [
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,1,0,1],
    [1,1,0,1,1],
    [1,0,0,0,1],
  ];
  const gridSize = 5;
  const cellSize = Math.max(1, Math.floor(size / 8));
  const gridPx   = gridSize * cellSize;
  const ox = Math.floor((size - gridPx) / 2);
  const oy = Math.floor((size - gridPx) / 2);

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      if (!letterW[gy][gx]) continue;
      for (let py = 0; py < cellSize; py++) {
        for (let px = 0; px < cellSize; px++) {
          const x = ox + gx * cellSize + px;
          const y = oy + gy * cellSize + py;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          const o = y * rowLen + 1 + x * 3;
          raw[o] = fr; raw[o + 1] = fg; raw[o + 2] = fb;
        }
      }
    }
  }

  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const bg   = [124, 106, 245]; // indigo #7c6af5
const text = [255, 255, 255]; // white

for (const size of [16, 48, 128]) {
  const buf  = makePNG(size, { bg, text });
  const file = path.join(__dirname, `icon${size}.png`);
  fs.writeFileSync(file, buf);
  console.log(`Created ${file}`);
}
