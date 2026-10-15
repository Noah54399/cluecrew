import zlib from 'node:zlib';
import { Router } from 'express';

/**
 * Generated app icon (1024x1024 PNG) for the TikTok developer app form.
 * Pure Node — no image libraries. Original artwork: brand gradient with the
 * ClueCrew play mark, matching the in-game content card placeholders.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function inTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

export function generateAppIconPng(size = 1024): Buffer {
  const width = size;
  const height = size;
  const raw = Buffer.alloc(height * (1 + width * 3));
  const centerX = width / 2;
  const centerY = height / 2;
  const circleRadius = size * 0.36;
  const tri = {
    ax: centerX - size * 0.1,
    ay: centerY - size * 0.14,
    bx: centerX - size * 0.1,
    by: centerY + size * 0.14,
    cx: centerX + size * 0.17,
    cy: centerY,
  };

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // PNG filter: none
    for (let x = 0; x < width; x += 1) {
      const t = (x + y) / (2 * (width - 1));
      let r = Math.round(124 + (255 - 124) * t);
      let g = Math.round(92 + (77 - 92) * t);
      let b = Math.round(255 + (157 - 255) * t);

      const dx = x - centerX;
      const dy = y - centerY;
      if (Math.sqrt(dx * dx + dy * dy) <= circleRadius) {
        r = 255;
        g = 255;
        b = 255;
        if (inTriangle(x, y, tri.ax, tri.ay, tri.bx, tri.by, tri.cx, tri.cy)) {
          r = 23;
          g = 20;
          b = 50;
        }
      }

      const index = rowStart + 1 + x * 3;
      raw[index] = r;
      raw[index + 1] = g;
      raw[index + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

let cachedIcon: Buffer | null = null;

export function createAssetRouter(): Router {
  const router = Router();
  router.get('/app-icon.png', (_req, res) => {
    if (!cachedIcon) cachedIcon = generateAppIconPng(1024);
    res
      .type('image/png')
      .setHeader('Cache-Control', 'public, max-age=86400')
      .send(cachedIcon);
  });
  return router;
}
