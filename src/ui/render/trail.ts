// docs/UI.md §3 — the route trail.
//
// A line through the route's waypoints, drawn over the floors. It connects
// waypoints directly rather than following the path the player walked, and it
// crosses between tiles, so taking the stairs reads as one continuous line
// into the next tile rather than two disconnected fragments. Crossing segments
// are dashed.
//
// `[F]` The game is monochrome apart from the player (D26), so every colour
// here is ours. Both halves are lavender, separated only by hue: the part
// already taken shifted towards blue, the part not yet taken towards red.

import type { Player, Timeline } from "../../sim/types";
import { CELL, FLOOR } from "./screen";
import { tileOrigin, visitOfStop, type Visit } from "./left";
import type { Layout } from "./screen";

/** `[O]` Not settled; expected to be adjusted by eye (UI.md §3). */
export const D_HUE = 26;
const BASE_HUE = 262; // lavender

/**
 * `[D]` The trail is a **narrow window**, not a whole-route overlay: fully
 * faded by two stops either side of the scrub position.
 *
 * Drawn across the whole route it was more distracting than useful — a mess of
 * lines over every floor, competing with the tiles for attention. Two stops is
 * enough to answer "where did I just come from, where am I about to go" and
 * nothing more. It stays cheap to widen once the route *editing* work gives the
 * trail a job beyond reminding.
 */
const FADE_STOPS = 2;

export interface TrailPoint {
  /** Index into the visit list, i.e. which tile this waypoint is drawn in. */
  visit: number;
  x: number;
  y: number;
}

function playerAt(timeline: Timeline, step: number): Player {
  return step === 0 ? timeline.initial : timeline.steps[step - 1]!.player;
}

/**
 * One point per slider stop: where the player stands after that action.
 *
 * The visit is looked up by **stop index**, matching `computeVisits`, which
 * builds its runs from stops rather than steps so that floors the route merely
 * walks through get no tile of their own.
 */
export function trailPoints(timeline: Timeline, visits: Visit[], stops: number[]): TrailPoint[] {
  return stops.map((step, i) => {
    const p = playerAt(timeline, step);
    return { visit: visitOfStop(visits, i), x: p.x, y: p.y };
  });
}

/**
 * Where a trail point is drawn under smart layout: the slot its floor occupies
 * in the current unit, or null when the point belongs to another unit and
 * has no tile on screen at all.
 */
export function slotOf(
  point: TrailPoint,
  visits: Visit[],
  unit: { from: number; to: number; floors: number[] },
): number | null {
  if (point.visit < unit.from || point.visit >= unit.to) return null;
  const z = visits[point.visit]?.z;
  const slot = z === undefined ? -1 : unit.floors.indexOf(z);
  return slot < 0 ? null : slot;
}

function centre(slot: number, pt: TrailPoint, scroll: number, layout: Layout): { x: number; y: number } {
  const o = tileOrigin(slot, scroll, layout);
  return { x: o.x + (pt.x - 1) * CELL + CELL / 2, y: o.y + (pt.y - 1) * CELL + CELL / 2 };
}

/**
 * `[D]` **The trail says tense, not verdict.** Both halves are lavender,
 * separated only by hue — the past towards blue, the future towards red. The
 * pass/fail colouring belongs to the slider, which is a picture of the whole
 * route; the trail is a two-stop window and has no room to say both.
 */
function colour(past: boolean, fade: number): string {
  const hue = BASE_HUE + (past ? -D_HUE : D_HUE);
  return `hsla(${hue}, 62%, ${past ? 72 : 66}%, ${fade.toFixed(3)})`;
}

/**
 * `[D]` Everything in the future draws before everything in the past, and the
 * segment at the scrub position draws last, so the two tenses never interleave
 * and the present is never buried.
 *
 * "Segment" here means a segment of the drawn LINE — one hop between two
 * consecutive stops. It is not a `ScrollUnit`, and it is not one of the
 * user-named route segments of `DESIGN_ROUTE_EDITING.md` §4 either.
 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  points: TrailPoint[],
  visits: Visit[],
  unit: { from: number; to: number; floors: number[] },
  current: number,
  scroll: number,
  layout: Layout,
): void {
  const link = (i: number, past: boolean): void => {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) return;
    const sa = slotOf(a, visits, unit);
    const sb = slotOf(b, visits, unit);
    // A point in another scroll unit has no tile on screen, so that hop of the
    // trail is simply not drawn.
    if (sa === null || sb === null) return;
    const p = centre(sa, a, scroll, layout);
    const q = centre(sb, b, scroll, layout);
    if (Math.max(p.x, q.x) < 0 || Math.min(p.x, q.x) > layout.w) return;

    const fade = 1 - Math.abs(i - current) / FADE_STOPS;
    if (fade <= 0) return;
    // Crossing between tiles is a floor change: dash it, so stairs read as one
    // continuous line rather than two fragments.
    ctx.setLineDash(sa === sb ? [] : [3, 3]);

    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(0, 0, 0, ${(fade * 0.8).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = colour(past, fade);
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = "round";
  for (let i = points.length - 2; i > current; i--) link(i, false);
  for (let i = 0; i < current; i++) link(i, true);
  link(current, true);
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * The player at the current waypoint, showing the state AFTER that action,
 * with its power beneath it as the game does.
 */
export function playerScreenPos(
  points: TrailPoint[],
  visits: Visit[],
  unit: { from: number; to: number; floors: number[] },
  current: number,
  scroll: number,
  layout: Layout,
): { x: number; y: number } | null {
  const pt = points[current];
  if (!pt) return null;
  const slot = slotOf(pt, visits, unit);
  if (slot === null) return null;
  const o = tileOrigin(slot, scroll, layout);
  if (o.x + FLOOR < 0 || o.x > layout.w) return null;
  return { x: o.x + (pt.x - 1) * CELL, y: o.y + (pt.y - 1) * CELL };
}
