// Synthetic map exports, built to SPEC-005 §3 geometry.
//
// [D] The named cases and both structural oracles are testable before any real
// export exists: geometry is arithmetic, and a diff is a byte comparison. A
// synthetic export exercises panel pairing, band slicing and classification
// exactly as a real one does. What it cannot substitute for is oracle 2 against
// the game, which is why that test skips rather than passes when no real export
// is present.

import { deflateSync } from "node:zlib";
import { CELL, GRID, PANEL } from "../../src/mapdiff/geometry";
import type { TowerJSON } from "../../tools/maps/types";

export type RGB = readonly [number, number, number];

/** A deliberately small palette, mirroring a real export's 12-16 colours. */
export const COLORS = {
  background: [30, 30, 30] as RGB,
  frame: [90, 90, 90] as RGB,
  title: [255, 255, 255] as RGB,
  weak: [120, 90, 60] as RGB,
  reinforced: [150, 150, 150] as RGB,
  iron: [60, 60, 60] as RGB,
  enemy: [200, 40, 40] as RGB,
  item: [40, 200, 120] as RGB,
  stairs: [80, 140, 220] as RGB,
  player: [255, 220, 0] as RGB,
  badge: [10, 10, 10] as RGB,
} as const;

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;

  constructor(cols: number, rows: number) {
    this.width = cols * PANEL;
    this.height = rows * PANEL;
    this.rgb = new Uint8Array(this.width * this.height * 3);
    this.fillRect(0, 0, this.width, this.height, COLORS.background);
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++) {
      if (yy < 0 || yy >= this.height) continue;
      for (let xx = x; xx < x + w; xx++) {
        if (xx < 0 || xx >= this.width) continue;
        const o = (yy * this.width + xx) * 3;
        this.rgb[o] = c[0];
        this.rgb[o + 1] = c[1];
        this.rgb[o + 2] = c[2];
      }
    }
  }

  /** PNG, colour type 2 (RGB), 8-bit, no filtering — the simplest valid file. */
  toPng(): Uint8Array {
    const raw = new Uint8Array(this.height * (this.width * 3 + 1));
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 3 + 1)] = 0;
      raw.set(this.rgb.subarray(y * this.width * 3, (y + 1) * this.width * 3), y * (this.width * 3 + 1) + 1);
    }
    const chunks: Uint8Array[] = [];
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, this.width);
    new DataView(ihdr.buffer).setUint32(4, this.height);
    ihdr[8] = 8;
    ihdr[9] = 2;
    chunks.push(chunk("IHDR", ihdr));
    chunks.push(chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))));
    chunks.push(chunk("IEND", new Uint8Array(0)));
    const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([sig, ...chunks].map((c) => Buffer.from(c)));
  }
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

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** How each cell kind is drawn. Distinct per kind, so a diff can tell them apart. */
function cellColor(kind: string): RGB {
  switch (kind) {
    case "0": return COLORS.background;
    case "1": return COLORS.weak;
    case "2": return COLORS.reinforced;
    case "3": return COLORS.iron;
    case "stairs_up":
    case "stairs_down": return COLORS.stairs;
    case "enemy":
    case "enemy_neg": return COLORS.enemy;
    default: return COLORS.item;
  }
}

export interface RenderOptions {
  /** (z,x,y) keys forced to a state, overriding the tower's own contents. */
  overrides?: Map<string, "empty" | "reinforced">;
  /** Draw the player marker over this cell. */
  player?: { z: number; x: number; y: number };
  /** Redraw every value badge at maximum width, to prove the band ignores them. */
  fatBadges?: boolean;
}

/**
 * Renders a tower as an export would lay it out: one 256x256 panel per floor in
 * reading order, grid at (8, 12), 16x16 cells. Title strips carry a per-floor
 * bit pattern so panel pairing has something real to match on.
 */
export function renderTower(tower: TowerJSON, cols: number, rows: number, opts: RenderOptions = {}): Canvas {
  const c = new Canvas(cols, rows);
  tower.floors.forEach((floor, fi) => {
    const col = fi % cols;
    const row = Math.floor(fi / cols);
    const ox = col * PANEL;
    const oy = row * PANEL;

    // Title strip: rows 1..7, a per-floor pattern. Row 8 is the frame.
    for (let i = 0; i < floor.name.length && i < 30; i++) {
      c.fillRect(ox + 40 + i * 6, oy + 1, 5, 7, floor.name.charCodeAt(i) % 2 === 0 ? COLORS.title : COLORS.frame);
    }
    c.fillRect(ox, oy + 8, PANEL, 1, COLORS.frame);

    for (let y = 1; y <= GRID; y++) {
      for (let x = 1; x <= GRID; x++) {
        const px = ox + 8 + (x - 1) * CELL;
        const py = oy + 12 + (y - 1) * CELL;
        const cell = floor.cells[y - 1]![x - 1]!;
        const key = `${fi + 1},${x},${y}`;
        const override = opts.overrides?.get(key);
        const kind = override === "empty" ? "0" : override === "reinforced" ? "2" : typeof cell === "number" ? String(cell) : cell.type;

        c.fillRect(px, py, CELL, CELL, cellColor(kind));
        // A value badge: rows 11-15 of this cell and rows 0-1 of the one below,
        // which is exactly what the 2..10 band must be immune to.
        if (typeof cell === "object" && cell.value > 0 && override === undefined) {
          const digits = opts.fatBadges ? 5 : cell.value_str.length;
          c.fillRect(px + 1, py + 11, 3 * digits, 5, COLORS.badge);
          c.fillRect(px + 1, py + CELL, 3 * digits, 2, COLORS.badge);
        }
      }
    }

    if (opts.player && opts.player.z === fi + 1) {
      const px = ox + 8 + (opts.player.x - 1) * CELL;
      const py = oy + 12 + (opts.player.y - 1) * CELL;
      c.fillRect(px + 2, py + 2, CELL - 4, CELL - 4, COLORS.player);
    }
  });
  return c;
}
