// SPEC-007 §4.3 — the per-tower permutation atlas.
//
// One bitmap per distinct (entity, value label) pair, baked once when a tower
// loads, so a scrub update is a flat drawImage with no text rendering. The
// worst tower is 160 tiles; the union of all 16 is 325, which is why this is
// per tower and not global.
//
// The enumeration and the sprite choice are pure and tested headless. Only
// bake() touches a canvas.

import { CellState, W } from "../../sim/types";
import type { Cell, TowerJSON } from "../../sim/types";
import type { AtlasManifest, Rect } from "../../../tools/atlas/build";
import { glyphOf, textWidth, type ImageFont } from "../imagefont";

import { CELL, LABEL_H, LABEL_RIGHT, LABEL_W } from "./screen";
export { CELL, LABEL_H, LABEL_RIGHT, LABEL_W };

/** `wall|<0..3>` for terrain, `<type>|<value_str>` for an entity. */
export type TileKey = string;

export function keyOf(c: Cell): TileKey {
  return typeof c === "object" ? `${c.type}|${c.value_str}` : `wall|${c}`;
}

/**
 * Every distinct tile the tower's JSON contains, in a stable order.
 *
 * `[F]` A seek never needs a key outside this set: an edit only ever yields
 * empty or Reinforced, and every tower contains at least one of each (§4.3).
 */
export function tileKeys(tower: TowerJSON): TileKey[] {
  const keys = new Set<TileKey>();
  for (const f of tower.floors) for (const row of f.cells) for (const c of row) keys.add(keyOf(c));
  return [...keys].sort();
}

/** What a cell looks like now: Gone is empty floor, Reinforced is a wall of 2. */
export function effectiveKey(tower: TowerJSON, state: Uint8Array, z: number, x: number, y: number): TileKey {
  const s = state[((z - 1) * W + (y - 1)) * W + (x - 1)]!;
  if (s === CellState.Gone) return "wall|0";
  if (s === CellState.Reinforced) return "wall|2";
  return keyOf(tower.floors[z - 1]!.cells[y - 1]![x - 1]!);
}

/**
 * `[F]` entitydef.lua:275-307. Enemy art is chosen by decimal magnitude, one
 * sprite per decade from 1 to 1e9 and above. Both `enemy` and `enemy_neg`
 * carry ten sprites and store `value` as a positive magnitude.
 */
export function enemyTier(value: number): number {
  const v = Math.abs(value);
  if (v < 10) return 1;
  return Math.min(10, Math.floor(Math.log10(v)) + 1);
}

const WALL_SPRITE: Record<string, string | null> = {
  "wall|0": null, // empty floor: a black square, no sprite
  "wall|1": "wall",
  "wall|2": "reinforced_wall",
  "wall|3": "iron_wall",
};

/**
 * `[F]` leveldata.lua:184-215. The ground under a tile is **white only under a
 * wall**. The game fills the whole floor white, then paints every `walls == 0`
 * cell black — and an entity always stands on a `walls == 0` cell, which is
 * exactly what licenses SPEC-002's merged grid. So entities sit on black, and
 * only wall values 1, 2 and 3 keep the white showing through their sprite's
 * transparent pixels.
 */
export function groundOf(key: TileKey): string {
  return key === "wall|1" || key === "wall|2" || key === "wall|3" ? "#fff" : "#000";
}

/** The sprite stem a key draws, or null for empty floor. */
export function spriteFor(key: TileKey, manifest: AtlasManifest): string | null {
  if (key in WALL_SPRITE) return WALL_SPRITE[key]!;
  const i = key.indexOf("|");
  const type = key.slice(0, i);
  const sprites = manifest.entities[type];
  if (sprites === undefined || sprites.length === 0) return "unknown";
  if (sprites.length === 1) return sprites[0]!;
  return sprites[enemyTier(convertValueStr(key.slice(i + 1))) - 1]!;
}

/**
 * `[F]` util.convert_value_str: a decimal with an optional k/M/G suffix. The
 * tower JSON already carries the parsed number, but the atlas is keyed by the
 * printed label, so the label is what has to be read back.
 */
export function convertValueStr(s: string): number {
  const mult: Record<string, number> = { k: 1e3, M: 1e6, G: 1e9 };
  const suffix = s.at(-1) ?? "";
  return suffix in mult ? Number(s.slice(0, -1)) * mult[suffix]! : Number(s);
}

/** The label drawn on a tile, or null when the game draws none. */
export function labelOf(key: TileKey): string | null {
  if (key.startsWith("wall|")) return null;
  const v = key.slice(key.indexOf("|") + 1);
  // `[F]` leveldata.lua:269 — a value_str of exactly "0" is not printed.
  return v === "0" ? null : v;
}

export interface BakedAtlas {
  image: CanvasImageSource;
  /** Ground + sprite, 16 x 16, one per distinct tile. */
  rects: Map<TileKey, Rect>;
  /**
   * Value labels, `LABEL_W x LABEL_H`, keyed by the printed text rather than by
   * tile — `50` appears on dozens of different entities, so there are far fewer
   * distinct labels than tiles.
   */
  labels: Map<string, Rect>;
  keys: TileKey[];
}

interface Ctx2D {
  drawImage(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingEnabled: boolean;
}

/**
 * Bake the tower's tiles into one offscreen bitmap.
 *
 * `[F]` leveldata.lua:182-275 is the drawing contract reproduced here: the
 * ground (§`groundOf`), then the sprite, then the value label right-aligned in
 * the cell's 16 px box at `(x*16-11, y*16-1)` — 5 px in from the right edge and
 * 11 px down.
 *
 * `[F]` **A tile is 16 x 18, not 16 x 16.** At 11 px down in a 7 px font the
 * label's last two rows fall outside the cell, and in the game they are drawn
 * over the cell below. Baking into a 16-tall tile cropped every badge. The
 * overhang rows carry no ground, so they composite as glyph-on-transparent and
 * the floor paints its rows bottom-to-top.
 */
export function bake(
  tower: TowerJSON,
  manifest: AtlasManifest,
  sheet: CanvasImageSource,
  makeCanvas: (w: number, h: number) => { canvas: CanvasImageSource; ctx: Ctx2D },
  columns = 16,
): BakedAtlas {
  const keys = tileKeys(tower);
  const texts = [...new Set(keys.map(labelOf).filter((l): l is string => l !== null))].sort();

  const tileRows = Math.ceil(keys.length / columns);
  const labelCols = Math.max(1, Math.floor((columns * CELL) / LABEL_W));
  const labelRows = Math.ceil(texts.length / labelCols);
  const width = columns * CELL;
  const tileBlock = tileRows * CELL;
  const { canvas, ctx } = makeCanvas(width, tileBlock + labelRows * LABEL_H);
  ctx.imageSmoothingEnabled = false;

  const digits = fontFrom(manifest, "FONT_DIGITS");
  const rects = new Map<TileKey, Rect>();
  const labels = new Map<string, Rect>();

  keys.forEach((key, i) => {
    const dx = (i % columns) * CELL;
    const dy = Math.floor(i / columns) * CELL;
    rects.set(key, { x: dx, y: dy, w: CELL, h: CELL });

    ctx.fillStyle = groundOf(key);
    ctx.fillRect(dx, dy, CELL, CELL);

    const sprite = spriteFor(key, manifest);
    if (sprite !== null) {
      const r = manifest.sprites[sprite];
      if (r) ctx.drawImage(sheet, r.x, r.y, r.w, r.h, dx, dy, CELL, CELL);
    }
  });

  // Labels sit in their own block, on transparent ground, so a floor can draw
  // every tile and then every label over the top (§`LABEL_W` in screen.ts).
  texts.forEach((text, i) => {
    const dx = (i % labelCols) * LABEL_W;
    const dy = tileBlock + Math.floor(i / labelCols) * LABEL_H;
    labels.set(text, { x: dx, y: dy, w: LABEL_W, h: LABEL_H });
    // Right-aligned so the text ENDS at LABEL_RIGHT, exactly as the game's
    // printf does. Anything else shifts every badge sideways.
    drawText(ctx, sheet, digits, text, dx + LABEL_RIGHT - textWidth(digits, text), dy);
  });

  return { image: canvas, rects, labels, keys };
}

export interface AtlasFontRef extends ImageFont {
  rect: Rect;
}

export function fontFrom(manifest: AtlasManifest, name: string): AtlasFontRef {
  const f = manifest.fonts[name];
  if (!f) throw new Error(`atlas has no font ${name}`);
  return { ...f, spacer: 0, glyphs: f.glyphs.map((g) => ({ ...g })) };
}

/** Love's printf, one glyph at a time. Glyph x is relative to the font's rect. */
export function drawText(
  ctx: Ctx2D,
  sheet: CanvasImageSource,
  font: AtlasFontRef,
  text: string,
  x: number,
  y: number,
): void {
  let pen = x;
  for (const ch of text) {
    const g = glyphOf(font, ch);
    if (!g) continue;
    ctx.drawImage(sheet, font.rect.x + g.x, font.rect.y, g.w, font.height, pen, y, g.w, font.height);
    pen += g.w + font.spacing;
  }
}
