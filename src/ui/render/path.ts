// docs/UI.md §6 — the route an action took, drawn on the floor.
//
// `[I]` iestyn: a failure showed the player at the blocked cell and nothing
// else, so you could see *where* they stopped and never *where they came from*
// — and the reason a cell blocks is the approach to it. Drawing the player at
// the far end instead only swaps which half is missing. Both halves are the
// answer, and the game already draws this shape: when you move, it flashes the
// auto-pather's route as a line of ghosted players.
//
// `[D]` **The outline is the union's outer edge, never a box per cell.** A box
// per cell reads as a row of separate marks and buries the floor under grid
// lines; the union says "this is one journey" in a quarter of the ink. An edge
// is drawn exactly where the neighbour across it is not in the set, which is
// what makes internal edges disappear without any special-casing.

import { CELL } from "./screen";
import type { Waypoint } from "../../sim/types";

/** Where a floor cell lands on screen; null when its floor is not shown. */
export type Locate = (w: Waypoint) => { x: number; y: number } | null;

/**
 * The outer edge of a set of cells.
 *
 * `[F]` Half-pixel offsets throughout: a 1 px stroke centred on an integer
 * coordinate straddles two pixel columns and comes out two pixels wide and
 * grey. The app is pixel-exact (D10) and a blurred outline would be the one
 * mark on screen that is not.
 */
export function strokeOutline(
  ctx: CanvasRenderingContext2D,
  cells: readonly Waypoint[],
  locate: Locate,
  colour: string,
  dash: number[] = [],
): void {
  const key = (w: { z: number; x: number; y: number }): string => `${w.z}/${w.x}/${w.y}`;
  const set = new Set(cells.map(key));
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.beginPath();
  for (const w of cells) {
    const o = locate(w);
    if (o === null) continue;
    const l = o.x + 0.5;
    const t = o.y + 0.5;
    const r = o.x + CELL - 0.5;
    const b = o.y + CELL - 0.5;
    if (!set.has(key({ z: w.z, x: w.x, y: w.y - 1 }))) {
      ctx.moveTo(l, t);
      ctx.lineTo(r, t);
    }
    if (!set.has(key({ z: w.z, x: w.x, y: w.y + 1 }))) {
      ctx.moveTo(l, b);
      ctx.lineTo(r, b);
    }
    if (!set.has(key({ z: w.z, x: w.x - 1, y: w.y }))) {
      ctx.moveTo(l, t);
      ctx.lineTo(l, b);
    }
    if (!set.has(key({ z: w.z, x: w.x + 1, y: w.y }))) {
      ctx.moveTo(r, t);
      ctx.lineTo(r, b);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * The ghosted players along the walk.
 *
 * `[D]` Every cell but the last: the last is where the player actually is, and
 * it gets the solid sprite and the box. Ghosts are the same sprite at low
 * alpha rather than a different mark, because they are the same thing at a
 * different time — which is exactly what the game's own transient trail says.
 */
export function drawGhosts(
  ctx: CanvasRenderingContext2D,
  sprite: CanvasImageSource | null,
  cells: readonly Waypoint[],
  locate: Locate,
): void {
  if (sprite === null || cells.length < 2) return;
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * 0.3;
  for (const w of cells.slice(0, -1)) {
    const o = locate(w);
    if (o !== null) ctx.drawImage(sprite, o.x, o.y);
  }
  ctx.globalAlpha = alpha;
}
