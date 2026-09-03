// SPEC-007 §6 and §8 — stage 2 of the scrubber: the atlas, the sprites and the
// four bitmap fonts. All headless: glyph counts and atlas counts are named
// values, and nothing here needs a screen.
//
// The game archive lives outside git (D14b), so these SKIP rather than fail
// when it is absent — otherwise CI would look green while testing nothing.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng } from "../../src/mapdiff/png";
import { convertValueStr, enemyTier, keyOf, labelOf, spriteFor, tileKeys } from "../../src/ui/render/atlas";
import { ICONS } from "../../tools/atlas/icons";
import { readImageFont, textWidth, type Rgba } from "../../src/ui/imagefont";
import { buildAtlas, parseEntitySprites, FONTS, type AtlasManifest } from "../../tools/atlas/build";
import { TOWER_IDS, type TowerJSON } from "../../tools/maps/types";

const GAME_DIR = process.env["TOS_GAME_DIR"] ?? join(process.cwd(), "..", "local", "game", "v0.7-455");
const TOWER_DIR = join(process.cwd(), "data", "towers", "v0.7-455");
const haveGame = existsSync(join(GAME_DIR, "res"));
const d = haveGame ? describe : describe.skip;

let built: { manifest: AtlasManifest; png: Uint8Array } | null = null;
function atlas(): { manifest: AtlasManifest; png: Uint8Array } {
  built ??= buildAtlas(GAME_DIR);
  return built;
}

function tower(id: string): TowerJSON {
  return JSON.parse(readFileSync(join(TOWER_DIR, `${id}.json`), "utf8")) as TowerJSON;
}

function fontImage(file: string): Rgba {
  const p = decodePng(new Uint8Array(readFileSync(join(GAME_DIR, "res", "font", file))));
  return { width: p.width, height: p.height, pixels: p.pixels };
}

d("SPEC-007 §8 — the sprite atlas", () => {
  it("packs the game's sprites, the marker, and the app's own icons", () => {
    const { manifest } = atlas();
    const rects = Object.entries(manifest.sprites);
    // 65 sprite files plus the one cell cut out of markers.png: the no-entry
    // sign, for "the rules refuse this".
    const game = rects.filter(([name]) => !name.startsWith("icon_"));
    expect(game.length).toBe(66);
    expect(game.every(([, r]) => r.w === 16 && r.h === 16)).toBe(true);
    // ...and one icon per pixel map, for the things the game has no art for.
    const icons = rects.filter(([name]) => name.startsWith("icon_"));
    expect(icons.length).toBe(Object.keys(ICONS).length);
    // An icon's rect is its own size, not a padded cell: the runtime draws 9 or
    // 13 px of it and nothing else.
    expect(icons.every(([, r]) => r.w === r.h && r.w <= 16)).toBe(true);
    expect(rects.length).toBe(66 + icons.length);
  });

  // `[F]` The sheet's width is set by its widest bitmap font. At the 8 columns
  // the sprite block used to use, 128 px of that were sprites and 755 were
  // nothing; deriving the column count from the width packs them into two rows
  // and took the atlas from 883x176 to 883x64.
  it("wastes no width: the sprite rows are as wide as the font rows", () => {
    const { manifest } = atlas();
    const rows = new Set(Object.values(manifest.sprites).map((r) => r.y));
    expect(rows.size).toBe(2);
    expect(manifest.height).toBeLessThan(80);
  });

  it("re-decodes to the size the manifest claims", () => {
    const { manifest, png } = atlas();
    const decoded = decodePng(png);
    expect([decoded.width, decoded.height]).toEqual([manifest.width, manifest.height]);
  });

  it("binds all 41 entity types to sprites that are in the atlas", () => {
    const { manifest } = atlas();
    const types = Object.keys(manifest.entities);
    expect(types.length).toBe(41);
    const missing = types.flatMap((t) => manifest.entities[t]!).filter((s) => !(s in manifest.sprites));
    expect([...new Set(missing)]).toEqual([]);
    expect(types.filter((t) => manifest.entities[t]!.length === 0)).toEqual([]);
  });

  it("gives the two enemy types ten sprites each, one per power decade", () => {
    const { manifest } = atlas();
    expect(manifest.entities["enemy"]!.length).toBe(10);
    expect(manifest.entities["enemy_neg"]!.length).toBe(10);
    // entitydef.lua:275-307 — thresholds are 10^1 .. 10^9.
    expect([1, 9, 10, 99, 100, 999, 1e3, 1e5, 1e9, 1e12].map(enemyTier)).toEqual([1, 1, 2, 2, 3, 3, 4, 6, 10, 10]);
    expect(spriteFor("enemy|100", manifest)).toBe("enemy_snake");
    expect(spriteFor("enemy_neg|1G", manifest)).toBe("enemy_demon_neg");
  });

  it("parses the entity map out of entitydef.lua, not out of a hand-written table", () => {
    const lua = readFileSync(join(GAME_DIR, "entitydef.lua"), "utf8");
    expect(Object.keys(parseEntitySprites(lua)).length).toBe(41);
  });
});

d("SPEC-007 §8 — the four bitmap fonts (oracle 3)", () => {
  const expected: Record<string, { cells: number; glyphs: number; distinct: number; spacing: number; size: [number, number] }> = {
    FONT_STANDARD: { cells: 98, glyphs: 98, distinct: 98, spacing: -1, size: [883, 9] },
    FONT_DIGITS: { cells: 24, glyphs: 24, distinct: 23, spacing: -1, size: [141, 7] },
    NEG_FONT_DIGITS: { cells: 15, glyphs: 14, distinct: 14, spacing: -1, size: [92, 7] },
    FONT_CHALLENGE: { cells: 4, glyphs: 4, distinct: 4, spacing: 0, size: [36, 9] },
  };

  for (const [name, want] of Object.entries(expected)) {
    it(`${name} parses to ${want.glyphs} glyphs at spacing ${want.spacing}`, () => {
      const def = FONTS[name]!;
      const img = fontImage(def.file);
      expect([img.width, img.height], "PNG size").toEqual(want.size);
      const font = readImageFont(img, def.charset, def.spacing);
      expect(font.glyphs.length, "glyphs").toBe(want.glyphs);
      expect(font.cellCount, "top-row runs in the PNG").toBe(want.cells);
      expect(new Set([...def.charset]).size, "distinct characters").toBe(want.distinct);
      expect(font.spacing, "extra spacing").toBe(want.spacing);
      expect(font.height).toBe(want.size[1]);
    });
  }

  // The trap named in §6.2: a reader that assumes charset characters are unique
  // misaligns every glyph after the first `x`.
  it("digits.png keeps 24 cells for 23 distinct characters, with `x` twice", () => {
    const def = FONTS["FONT_DIGITS"]!;
    const font = readImageFont(fontImage(def.file), def.charset, def.spacing);
    const xs = font.glyphs.filter((g) => g.char === "x");
    expect(xs.length).toBe(2);
    expect(xs[0]!.x).not.toBe(xs[1]!.x);
    // Every glyph after the first duplicate must still sit where the PNG puts it.
    expect(font.glyphs.map((g) => g.char).join("")).toBe(def.charset);
  });

  // digits_neg.png has one run more than its charset. Love assigns cells in
  // order and never looks at the rest; a reader that insists on equality throws
  // on a file the game loads happily.
  it("digits_neg.png carries a 15th run of transparent padding that is not a glyph", () => {
    const def = FONTS["NEG_FONT_DIGITS"]!;
    const img = fontImage(def.file);
    const font = readImageFont(img, def.charset, def.spacing);
    expect(font.cellCount - font.glyphs.length).toBe(1);
    const last = font.glyphs.at(-1)!;
    for (let x = last.x + last.w + 1; x < img.width; x++) {
      for (let y = 0; y < img.height; y++) {
        expect(img.pixels[(y * img.width + x) * 4 + 3], `alpha at ${x},${y}`).toBe(0);
      }
    }
  });

  it("advance widths follow the game's spacing", () => {
    const digits = readImageFont(fontImage("digits.png"), FONTS["FONT_DIGITS"]!.charset, -1);
    // Every digit cell is 5 px wide, so at spacing -1 each advances 4.
    expect(textWidth(digits, "0")).toBe(4);
    expect(textWidth(digits, "100k")).toBe(16);
    const challenge = readImageFont(fontImage("challenge.png"), FONTS["FONT_CHALLENGE"]!.charset, 0);
    // challenge.png is the one font at spacing 0, so its 8 px cells advance 8.
    expect(textWidth(challenge, "*")).toBe(8);
  });
});

describe("SPEC-007 §8 — the permutation atlas", () => {
  it("counts 160 tiles in 2-6, 32 in EX-2, and 325 across all 16 towers", () => {
    const union = new Set<string>();
    const per = new Map<string, number>();
    for (const id of TOWER_IDS) {
      const keys = tileKeys(tower(id));
      per.set(id, keys.length);
      for (const k of keys) union.add(k);
    }
    expect(per.get("2-6"), "2-6, the worst tower").toBe(160);
    expect(per.get("EX-2"), "EX-2, the smallest").toBe(32);
    expect(union.size, "union of all 16").toBe(325);
    const sorted = [...per.values()].sort((a, b) => a - b);
    expect(sorted.at(-1)).toBe(160);
    // "~90 in the median tower" (§4.3).
    expect((sorted[7]! + sorted[8]!) / 2).toBeGreaterThanOrEqual(85);
    expect((sorted[7]! + sorted[8]!) / 2).toBeLessThanOrEqual(95);
  });

  // The contract names `100k`; the load-bearing part is the WIDTH, since it is
  // what the tile's 16 px label box has to hold. Several distinct 4-character
  // labels occur, so asserting a particular one would be asserting sort order.
  it("no value label is longer than 4 characters, and 100k is one of them", () => {
    const labels = new Set<string>();
    for (const id of TOWER_IDS) {
      for (const k of tileKeys(tower(id))) {
        const l = labelOf(k);
        if (l !== null) labels.add(l);
      }
    }
    const longest = [...labels].filter((l) => l.length === 4).sort();
    expect(Math.max(...[...labels].map((l) => l.length))).toBe(4);
    expect(longest).toContain("100k");
    expect(longest.length).toBeGreaterThan(1);
  });

  // §4.3, added 2026-08-31: the bake relied on this silently.
  it("every tower already contains the two states an edit can produce", () => {
    const lacking: string[] = [];
    for (const id of TOWER_IDS) {
      const keys = new Set(tileKeys(tower(id)));
      for (const need of ["wall|0", "wall|2"]) if (!keys.has(need)) lacking.push(`${id} lacks ${need}`);
    }
    expect(lacking).toEqual([]);
    // Iron is the one that is sometimes absent, and no edit ever creates it.
    const withoutIron = TOWER_IDS.filter((id) => !tileKeys(tower(id)).includes("wall|3"));
    expect(withoutIron.length).toBe(10);
  });

  it("keys terrain and entities apart, and drops a value_str of 0", () => {
    expect(keyOf(0)).toBe("wall|0");
    expect(keyOf({ type: "enemy", value_str: "1.5k", value: 1500 })).toBe("enemy|1.5k");
    expect(labelOf("wall|1")).toBeNull();
    expect(labelOf("stairs_up|0")).toBeNull();
    expect(labelOf("enemy|999G")).toBe("999G");
    expect([convertValueStr("100k"), convertValueStr("999G"), convertValueStr("42")]).toEqual([1e5, 999e9, 42]);
  });
});
