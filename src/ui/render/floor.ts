// SPEC-007 §4.4 — one offscreen 240x240 bitmap per floor, repainted a cell at
// a time.
//
// `[F]` All 325 floors in all 16 towers are 15x15. `[D]` On a seek, repaint
// only the cells in the Addr[] that Cursor.seekTo returned: do not rebuild
// floors and do not diff grids. There is no wholesale-rebuild fallback,
// because a cell takes at most three edits over a whole route (§4.4), so the
// fallback would be unreachable code.

import { W } from "../../sim/types";
import type { TowerJSON } from "../../sim/types";
import type { AtlasManifest } from "../../../tools/atlas/build";
import { CELL, FLOOR, LABEL_H, LABEL_W, LABEL_Y } from "./screen";
import { bake, effectiveKey, labelOf, type BakedAtlas } from "./atlas";

/**
 * `alpha: true` throughout, and it matters. The atlas tile's two overhang rows
 * must stay transparent so a badge composites over the cell below instead of
 * blanking its top two rows, and the floor bitmap needs alpha to receive that.
 */
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/**
 * Box-filtered downscale: every destination pixel is the mean of the source
 * pixels it covers.
 *
 * `[D]` Canvas 2D exposes no mip levels and no anisotropic filtering, and its
 * own `imageSmoothingQuality` is bilinear — which, at the 10:1 reduction the
 * tower stack asks for, samples a tenth of the rows and aliases just as badly
 * as picking one. A box filter over the full source IS the supersample: it is
 * what a mip chain converges to for an axis-aligned minification, computed
 * once per floor rather than per frame.
 *
 * `[F]` Fractional coverage is weighted, so non-integer ratios are correct too
 * and the stack width is free to be tuned by eye rather than snapped to 1/2.
 */
export function boxDownscale(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const s = readback(src);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const d = new ImageData(w, h);
  const xr = src.width / w;
  const yr = src.height / h;

  for (let y = 0; y < h; y++) {
    const y0 = y * yr;
    const y1 = (y + 1) * yr;
    for (let x = 0; x < w; x++) {
      const x0 = x * xr;
      const x1 = (x + 1) * xr;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let wsum = 0;
      for (let sy = Math.floor(y0); sy < Math.min(src.height, Math.ceil(y1)); sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.min(src.width, Math.ceil(x1)); sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          const weight = wy * wx;
          const i = (sy * src.width + sx) * 4;
          r += s.data[i]! * weight;
          g += s.data[i + 1]! * weight;
          b += s.data[i + 2]! * weight;
          a += s.data[i + 3]! * weight;
          wsum += weight;
        }
      }
      const o = (y * w + x) * 4;
      d.data[o] = r / wsum;
      d.data[o + 1] = g / wsum;
      d.data[o + 2] = b / wsum;
      d.data[o + 3] = a / wsum;
    }
  }
  out.getContext("2d")!.putImageData(d, 0, 0);
  return out;
}

/**
 * `[F]` **A canvas has exactly one context, and `getContext` ignores the
 * attributes on every call after the first.** So asking a floor canvas for
 * `{ willReadFrequently: true }` in boxDownscale never took effect: the
 * context it returned was the one `makeCanvas` had already created without the
 * flag. Chrome demotes a GPU-backed canvas to software after repeated
 * `getImageData` and never promotes it back, which is the scrubbing fault of
 * TODO §A5 — slower and slower, then a cliff, never recovering.
 *
 * `[D]` **Read back through one scratch canvas rather than flagging the
 * floors.** Setting the flag on the floor canvases would fix the demotion by
 * making it permanent and universal, when a floor is drawn to far more often
 * than it is read. One shared software canvas takes every readback the app
 * makes, at the cost of one extra `drawImage`, and the floor canvases stay
 * accelerated.
 */
let scratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function readback(src: HTMLCanvasElement): ImageData {
  if (scratch === null) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context");
    scratch = { canvas, ctx };
  }
  const { canvas, ctx } = scratch;
  if (canvas.width < src.width || canvas.height < src.height) {
    canvas.width = Math.max(canvas.width, src.width);
    canvas.height = Math.max(canvas.height, src.height);
  }
  ctx.clearRect(0, 0, src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return ctx.getImageData(0, 0, src.width, src.height);
}

export class FloorCache {
  private readonly canvases: HTMLCanvasElement[] = [];
  private readonly ctxs: CanvasRenderingContext2D[] = [];
  /** Supersampled miniatures for the tower stack, keyed `z:WxH`. */
  private readonly minis = new Map<string, HTMLCanvasElement>();
  readonly atlas: BakedAtlas;

  constructor(
    private readonly tower: TowerJSON,
    manifest: AtlasManifest,
    sheet: CanvasImageSource,
  ) {
    this.atlas = bake(tower, manifest, sheet, makeCanvas);
    for (let z = 0; z < tower.floors.length; z++) {
      const { canvas, ctx } = makeCanvas(FLOOR, FLOOR);
      this.canvases.push(canvas);
      this.ctxs.push(ctx);
    }
  }

  get depth(): number {
    return this.tower.floors.length;
  }

  image(z: number): HTMLCanvasElement {
    return this.canvases[z - 1]!;
  }

  /**
   * A floor supersampled down to `w x h` for the tower stack. Built on demand
   * and cached, because the stack redraws every frame and a floor changes only
   * when a seek edits one of its cells.
   */
  mini(z: number, w: number, h: number): HTMLCanvasElement {
    const key = `${z}:${w}x${h}`;
    let c = this.minis.get(key);
    if (!c) {
      c = boxDownscale(this.image(z), w, h);
      this.minis.set(key, c);
    }
    return c;
  }

  /**
   * Paint every cell of every floor. Called once, when a record is opened.
   *
   * **Two passes, as the game does**: every tile, then every label. Labels
   * overhang their cell, so the only way to guarantee one is never clipped by a
   * neighbour is to draw them all after all the tiles. An earlier version baked
   * the label into the tile and relied on painting rows bottom-to-top, which
   * worked for most cells and silently failed for others.
   */
  paintAll(state: Uint8Array): void {
    for (let z = 1; z <= this.depth; z++) {
      for (let y = 1; y <= W; y++) for (let x = 1; x <= W; x++) this.tile(state, z, x, y);
      for (let y = 1; y <= W; y++) for (let x = 1; x <= W; x++) this.label(state, z, x, y);
    }
  }

  /**
   * Repaint exactly the cells a seek reported as changed — plus, for each, the
   * cell above it.
   *
   * `[F]` The neighbourhood is not slop, and its shape follows from the label
   * overhang. Repainting a tile erases any label ink lying over it, and a label
   * reaches 2 px right and 2 px down — so:
   *
   *   - tiles for the **2 x 2** block at `(x, y)`, because this cell's *old*
   *     label left ink in the cell right of and below it;
   *   - labels for the **3 x 3** around `(x, y)`, because that is every label
   *     whose ink can fall inside those four tiles.
   *
   * Thirteen `drawImage`s per edit, against §4.4's worst case of 1 849 edits
   * over a whole route — still proportional to the edits, which is the part of
   * "repaint only what changed" that matters.
   */
  invalidate(state: Uint8Array, changed: readonly number[]): void {
    const floorsHit = new Set<number>();
    for (const a of changed) {
      const x = (a % W) + 1;
      const y = (Math.floor(a / W) % W) + 1;
      const z = Math.floor(a / (W * W)) + 1;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          if (x + dx <= W && y + dy <= W) this.tile(state, z, x + dx, y + dy);
        }
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 1 && nx <= W && ny >= 1 && ny <= W) this.label(state, z, nx, ny);
        }
      }
      floorsHit.add(z);
    }
    // A miniature is a filter over the whole floor, so any edit on that floor
    // retires it. Only the floors actually touched, though -- a seek changes
    // one or two, and rebuilding all of them would undo the point of §4.4.
    for (const key of [...this.minis.keys()]) {
      if (floorsHit.has(Number(key.slice(0, key.indexOf(":"))))) this.minis.delete(key);
    }
  }

  private tile(state: Uint8Array, z: number, x: number, y: number): void {
    const rect = this.atlas.rects.get(effectiveKey(this.tower, state, z, x, y));
    if (!rect) return;
    this.ctxs[z - 1]!.drawImage(
      this.atlas.image, rect.x, rect.y, CELL, CELL, (x - 1) * CELL, (y - 1) * CELL, CELL, CELL,
    );
  }

  private label(state: Uint8Array, z: number, x: number, y: number): void {
    const text = labelOf(effectiveKey(this.tower, state, z, x, y));
    if (text === null) return;
    const rect = this.atlas.labels.get(text);
    if (!rect) return;
    // Clipped at the floor's right and bottom edges, exactly as the game's
    // scissor does -- a badge in column 15 has nowhere to overhang into.
    this.ctxs[z - 1]!.drawImage(
      this.atlas.image, rect.x, rect.y, LABEL_W, LABEL_H,
      (x - 1) * CELL, (y - 1) * CELL + LABEL_Y, LABEL_W, LABEL_H,
    );
  }
}
