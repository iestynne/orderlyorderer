// SPEC-009 §4 — magnify a region of a PNG, for a one-pixel claim. A report of
// that shape cites a crop, never a glance at the whole frame.
//
//   npx tsx tools/shots/crop.ts build/shots/clean.png 900 40 120 90 --scale 8
//
// Nearest-neighbour, always: resampling would destroy the evidence.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, type Png } from "../../src/mapdiff/png";

/** Where crops live, relative to the shot they came from. */
export const CROPS_DIR = "crops";

/** A PNG's pixels without its provenance: what a crop reads and what it makes. */
type Raster = Pick<Png, "width" | "height" | "pixels">;

export function crop(src: Raster, x: number, y: number, w: number, h: number, scale: number): Raster {
  if (w <= 0 || h <= 0 || scale < 1) throw new Error("crop: width, height and scale must be positive");
  if (x < 0 || y < 0 || x + w > src.width || y + h > src.height) {
    throw new Error(`crop: ${x},${y} ${w}x${h} is outside a ${src.width}x${src.height} image`);
  }
  const out = new Uint8Array(w * scale * h * scale * 4);
  const stride = w * scale * 4;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const s = ((y + row) * src.width + (x + col)) * 4;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const d = (row * scale + dy) * stride + (col * scale + dx) * 4;
          out[d] = src.pixels[s]!;
          out[d + 1] = src.pixels[s + 1]!;
          out[d + 2] = src.pixels[s + 2]!;
          out[d + 3] = src.pixels[s + 3]!;
        }
      }
    }
  }
  return { width: w * scale, height: h * scale, pixels: out };
}

function main(argv: string[]): void {
  const flag = argv.indexOf("--scale");
  const scale = flag < 0 ? 8 : Number(argv[flag + 1]);
  const rest = flag < 0 ? argv : [...argv.slice(0, flag), ...argv.slice(flag + 2)];
  const [file, x, y, w, h] = rest;
  if (file === undefined || h === undefined) {
    throw new Error("usage: crop.ts <png> <x> <y> <w> <h> [--scale n]");
  }
  const src = decodePng(new Uint8Array(readFileSync(file)));
  const out = crop(src, Number(x), Number(y), Number(w), Number(h), scale);
  // A subfolder, so scratch crops do not bury the shots anyone reviews.
  const dir = join(dirname(file), CROPS_DIR);
  mkdirSync(dir, { recursive: true });
  const to = join(dir, `${basename(file, ".png")}.crop-${x}-${y}-${w}x${h}@${scale}.png`);
  writeFileSync(to, encodePng(out.width, out.height, out.pixels));
  console.log(`${to}  ${out.width}x${out.height}`);
}

// Run as a command, imported by the test: the guard is an exact path compare,
// because a suffix match would also fire when something else imported this.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
