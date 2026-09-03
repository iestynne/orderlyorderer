// SPEC-007 §6.1 — the asset build step.
//
// Reads the game archive's res/sprite/ and res/font/, packs them into one
// atlas PNG plus a name -> rect JSON, and writes both into build/, which is
// gitignored. Nothing here ever lands in the repository (D14b).
//
// Per D14b-1 the app ships the assets inside the bundle and offers no feature
// that hands them out. Inlining rather than serving /assets/atlas.png removes
// the casual path; it is NOT protection and must not be described as such.
// Anyone who wants the art already owns the game.
//
//   npm run build-atlas [-- --game ../local/game/v0.7-455] [--out build]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { decodePng, encodePng } from "../../src/mapdiff/png";
import { readImageFont, type Rgba } from "../../src/ui/imagefont";
import { ICONS } from "./icons";

export const CELL = 16;

/**
 * Atlas columns.
 *
 * `[D]` **As many as the fonts already make room for.** The sheet's width is
 * set by its widest bitmap font, which is 883 px; at the 8 columns the sprite
 * block used to use, 128 of those were sprites and the other 755 were nothing.
 * Deriving the count from the width costs no bytes the atlas was not already
 * spending and packs every sprite into two rows.
 */
function columnsFor(width: number): number {
  return Math.max(8, Math.floor(width / CELL));
}

/**
 * `[F]` main.lua:82-96. Charsets verbatim, including digits.png's duplicated
 * `x` -- 24 cells for 23 distinct characters -- and challenge.png's spacing of
 * 0 where the other three use -1.
 */
export const FONTS: Record<string, { file: string; charset: string; spacing: number }> = {
  FONT_STANDARD: {
    file: "VictoriaBold.png",
    charset:
      " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⟜↗★",
    spacing: -1,
  },
  FONT_CHALLENGE: { file: "challenge.png", charset: " *!#", spacing: 0 },
  FONT_DIGITS: { file: "digits.png", charset: " 0123456789x[].kMG+-vd:x", spacing: -1 },
  NEG_FONT_DIGITS: { file: "digits_neg.png", charset: "0123456789kMG-", spacing: -1 },
};

/**
 * Sprites cut out of a larger sheet, by 16x16 cell in the human-readable
 * scheme: column and row 1-based from the top left (D1).
 *
 * `[F]` `markers.png` is 128x64 — 8 columns by 4 rows — and (4, 4) is the
 * no-entry sign. `[D]` The app uses it for **the rules refusing a move**, which
 * is a different thing from the player switching an action off; that wears the
 * minus badge. Two states that look alike would be worse than either.
 */
export const SHEET_SPRITES: ReadonlyArray<{ name: string; file: string; col: number; row: number }> = [
  { name: "no_entry", file: "markers.png", col: 4, row: 4 },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasFont {
  rect: Rect;
  height: number;
  spacing: number;
  cellCount: number;
  /** x is relative to the font's rect. */
  glyphs: Array<{ char: string; x: number; w: number }>;
}

export interface AtlasManifest {
  game_version: string;
  width: number;
  height: number;
  cell: number;
  /** Every 16x16 sprite, by filename stem. */
  sprites: Record<string, Rect>;
  fonts: Record<string, AtlasFont>;
  /**
   * Entity type -> sprite stems, read out of entitydef.lua rather than copied
   * by hand. One entry for most types; `enemy` and `enemy_neg` carry ten, one
   * per power decade (entitydef.lua:275-307). Eight wall/player/UI sprites have
   * no entity type and are addressed by name.
   */
  entities: Record<string, string[]>;
}

/**
 * `[F]` entitydef.lua: each type is a top-level `entitydef.NAME = {` block
 * closed by a `}` in column 0, and its sprites are the res/sprite paths inside
 * it, in source order.
 */
export function parseEntitySprites(lua: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of lua.split("\n")) {
    const open = /^entitydef\.([a-z0-9_]+) = \{/.exec(line);
    if (open) {
      current = open[1]!;
      out[current] = [];
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    for (const m of line.matchAll(/res\/sprite\/([a-z0-9_]+)\.png/g)) out[current]!.push(m[1]!);
  }
  return out;
}

function crop(src: Rgba, x0: number, y0: number, w: number, h: number): Rgba {
  const out: Rgba = { width: w, height: h, pixels: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * src.width + x0) * 4;
    out.pixels.set(src.pixels.subarray(from, from + w * 4), y * w * 4);
  }
  return out;
}

/** `#` white ink for the runtime to tint, `o` black outline a tint leaves alone. */
function fromPixelMap(map: readonly string[]): Rgba {
  const h = map.length;
  const w = Math.max(...map.map((r) => r.length));
  const out: Rgba = { width: w, height: h, pixels: new Uint8Array(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y]![x];
      if (ch !== "#" && ch !== "o") continue;
      const v = ch === "#" ? 255 : 0;
      const i = (y * w + x) * 4;
      out.pixels[i] = v;
      out.pixels[i + 1] = v;
      out.pixels[i + 2] = v;
      out.pixels[i + 3] = 255;
    }
  }
  return out;
}

function toRgba(bytes: Uint8Array): Rgba {
  const p = decodePng(bytes);
  return { width: p.width, height: p.height, pixels: p.pixels };
}

function blit(dst: Rgba, src: Rgba, dx: number, dy: number, transparent?: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const s = (y * src.width + x) * 4;
      const d = ((dy + y) * dst.width + dx + x) * 4;
      const rgba =
        (((src.pixels[s]! << 24) | (src.pixels[s + 1]! << 16) | (src.pixels[s + 2]! << 8) | src.pixels[s + 3]!) >>>
          0);
      if (transparent !== undefined && rgba === transparent) continue;
      dst.pixels[d] = src.pixels[s]!;
      dst.pixels[d + 1] = src.pixels[s + 1]!;
      dst.pixels[d + 2] = src.pixels[s + 2]!;
      dst.pixels[d + 3] = src.pixels[s + 3]!;
    }
  }
}

export interface BuildResult {
  manifest: AtlasManifest;
  png: Uint8Array;
}

export function buildAtlas(gameDir: string): BuildResult {
  const res = join(gameDir, "res");
  const version = existsSync(join(gameDir, ".version"))
    ? readFileSync(join(gameDir, ".version"), "utf8").trim()
    : basename(gameDir);

  // Only the 16x16 tiles. The odd-sized files -- the logo, the title pieces,
  // the 1x1 particle, the 20x20 mouse cursor -- are menu and title-screen
  // furniture the scrubber never draws. The marker sheet is the exception, and
  // is cut up by name below.
  const sprites = readdirSync(join(res, "sprite"))
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => ({ name: basename(f, ".png"), img: toRgba(new Uint8Array(readFileSync(join(res, "sprite", f)))) }))
    .filter((s) => s.img.width === CELL && s.img.height === CELL);

  // ...plus the named cells cut out of the sheets, which are not 16x16 files
  // and so are not picked up by the sweep above.
  for (const cut of SHEET_SPRITES) {
    const sheet = toRgba(new Uint8Array(readFileSync(join(res, "sprite", cut.file))));
    const x = (cut.col - 1) * CELL;
    const y = (cut.row - 1) * CELL;
    if (x + CELL > sheet.width || y + CELL > sheet.height) {
      throw new Error(`${cut.file} has no cell (${cut.col}, ${cut.row}) at ${sheet.width}x${sheet.height}`);
    }
    sprites.push({ name: cut.name, img: crop(sheet, x, y, CELL, CELL) });
  }

  const fonts = Object.entries(FONTS).map(([name, def]) => {
    const img = toRgba(new Uint8Array(readFileSync(join(res, "font", def.file))));
    return { name, def, img, font: readImageFont(img, def.charset, def.spacing) };
  });

  // The app's own icons ride along, so they can be inspected exactly as the
  // game's sprites are. Ink is packed white for the runtime to tint.
  const icons = Object.entries(ICONS).map(([name, map]) => ({ name, img: fromPixelMap(map) }));

  const width = Math.max(8 * CELL, ...fonts.map((f) => f.img.width));
  const COLUMNS = columnsFor(width);
  const spriteRows = Math.ceil((sprites.length + icons.length) / COLUMNS);
  const fontTop = spriteRows * CELL;
  const height = fontTop + fonts.reduce((h, f) => h + f.img.height, 0);

  const dst: Rgba = { width, height, pixels: new Uint8Array(width * height * 4) };
  const manifest: AtlasManifest = { game_version: version, width, height, cell: CELL, sprites: {}, fonts: {}, entities: parseEntitySprites(readFileSync(join(gameDir, "entitydef.lua"), "utf8")) };

  [...sprites, ...icons].forEach((s, i) => {
    const x = (i % COLUMNS) * CELL;
    const y = Math.floor(i / COLUMNS) * CELL;
    blit(dst, s.img, x, y);
    // An icon is smaller than a cell, and its rect says so: the runtime draws
    // 9 or 11 px of it, not a 16 px cell with air around the art.
    manifest.sprites[s.name] = { x, y, w: s.img.width, h: s.img.height };
  });

  let y = fontTop;
  for (const f of fonts) {
    // The spacer colour is Love's delimiter, not ink: drop it on the way in so
    // the runtime blits the rect straight out with no per-pixel work.
    blit(dst, f.img, 0, y, f.font.spacer);
    manifest.fonts[f.name] = {
      rect: { x: 0, y, w: f.img.width, h: f.img.height },
      height: f.font.height,
      spacing: f.font.spacing,
      cellCount: f.font.cellCount,
      glyphs: f.font.glyphs.map((g) => ({ char: g.char, x: g.x, w: g.w })),
    };
    y += f.img.height;
  }

  return { manifest, png: encodePng(width, height, dst.pixels) };
}

function main(argv: string[]): void {
  const arg = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
  };
  const gameDir = arg("game", join(process.cwd(), "..", "local", "game", "v0.7-455"));
  const out = arg("out", join(process.cwd(), "build"));

  if (!existsSync(join(gameDir, "res"))) {
    console.error(`no res/ under ${gameDir}. The game archive is a build-time input (D14e); unpack it to ../local/.`);
    process.exit(1);
  }
  const { manifest, png } = buildAtlas(gameDir);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "atlas.png"), png);
  writeFileSync(join(out, "atlas.json"), JSON.stringify(manifest, null, 1));
  const glyphs = Object.entries(manifest.fonts)
    .map(([n, f]) => `${n} ${f.glyphs.length}`)
    .join(", ");
  console.log(
    `${out}/atlas.png  ${manifest.width}x${manifest.height}, ${png.length} bytes\n` +
      `  sprites ${Object.keys(manifest.sprites).length}\n  glyphs  ${glyphs}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) main(process.argv.slice(2));
