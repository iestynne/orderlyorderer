// SPEC-007 §5 + docs/UI.md §2 — the timeline panel.
//
// Floors laid out in the order the route visits them, one tile per floor of the
// working set, filling the panel in reading order: left to right, top to
// bottom, the block centred in whatever room the window leaves.
//
// `[D]` **Nothing scrolls, and nothing is staggered.** The strip used to slide
// sideways, so tiles were laid in a two-row bricklayer pattern half a tile
// apart — that was what made "further right is later" unambiguous while a tile
// could be half off the edge. The panel shows one working set at a time and
// jumps between them, so there is no sliding to disambiguate, and reading order
// says which is later on its own. Taking the stagger out is also what lets a
// wide window hold three rows of floors instead of two.

import type { AtlasManifest } from "../../../tools/atlas/build";
import { drawText, fontFrom } from "./atlas";
import type { FloorCache } from "./floor";
import { BORDER, CAPTION, FLOOR, GAP, PANEL_PAD, tileHeight, type Layout } from "./screen";

export interface Visit {
  /** 1-based floor. */
  z: number;
  /** Which visit of this floor it is, 1-based, for the caption. */
  ordinal: number;
  /**
   * **Slider-stop** index range this visit covers, `from` inclusive and `to`
   * exclusive. Stops, not steps: a visit is a run of consecutive actions on one
   * floor, which is what keeps walked-through floors off the panel.
   */
  from: number;
  to: number;
}

/**
 * A floor appears once per visit, so a floor the route returns to appears more
 * than once.
 *
 * `[D]` **Visits are derived from where the player is at each stop**, not from
 * every step. Past a failure that position is where the player *would* be — the
 * document knows every action's target whether the simulator reached it or not —
 * so the panel keeps showing floors instead of stopping dead at the break.
 *
 * `[D]` One tile per run of stops on a floor, not per step. A
 * route crosses floors it merely walks through on the way to the next action,
 * and those were getting a tile each — a column of floors the player never did
 * anything on, pushing the ones that matter off the panel. A visit is a maximal
 * run of *stops* on one floor, so a floor earns a tile exactly when the player
 * acts on it. The trail still crosses the gap in one dashed segment, so the
 * walk-through reads as travel rather than vanishing.
 */
export function computeVisits(positions: ReadonlyArray<{ z: number }>): Visit[] {
  const seen = new Map<number, number>();
  const visits: Visit[] = [];
  positions.forEach((p, i) => {
    const z = p.z;
    const last = visits.at(-1);
    if (!last || last.z !== z) {
      const ordinal = (seen.get(z) ?? 0) + 1;
      seen.set(z, ordinal);
      visits.push({ z, ordinal, from: i, to: i + 1 });
    } else {
      last.to = i + 1;
    }
  });
  return visits.length > 0 ? visits : [{ z: 1, ordinal: 1, from: 0, to: 0 }];
}

/** The visit a stop index belongs to. */
export function visitOfStop(visits: Visit[], stop: number): number {
  for (let i = visits.length - 1; i >= 0; i--) if (stop >= visits[i]!.from) return i;
  return 0;
}

/**
 * A stretch of route the panel can show at once — its **working set**.
 *
 * `[D]` **Not called a "segment".** `DESIGN_ROUTE_EDITING.md` §4 already owns
 * that word for the user-named, skippable divisions of a route, which are a
 * different thing entirely: those are the player's own construct and survive
 * editing, while these are a function of how big the window happens to be. The
 * trail's line segments are a third meaning again. D34.
 */
export interface WorkingSet {
  /** Visit index range, `from` inclusive and `to` exclusive. */
  from: number;
  to: number;
  /** The distinct floors of this set, in order of first visit: one tile each. */
  floors: number[];
}

/**
 * **Smart layout** (docs/UI.md §2).
 *
 * A route spends long stretches oscillating within a handful of floors. One
 * tile per *visit* draws the same floor over and over, when what the player
 * wants is those few floors laid out once and held still. So the route is cut
 * into working sets: maximal runs of consecutive visits whose distinct floors
 * still fit the panel. Within one, each floor gets exactly one tile and nothing
 * moves at all. The layout changes only when scrubbing crosses into the next.
 *
 * `[D]` **The cut is driven by capacity, so there is no tuning parameter.** How
 * many floors fit on the screen is the honest threshold, and it adapts to the
 * window instead of being guessed once.
 */
export function computeWorkingSets(visits: Visit[], capacity: number): WorkingSet[] {
  const cap = Math.max(1, capacity);
  const sets: WorkingSet[] = [];
  let floors: number[] = [];
  let from = 0;

  // `[I]` **Laid out by floor number, not by order of first visit.** Which
  // floors a set holds is decided by the route; where they sit is not, and
  // entry order put 7F left of 3F whenever the route happened to reach it
  // first. Reading a panel whose tiles are in no order at all is much harder
  // than reading one that climbs, and the set's membership — the thing the
  // capacity rule decides — is unaffected by how it is sorted.
  const push = (to: number): void => {
    sets.push({ from, to, floors: [...floors].sort((a, b) => a - b) });
  };

  visits.forEach((v, i) => {
    if (!floors.includes(v.z) && floors.length === cap) {
      push(i);
      floors = [];
      from = i;
    }
    if (!floors.includes(v.z)) floors.push(v.z);
  });
  push(visits.length);
  return sets;
}

export function workingSetOfVisit(sets: WorkingSet[], visit: number): number {
  for (let i = sets.length - 1; i >= 0; i--) if (visit >= sets[i]!.from) return i;
  return 0;
}

/** Which tile a visit occupies within its set: its floor's slot. */
export function slotOfVisit(set: WorkingSet, visits: Visit[], visit: number): number {
  const z = visits[visit]?.z;
  const i = z === undefined ? -1 : set.floors.indexOf(z);
  return i < 0 ? 0 : i;
}

/**
 * Where the tiles go: a grid of `cols` by `rows`, centred in the panel.
 *
 * `[D]` Computed once per frame and passed down, rather than every caller
 * re-deriving it from the layout. It replaces the scroll offset that used to be
 * threaded the same way, and unlike that offset it does not change between
 * frames unless the window does.
 */
export interface Grid {
  cols: number;
  rows: number;
  /** Top-left of the block, already centred for the tiles actually shown. */
  x0: number;
  y0: number;
}

/**
 * How many tiles fit beside the right panel.
 *
 * `[F]` `panelW` is not optional, and used to be. Defaulted to zero it
 * measured the whole window, so a 3 x 3 grid was told ten floors would fit: the
 * tenth had no cell at all — invisible, but still costing a stop on the slider
 * — and the ninth landed on a fourth row that was mostly off the panel. Both
 * callers now measure the same rectangle.
 */
export function gridCapacity(layout: Layout, panelW: number): number {
  const { cols, rows } = fit(layout, panelW);
  return Math.max(1, cols * rows);
}

function fit(layout: Layout, panelW: number): { cols: number; rows: number; w: number; h: number } {
  const w = layout.w - panelW - PANEL_PAD * 2;
  const h = layout.h - GAP * 2;
  return {
    cols: Math.max(1, Math.floor((w + GAP) / (FLOOR + GAP))),
    rows: Math.max(1, Math.floor((h + GAP) / (tileHeight() + GAP))),
    w,
    h,
  };
}

export function gridFor(layout: Layout, panelW: number, count: number): Grid {
  const { cols, rows, w, h } = fit(layout, panelW);
  const used = Math.max(1, Math.min(cols, count));
  const usedRows = Math.max(1, Math.min(rows, Math.ceil(count / cols)));
  return {
    cols,
    rows,
    x0: PANEL_PAD + Math.round((w - (used * FLOOR + (used - 1) * GAP)) / 2),
    y0: GAP + Math.round((h - (usedRows * tileHeight() + (usedRows - 1) * GAP)) / 2),
  };
}

/** Reading order: left to right, then down. */
export function tileOrigin(grid: Grid, index: number): { x: number; y: number } {
  return {
    x: grid.x0 + (index % grid.cols) * (FLOOR + GAP),
    y: grid.y0 + Math.floor(index / grid.cols) * (tileHeight() + GAP),
  };
}

export function drawTimeline(
  ctx: CanvasRenderingContext2D,
  floors: FloorCache,
  manifest: AtlasManifest,
  sheet: CanvasImageSource,
  tower: { floors: Array<{ name: string }> },
  set: WorkingSet,
  currentSlot: number,
  grid: Grid,
  layout: Layout,
  panelW: number,
  /** The current tile's frame: lavender, or red inside a failed stretch. */
  accent = "#cfc4ff",
  /** Dashed when the current action is switched off, as its row is. */
  dash: number[] = [],
): void {
  const standard = fontFrom(manifest, "FONT_STANDARD");
  ctx.save();
  ctx.beginPath();
  ctx.rect(PANEL_PAD, 0, layout.w - panelW - PANEL_PAD * 2, layout.h);
  ctx.clip();

  set.floors.forEach((z, i) => {
    const { x, y } = tileOrigin(grid, i);

    // Every tile has a border and a small gap around it (UI.md §2). The current
    // one gets a 3 px frame rather than a 1 px one: at 1 px it was invisible
    // against fifteen other bordered tiles.
    const b = i === currentSlot ? 3 : BORDER;
    // `[F]` A dashed frame has to be **stroked**, and this was a filled block.
    // So the block is laid down in the ordinary border colour and the accent
    // stroked over it: solid, that is pixel-for-pixel what the fill gave, and
    // dashed it lets the border show through the gaps rather than the floor.
    const dashed = i === currentSlot && dash.length > 0;
    ctx.fillStyle = i === currentSlot && !dashed ? accent : "#3a3a44";
    ctx.fillRect(x - b, y - b, FLOOR + b * 2, tileHeight() + b * 2);
    if (dashed) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = b;
      ctx.setLineDash(dash);
      ctx.strokeRect(x - b / 2, y - b / 2, FLOOR + b, tileHeight() + b);
      ctx.setLineDash([]);
    }
    ctx.drawImage(floors.image(z), x, y);

    // The name strip. The current action's summary is drawn into its right-hand
    // end afterwards, over the name if the two collide (docs/UI.md §6).
    ctx.fillStyle = "#15151a";
    ctx.fillRect(x, y + FLOOR, FLOOR, CAPTION);
    drawText(ctx, sheet, standard, tower.floors[z - 1]?.name ?? `Floor ${z}`, x + 3, y + FLOOR + 5);
  });
  ctx.restore();
}
