// A minimal PNG decoder, enough for LÖVE's map exports and no more.
//
// [D] No dependency. Node supplies inflate, and the rest -- chunk walk,
// de-filter, palette expansion -- is under 150 lines. A decoder we own also
// lets SPEC-005 §2 assert what it needs (is this really a PNG, how many
// distinct colours, was it transcoded) instead of inferring it from a
// library's error messages.
//
// Rejects loudly rather than guessing: interlaced images, 16-bit channels and
// anything else LÖVE does not emit are errors, not best-effort decodes.

import { deflateSync, inflateSync } from "node:zlib";

export class PngError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngError";
  }
}

export interface Png {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  pixels: Uint8Array;
  /** PNG colour type as found: 0 grey, 2 RGB, 3 palette, 4 grey+A, 6 RGBA. */
  colorType: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(bytes: Uint8Array): Png {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) {
      // A JPEG starts FF D8 FF. Worth naming, because a transcoded upload is
      // the failure mode SPEC-005 §2 exists to catch.
      const looksJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      throw new PngError(looksJpeg ? "input is a JPEG, not a PNG — map images must be transferred inside a ZIP (SPEC-005 §2)" : "input is not a PNG");
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);
    const data = bytes.subarray(off + 8, off + 8 + len);
    off += 12 + len;

    if (type === "IHDR") {
      const ihdr = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = ihdr.getUint32(0);
      height = ihdr.getUint32(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      if (data[10] !== 0) throw new PngError(`unsupported compression method ${data[10]}`);
      if (data[11] !== 0) throw new PngError(`unsupported filter method ${data[11]}`);
      if (data[12] !== 0) throw new PngError("interlaced PNG is not supported");
    } else if (type === "PLTE") {
      palette = data.slice();
    } else if (type === "tRNS") {
      trns = data.slice();
    } else if (type === "IDAT") {
      idat.push(data.slice());
    } else if (type === "IEND") {
      break;
    }
  }

  if (colorType === -1) throw new PngError("no IHDR chunk");
  const channels = CHANNELS[colorType];
  if (channels === undefined) throw new PngError(`unsupported colour type ${colorType}`);
  if (colorType === 3 && palette === null) throw new PngError("palette colour type with no PLTE chunk");
  if (bitDepth === 16) throw new PngError("16-bit channels are not supported");
  if (colorType !== 3 && bitDepth !== 8) throw new PngError(`unsupported bit depth ${bitDepth} for colour type ${colorType}`);
  if (colorType === 3 && ![1, 2, 4, 8].includes(bitDepth)) throw new PngError(`unsupported palette bit depth ${bitDepth}`);

  const raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((c) => Buffer.from(c)))));

  // --- de-filter, per scanline ---
  const bitsPerPixel = channels * bitDepth;
  const bytesPerLine = Math.ceil((width * bitsPerPixel) / 8);
  const filterStride = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const expected = height * (bytesPerLine + 1);
  if (raw.length < expected) throw new PngError(`truncated image data: ${raw.length} bytes, expected ${expected}`);

  const lines = new Uint8Array(height * bytesPerLine);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (bytesPerLine + 1)]!;
    const src = raw.subarray(y * (bytesPerLine + 1) + 1, y * (bytesPerLine + 1) + 1 + bytesPerLine);
    const cur = lines.subarray(y * bytesPerLine, (y + 1) * bytesPerLine);
    const up = y === 0 ? null : lines.subarray((y - 1) * bytesPerLine, y * bytesPerLine);
    for (let i = 0; i < bytesPerLine; i++) {
      const a = i >= filterStride ? cur[i - filterStride]! : 0;
      const b = up === null ? 0 : up[i]!;
      const c = up === null || i < filterStride ? 0 : up[i - filterStride]!;
      const x = src[i]!;
      switch (filter) {
        case 0: cur[i] = x; break;
        case 1: cur[i] = (x + a) & 0xff; break;
        case 2: cur[i] = (x + b) & 0xff; break;
        case 3: cur[i] = (x + ((a + b) >> 1)) & 0xff; break;
        case 4: cur[i] = (x + paeth(a, b, c)) & 0xff; break;
        default: throw new PngError(`unknown filter type ${filter} on row ${y}`);
      }
    }
  }

  // --- expand to RGBA ---
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const perByte = 8 / bitDepth;
        const byte = lines[y * bytesPerLine + Math.floor(x / perByte)]!;
        const shift = (perByte - 1 - (x % perByte)) * bitDepth;
        const idx = (byte >> shift) & ((1 << bitDepth) - 1);
        pixels[o] = palette![idx * 3]!;
        pixels[o + 1] = palette![idx * 3 + 1]!;
        pixels[o + 2] = palette![idx * 3 + 2]!;
        pixels[o + 3] = trns !== null && idx < trns.length ? trns[idx]! : 255;
        continue;
      }
      const s = y * bytesPerLine + x * channels;
      if (colorType === 0) {
        pixels[o] = pixels[o + 1] = pixels[o + 2] = lines[s]!;
        pixels[o + 3] = 255;
      } else if (colorType === 4) {
        pixels[o] = pixels[o + 1] = pixels[o + 2] = lines[s]!;
        pixels[o + 3] = lines[s + 1]!;
      } else if (colorType === 2) {
        pixels[o] = lines[s]!;
        pixels[o + 1] = lines[s + 1]!;
        pixels[o + 2] = lines[s + 2]!;
        pixels[o + 3] = 255;
      } else {
        pixels[o] = lines[s]!;
        pixels[o + 1] = lines[s + 1]!;
        pixels[o + 2] = lines[s + 2]!;
        pixels[o + 3] = lines[s + 3]!;
      }
    }
  }

  return { width, height, pixels, colorType };
}

/** Distinct RGB triples. SPEC-005 §2 uses this as the palette-settings guard. */
export function distinctColors(png: Png): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < png.pixels.length; i += 4) {
    out.add((png.pixels[i]! << 16) | (png.pixels[i + 1]! << 8) | png.pixels[i + 2]!);
  }
  return out;
}

/**
 * The other direction, for the SPEC-007 §6.1 atlas: RGBA in, an 8-bit truecolour
 * PNG out. Filter 0 on every row -- an atlas is mostly transparent padding and
 * deflate handles that better than any predictor would. Small enough to keep
 * here rather than take a dependency (D11).
 */
export function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  if (pixels.length !== width * height * 4) {
    throw new PngError(`pixel buffer is ${pixels.length} bytes, expected ${width * height * 4}`);
  }
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }

  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
