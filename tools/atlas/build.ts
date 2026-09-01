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

export const CELL = 16;
/** Atlas columns. 8 x 16px keeps the sprite block 128 wide, as does the font block. */
const COLUMNS = 8;

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

  // Only the 16x16 tiles. The seven odd-sized files -- the logo, the title
  // pieces, the 1x1 particle, the 20x20 mouse cursor, the marker sheet -- are
  // menu and title-screen furniture the scrubber never draws.
  const sprites = readdirSync(join(res, "sprite"))
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => ({ name: basename(f, ".png"), img: toRgba(new Uint8Array(readFileSync(join(res, "sprite", f)))) }))
    .filter((s) => s.img.width === CELL && s.img.height === CELL);

  const fonts = Object.entries(FONTS).map(([name, def]) => {
    const img = toRgba(new Uint8Array(readFileSync(join(res, "font", def.file))));
    return { name, def, img, font: readImageFont(img, def.charset, def.spacing) };
  });

  const spriteRows = Math.ceil(sprites.length / COLUMNS);
  const width = Math.max(COLUMNS * CELL, ...fonts.map((f) => f.img.width));
  const fontTop = spriteRows * CELL;
  const height = fontTop + fonts.reduce((h, f) => h + f.img.height, 0);

  const dst: Rgba = { width, height, pixels: new Uint8Array(width * height * 4) };
  const manifest: AtlasManifest = { game_version: version, width, height, cell: CELL, sprites: {}, fonts: {}, entities: parseEntitySprites(readFileSync(join(gameDir, "entitydef.lua"), "utf8")) };

  sprites.forEach((s, i) => {
    const x = (i % COLUMNS) * CELL;
    const y = Math.floor(i / COLUMNS) * CELL;
    blit(dst, s.img, x, y);
    manifest.sprites[s.name] = { x, y, w: CELL, h: CELL };
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
