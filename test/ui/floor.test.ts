// SPEC-007 §4.4 and §5 — the floor cache, driven headless.
//
// The two things asserted here are the two that went wrong, and neither is
// visible in a screenshot:
//
//   - a canvas that is read back must be CREATED with willReadFrequently,
//     because a canvas hands out the context it already has and ignores the
//     attributes of every later getContext (D38);
//   - the stack's shear now lives in the cached miniature rather than in 64
//     drawImage calls per floor per update, so the pixels have to land in
//     exactly the places the per-row blit put them (D39).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  FloorCache,
  boxFilter,
  knockBack,
  shearRows,
  type CanvasAttrs,
  type CanvasFactory,
  type Pixels,
} from "../../src/ui/render/floor";
import { STACK_SHEAR } from "../../src/ui/render/right";
import { W, type TowerJSON } from "../../src/sim/types";
import type { AtlasManifest } from "../../tools/atlas/build";

/** `putImageData` needs the constructor; Node has no DOM. */
beforeAll(() => {
  if (!("ImageData" in globalThis)) {
    (globalThis as Record<string, unknown>)["ImageData"] = class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    };
  }
});

/** Enough of a manifest for `bake`: it needs the digits font and looks sprites up by name. */
const MANIFEST = {
  game_version: "test",
  width: 1,
  height: 1,
  cell: 16,
  sprites: {},
  entities: {},
  fonts: { FONT_DIGITS: { rect: { x: 0, y: 0, w: 1, h: 1 }, height: 7, spacing: -1, cellCount: 0, glyphs: [] } },
} as unknown as AtlasManifest;

interface FakeCanvas {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

/** A canvas that is nothing but its pixel buffer, and a log of how each was asked for. */
function stubFactory(): { make: CanvasFactory; made: Array<{ w: number; h: number; attrs?: CanvasAttrs }> } {
  const made: Array<{ w: number; h: number; attrs?: CanvasAttrs }> = [];
  const make = ((w: number, h: number, attrs?: CanvasAttrs) => {
    made.push({ w, h, attrs });
    const canvas: FakeCanvas = { width: w, height: h, pixels: new Uint8ClampedArray(w * h * 4) };
    const ctx = {
      imageSmoothingEnabled: false,
      fillStyle: "",
      drawImage: () => undefined,
      fillRect: () => undefined,
      getImageData: (_x: number, _y: number, gw: number, gh: number): Pixels => ({
        width: gw,
        height: gh,
        data: canvas.pixels,
      }),
      putImageData: (img: Pixels) => canvas.pixels.set(img.data),
    };
    return { canvas, ctx };
  }) as unknown as CanvasFactory;
  return { make, made };
}

const TOWER = JSON.parse(
  readFileSync(join(process.cwd(), "data", "towers", "v0.7-455", "1-5.json"), "utf8"),
) as TowerJSON;

describe("the box filter", () => {
  it("a destination pixel is the mean of the source pixels it covers", () => {
    // Four greys in a 2x2, reduced to one pixel: the mean, exactly.
    const src: Pixels = { width: 2, height: 2, data: new Uint8ClampedArray([
      0, 0, 0, 255, 100, 100, 100, 255,
      200, 200, 200, 255, 0, 0, 0, 255,
    ]) };
    const out = boxFilter(src, 1, 1);
    expect([...out.data]).toEqual([75, 75, 75, 255]);
  });

  it("weights fractional coverage, so a non-integer ratio is still correct", () => {
    // 3 -> 2 is 1.5 source pixels per destination pixel, so the middle one is
    // split in half. A row pick would answer 0 and 120, or 120 and 240.
    const src: Pixels = { width: 3, height: 1, data: new Uint8ClampedArray([
      0, 0, 0, 255, 120, 120, 120, 255, 240, 240, 240, 255,
    ]) };
    const out = boxFilter(src, 2, 1);
    expect([out.data[0], out.data[4]]).toEqual([40, 200]);
  });
});

describe("the shear, baked into the miniature", () => {
  it("row r is offset by shear(r) and the image widens by exactly the largest offset", () => {
    const h = 8;
    const shear = (r: number): number => Math.floor((h - 1 - r) / STACK_SHEAR);
    const src: Pixels = { width: 5, height: h, data: new Uint8ClampedArray(5 * h * 4).fill(255) };
    const out = shearRows(src, shear);

    expect(out.width).toBe(5 + shear(0));
    expect(out.height).toBe(h);
    for (let r = 0; r < h; r++) {
      const opaque: number[] = [];
      for (let x = 0; x < out.width; x++) if (out.data[(r * out.width + x) * 4 + 3] !== 0) opaque.push(x);
      expect(opaque, `row ${r}`).toEqual([0, 1, 2, 3, 4].map((i) => i + shear(r)));
    }
  });
});

// docs/TODO.md §A7.12 -- every floor of the stack but the current one is
// pulled halfway to mid-grey, so the black outline between overlapping floors
// has something to be dark against.
describe("the knock-back", () => {
  const px = (rgba: number[][]): Pixels => ({
    width: rgba.length,
    height: 1,
    data: new Uint8ClampedArray(rgba.flat()),
  });

  it("pulls an opaque pixel halfway to mid-grey", () => {
    const out = knockBack(px([[0, 0, 0, 255], [255, 255, 255, 255], [128, 128, 128, 255]]));
    expect([...out.data]).toEqual([64, 64, 64, 255, 191, 191, 191, 255, 128, 128, 128, 255]);
  });

  // `[F]` The shear leaves whole transparent columns down both rakes. Washing
  // those too would put grey outside the floor, which is precisely the edge the
  // outline is drawn on -- and is why this is baked into the miniature rather
  // than filled as a parallelogram over the blit.
  it("leaves transparent pixels alone, colour and alpha both", () => {
    const out = knockBack(px([[0, 0, 0, 0], [10, 20, 30, 0]]));
    expect([...out.data]).toEqual([0, 0, 0, 0, 10, 20, 30, 0]);
  });

  it("never changes alpha, and never changes the source", () => {
    const src = px([[10, 200, 90, 128]]);
    const out = knockBack(src);
    expect(out.data[3]).toBe(128);
    expect([...src.data]).toEqual([10, 200, 90, 128]);
  });
});

describe("FloorCache", () => {
  it("creates the atlas and every floor bitmap on the CPU", () => {
    const { make, made } = stubFactory();
    new FloorCache(TOWER, MANIFEST, {} as CanvasImageSource, make);

    // `mini` reads the floors back, and the atlas is drawn into the floors --
    // so an accelerated atlas would move that readback to every tile repaint
    // rather than remove it. Both have to ask at creation, because a canvas
    // ignores the attributes of every getContext after its first (D38).
    expect(made.length, "one atlas plus one bitmap per floor").toBe(1 + TOWER.floors.length);
    for (const m of made) expect(m.attrs, `${m.w}x${m.h}`).toEqual({ willReadFrequently: true });

    expect(made.filter((m) => m.w === 240 && m.h === 240).length).toBe(TOWER.floors.length);
  });

  it("caches the sheared miniature and retires it only on the floor that changed", () => {
    const { make } = stubFactory();
    const cache = new FloorCache(TOWER, MANIFEST, {} as CanvasImageSource, make);
    const h = 8;
    const shear = (r: number): number => Math.floor((h - 1 - r) / STACK_SHEAR);

    // An opaque floor, so every pixel of the miniature that carries ink is one
    // the shear put there.
    (cache.image(1) as unknown as FakeCanvas).pixels.fill(255);
    const mini = cache.mini(1, 20, h, shear);
    expect(mini.width).toBe(20 + shear(0));
    expect(mini.height).toBe(h);
    for (let r = 0; r < h; r++) {
      const px = (mini as unknown as FakeCanvas).pixels;
      const opaqueAt = (x: number): boolean => px[(r * mini.width + x) * 4 + 3] !== 0;
      expect(opaqueAt(shear(r)), `row ${r} starts at its offset`).toBe(true);
      expect(opaqueAt(shear(r) + 19), `row ${r} ends 20 px later`).toBe(true);
      if (shear(r) > 0) expect(opaqueAt(shear(r) - 1), `row ${r} has nothing left of it`).toBe(false);
    }

    // Cached: the stack asks for this on every update and must not refilter.
    expect(cache.mini(1, 20, h, shear)).toBe(mini);
    const other = cache.mini(2, 20, h, shear);

    // An edit on floor 1 retires floor 1's miniature and nothing else.
    const state = new Uint8Array(TOWER.floors.length * W * W);
    cache.invalidate(state, [0]);
    expect(cache.mini(1, 20, h, shear)).not.toBe(mini);
    expect(cache.mini(2, 20, h, shear)).toBe(other);
  });
});
