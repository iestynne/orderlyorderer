// SPEC-007 §5 + docs/UI.md §2 — the timeline strip.
//
// Floors laid out in the order the route visits them, one tile per visit, in a
// two-row bricklayer pattern. `[F]` Visit i is drawn at x = i * 122 - scroll,
// y = ROW[i mod 2]: consecutive visits never occupy the same horizontal range,
// which is what makes "further right is later" unambiguous.

import type { Timeline } from "../../sim/types";
import type { AtlasManifest } from "../../../tools/atlas/build";
import { drawText, fontFrom } from "./atlas";
import type { FloorCache } from "./floor";
import {
  BORDER,
  CAPTION,
  FLOOR,
  GAP,
  PANEL_PAD,
  STAGGER,
  tileHeight,
  type Layout,
} from "./screen";

export interface Visit {
  /** 1-based floor. */
  z: number;
  /** Which visit of this floor it is, 1-based, for the caption. */
  ordinal: number;
  /**
   * **Slider-stop** index range this visit covers, `from` inclusive and `to`
   * exclusive. Stops, not steps: a visit is a run of consecutive actions on one
   * floor, which is what keeps walked-through floors off the strip.
   */
  from: number;
  to: number;
}

/**
 * A floor appears once per visit, so a floor the route returns to appears more
 * than once.
 *
 * `[D]` **Visits are derived from the slider's stops, not from every step.** A
 * route crosses floors it merely walks through on the way to the next action,
 * and those were getting a tile each — a column of floors the player never did
 * anything on, pushing the ones that matter off the strip. A visit is now a
 * maximal run of *stops* on one floor, so a floor earns a tile exactly when the
 * player acts on it. The trail still crosses the gap in one dashed segment, so
 * the walk-through reads as travel rather than vanishing.
 */
export function computeVisits(timeline: Timeline, stops: number[]): Visit[] {
  const floorAt = (step: number): number =>
    step === 0 ? timeline.initial.z : timeline.steps[step - 1]!.player.z;

  const seen = new Map<number, number>();
  const visits: Visit[] = [];
  stops.forEach((step, i) => {
    const z = floorAt(step);
    const last = visits.at(-1);
    if (!last || last.z !== z) {
      const ordinal = (seen.get(z) ?? 0) + 1;
      seen.set(z, ordinal);
      visits.push({ z, ordinal, from: i, to: i + 1 });
    } else {
      last.to = i + 1;
    }
  });
  return visits.length > 0 ? visits : [{ z: timeline.initial.z, ordinal: 1, from: 0, to: 0 }];
}

/** The visit a stop index belongs to. */
export function visitOfStop(visits: Visit[], stop: number): number {
  for (let i = visits.length - 1; i >= 0; i--) if (stop >= visits[i]!.from) return i;
  return 0;
}

/**
 * A stretch of route the strip can show without moving — hence the name.
 *
 * `[D]` **Not called a "segment".** `DESIGN_ROUTE_EDITING.md` §4 already owns
 * that word for the user-named, skippable divisions of a route, which are a
 * different thing entirely: those are the player's own construct and survive
 * editing, while these are a function of how wide the window happens to be.
 * The trail's line segments are a third meaning again. Naming this one for what
 * it does — bound the scrolling — keeps all three apart.
 */
export interface ScrollUnit {
  /** Visit index range, `from` inclusive and `to` exclusive. */
  from: number;
  to: number;
  /** The distinct floors of this unit, in order of first visit: one tile each. */
  floors: number[];
}

/**
 * **Smart layout** (docs/UI.md §2, §6).
 *
 * A route spends long stretches oscillating within a handful of floors. One
 * tile per *visit* draws the same floor over and over and scrolls constantly,
 * when what the player wants is those few floors laid out once and held still.
 *
 * So the route is cut into **scroll units**: maximal runs of consecutive visits
 * whose distinct floors still fit the strip. Within one, each floor gets exactly
 * one tile and nothing moves at all — no repeats, no scrolling. The layout
 * changes only when scrubbing crosses into the next unit.
 *
 * `[D]` **The cut is driven by capacity, so there is no tuning parameter.**
 * That was the thing UI.md §6 said could not be chosen without watching real
 * scrubbing: "how much oscillation should count". It turns out not to need an
 * answer — how many floors fit on the screen is already the honest threshold,
 * and it adapts to the window instead of being guessed once.
 *
 * `[F]` Tower 1-5 has three floors, so it is one unit and never scrolls.
 */
export function computeScrollUnits(visits: Visit[], capacity: number): ScrollUnit[] {
  const cap = Math.max(1, capacity);
  const units: ScrollUnit[] = [];
  let floors: number[] = [];
  let from = 0;

  visits.forEach((v, i) => {
    if (!floors.includes(v.z) && floors.length === cap) {
      units.push({ from, to: i, floors });
      floors = [];
      from = i;
    }
    if (!floors.includes(v.z)) floors.push(v.z);
  });
  units.push({ from, to: visits.length, floors });
  return units;
}

export function scrollUnitOfVisit(units: ScrollUnit[], visit: number): number {
  for (let i = units.length - 1; i >= 0; i--) if (visit >= units[i]!.from) return i;
  return 0;
}

/** Which tile a visit occupies within its unit: its floor's slot. */
export function slotOfVisit(unit: ScrollUnit, visits: Visit[], visit: number): number {
  const z = visits[visit]?.z;
  const i = z === undefined ? -1 : unit.floors.indexOf(z);
  return i < 0 ? 0 : i;
}

/** The visit a step index falls in. */
export function visitAt(visits: Visit[], step: number): number {
  for (let i = visits.length - 1; i >= 0; i--) if (step >= visits[i]!.from) return i;
  return 0;
}

export function tileOrigin(index: number, scroll: number, layout: Layout): { x: number; y: number } {
  return {
    x: PANEL_PAD + GAP + index * STAGGER - scroll,
    y: GAP + (index % 2) * (tileHeight() + GAP),
  };
}

/**
 * `[D]` docs/UI.md §2: the strip scrolls left only when the current floor
 * would otherwise be offscreen. Scrubbing back and forth between two visible
 * tiles scrolls nothing — movement only ever buys newly-needed information.
 *
 * This returns where the strip *wants* to be; `approachScroll` gets it there.
 */
/**
 * `[F]` The margin is not cosmetic. Tiles are laid out from `GAP`, and the
 * current one wears a 3 px frame that sits OUTSIDE its 240 px — so a tile
 * flush against either edge of the clip box loses its frame, and the earlier
 * arithmetic (which ignored both the leading `GAP` and the frame) left the
 * right-hand edge of a rightmost tile cut off entirely.
 */
const EDGE = GAP + 3;

export function scrollFor(current: number, scroll: number, layout: Layout, stripWidth: number): number {
  // Content coordinates: a tile's left edge is GAP + i * STAGGER, and the
  // visible window spans [scroll, scroll + clip), where the clip box is the
  // strip plus the gap either side of it.
  const clip = stripWidth + GAP * 2;
  const left = GAP + current * STAGGER;
  const right = left + FLOOR;
  if (left - EDGE < scroll) return Math.max(0, left - EDGE);
  if (right + EDGE > scroll + clip) return right + EDGE - clip;
  return scroll;
}

/** Converge to within a pixel in about this long, whatever the distance. */
export const SCROLL_SETTLE_MS = 500;

/**
 * `[D]` Exponential ease from where the strip is to where it wants to be,
 * **quantised to whole pixels** so the floors never land on a half-pixel and
 * blur — the one rule the whole renderer is built around (§4.1).
 *
 * The rate is expressed as a time constant rather than a per-frame fraction, so
 * the motion takes the same half-second on a 60 Hz and a 144 Hz display. The
 * final pixel is snapped rather than approached, because an exponential never
 * actually arrives and a strip that is forever 0.4 px out would redraw forever.
 */
export function approachScroll(from: number, to: number, dtMs: number): number {
  if (from === to) return to;
  // Reach ~99% of the distance in SCROLL_SETTLE_MS.
  const k = 1 - Math.exp((-4.6 * dtMs) / SCROLL_SETTLE_MS);
  const next = from + (to - from) * k;
  return Math.abs(to - next) < 1 ? to : Math.round(next);
}

export function stripWidth(layout: Layout, panelW: number): number {
  return layout.w - panelW - PANEL_PAD * 2 - GAP * 2;
}

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  floors: FloorCache,
  manifest: AtlasManifest,
  sheet: CanvasImageSource,
  tower: { floors: Array<{ name: string }> },
  unit: ScrollUnit,
  currentSlot: number,
  scroll: number,
  layout: Layout,
  panelW: number,
): void {
  const width = stripWidth(layout, panelW);
  const standard = fontFrom(manifest, "FONT_STANDARD");
  ctx.save();
  ctx.beginPath();
  ctx.rect(PANEL_PAD, 0, width + GAP * 2, layout.h);
  ctx.clip();

  unit.floors.forEach((z, i) => {
    const { x, y } = tileOrigin(i, scroll, layout);
    if (x + FLOOR < PANEL_PAD || x > PANEL_PAD + width + GAP * 2) return;

    // Every tile has a border and a small gap around it (UI.md §2). The
    // current one gets a 3 px lavender frame rather than a 1 px one: at 1 px it
    // was invisible against fifteen other bordered tiles.
    const b = i === currentSlot ? 3 : BORDER;
    ctx.fillStyle = i === currentSlot ? "#cfc4ff" : "#3a3a44";
    ctx.fillRect(x - b, y - b, FLOOR + b * 2, tileHeight() + b * 2);
    ctx.drawImage(floors.image(z), x, y);

    // The name strip. The current action's summary is drawn into its right-hand
    // end afterwards, over the name if the two collide (docs/UI.md §6).
    ctx.fillStyle = "#15151a";
    ctx.fillRect(x, y + FLOOR, FLOOR, CAPTION);
    drawText(ctx, sheet, standard, tower.floors[z - 1]?.name ?? `Floor ${z}`, x + 3, y + FLOOR + 5);
  });
  ctx.restore();
}
