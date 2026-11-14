import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { root } from "./lib.mjs";

const S = 1024;
const SS = 2;
const W = S * SS;

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const hi = Buffer.alloc(W * W * 4);
const bgTop = [18, 45, 70];
const bgBottom = [7, 19, 31];
const green = [61, 220, 132];
const greenSoft = [124, 240, 175];
const boxFill = [24, 45, 66];
const boxLine = [60, 98, 130];

for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const px = x / SS;
    const py = y / SS;
    let rgb = null;
    let alpha = 0;

    if (insideRoundRect(px, py, 8, 8, S - 8, S - 8, 210)) {
      rgb = mix(bgTop, bgBottom, py / S);
      alpha = 255;
    }

    const cx = 512;
    const cy = 706;
    const dx = px - cx;
    const dy = cy - py;
    if (dy > -8) {
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      if (ang >= 24 && ang <= 156) {
        for (const [r, color] of [
          [196, green],
          [318, green],
          [440, greenSoft],
        ]) {
          if (d >= r - 24 && d <= r + 24) {
            rgb = color;
            alpha = 255;
          }
        }
      }
    }

    if (insideRoundRect(px, py, 300, 690, 724, 846, 46)) {
      rgb = boxFill;
      alpha = 255;
      const edge = !insideRoundRect(px, py, 312, 702, 712, 834, 40);
      if (edge) rgb = boxLine;
    }

    if ((px - 656) ** 2 + (py - 768) ** 2 <= 18 ** 2) {
      rgb = green;
      alpha = 255;
    }

    if (rgb) {
      hi[i] = rgb[0];
      hi[i + 1] = rgb[1];
      hi[i + 2] = rgb[2];
      hi[i + 3] = alpha;
    }
  }
}

function downsample(srcW, factor) {
  const size = srcW / factor;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const i = ((y * factor + sy) * srcW + (x * factor + sx)) * 4;
          const alpha = hi[i + 3] / 255;
          r += hi[i] * alpha;
          g += hi[i + 1] * alpha;
          b += hi[i + 2] * alpha;
          a += alpha;
        }
      }
      const n = factor * factor;
      const o = (y * size + x) * 4;
      out[o] = a > 0 ? Math.round(r / a) : 0;
      out[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o + 2] = a > 0 ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ico(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png256]);
}

const iconsDir = path.join(root, "packaging", "icons");
fs.mkdirSync(iconsDir, { recursive: true });
const png1024 = png(downsample(W, SS), S);
const png256 = png(downsample(W, 8), 256);
fs.writeFileSync(path.join(iconsDir, "app.png"), png1024);
fs.writeFileSync(path.join(iconsDir, "app.ico"), ico(png256));
console.log(`[icon] ${path.join(iconsDir, "app.ico")}`);
