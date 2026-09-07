// docs/UI.md §6 — the route an action took, drawn on the floor: ghosted
// players along the walk, and one outline round the union of its cells. The
// game itself flashes the auto-pather's route this way on every move.

import { CELL } from "./screen";
import type { Waypoint } from "../../sim/types";

/** Where a floor cell lands on screen; null when its floor is not shown. */
export type Locate = (w: Waypoint) => { x: number; y: number } | null;

/**
 * The outer edge of a set of cells: an edge is drawn exactly where the
 * neighbour across it is not in the set, so internal edges vanish for free.
 * Half-pixel offsets keep a 1 px stroke to one pixel column (D10).
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

/** The player's sprite at 30% on every cell of the walk but the last, where the player is. */
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
