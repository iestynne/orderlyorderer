// SPEC-009 §4 — the scenarios, and where on the canvas each step points.
//
// `[D]` **A scenario is data, not code.** The list below says what to look at;
// `pointOf` turns a named target into a pixel, and `run.ts` does no arithmetic
// of its own. The point of the split is that `pointOf` computes every target
// from `layout()`, `state()` and **the app's own pure geometry functions** —
// `rowTop`, `tileOrigin`, `failureMarkBox`, `cogHitbox`. It never asks the app
// where something is. A hitbox that has drifted from the mark it is under
// therefore shows up as a shot pointing at the wrong thing, which is exactly
// the class of fault §1 was written for: four of round six's thirteen were
// interaction faults and none is visible in a static frame.
//
// `[D]` **No per-scenario crop.** §4 draft 1 gave a scenario a `crop`, which
// would make its golden the cropped region — and a golden that sees less of
// the frame catches less. Cropping is for reporting a claim about a shot that
// already exists, so it lives in `crop.ts` and on the command line.

import { ROW_H, actionsGeometry, checkboxAt } from "../../src/ui/render/actions";
import { gridFor, tileOrigin } from "../../src/ui/render/left";
import { cogHitbox } from "../../src/ui/render/marks";
import { failureMarkBox, sliderGeometry } from "../../src/ui/render/right";
import { CELL, PANEL_W, type Layout } from "../../src/ui/render/screen";
import type { OrderlyState } from "../../src/ui/dev";
import type { ErrorCode } from "../../src/sim/types";

/**
 * A cell of a floor: **which floor**, then 1-based (x, y).
 *
 * `[F]` The floor, never the tile index. A tile index is a position in the
 * panel, and the panel is laid out by floor number — so when that sort landed,
 * every scenario naming `tile: 0` silently moved to a different floor and went
 * on producing a plausible-looking shot of the wrong thing. `added-action`
 * stopped adding anything and `hover-cell` started hovering an unreachable
 * square, and nothing failed. A floor number cannot drift like that.
 */
export interface CellTarget {
  floor: number;
  x: number;
  y: number;
}

export type Target =
  /** A row of the action list, in offsets from the current action. */
  | { row: number }
  /** That row's enable box, hard right — the toggle, not the selection. */
  | { checkbox: number }
  | { cell: CellTarget }
  /** The break mark beside the slider. */
  | "exclaim"
  /** The `?` button that opens the help panel. */
  | "help";

export type Step =
  | { hover: Target }
  | { click: Target }
  /** Press on a target, move `rows` rows up the list, release. */
  | { drag: { from: Target; rows: number } };

export interface Scenario {
  name: string;
  /** A stem under `data/saves/tests/`; the tower is what precedes its first dot. */
  fixture: string;
  record: number;
  stop: number;
  steps?: Step[];
  /**
   * The error this shot is meant to be of, where it is meant to be of one.
   * Checked headlessly, because a scenario can drift into showing a *different*
   * failure and still produce a plausible picture: two did, the moment the
   * simulator stopped walking to stale positions.
   */
  code?: ErrorCode;
  /**
   * This shot has a broken route in it, however it got that way.
   *
   * `[F]` Not derivable from the fixture: `added-then-broken` starts from a
   * clean record and breaks it with two edits. Every scenario carrying a
   * `code` breaks by definition, so this is only for the ones that do not.
   */
  breaks?: boolean;
  /** What this shot is evidence about. Read it before re-baselining one. */
  shows: string;
}

/**
 * The pixel a target names, at the centre of its box.
 *
 * `[F]` Throws rather than guessing. A target that cannot be placed — an
 * `exclaim` on a route that does not break — is a scenario that has stopped
 * meaning what it says, and pointing the mouse somewhere plausible instead
 * would hide that behind a golden that still matched.
 */
export function pointOf(t: Target, layout: Layout, s: OrderlyState): { x: number; y: number } {
  if (t === "help") {
    const b = cogHitbox(layout, PANEL_W);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  if (t === "exclaim") {
    if (s.failedFrom === null) throw new Error("target `exclaim`: this route does not break");
    const b = failureMarkBox(layout, s.failedFrom, s.stopCount);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  if ("row" in t) {
    const g = actionsGeometry(layout, sliderGeometry(layout));
    // `[F]` Left of the enable box, which is 14 px hard right (`checkboxAt`):
    // the middle of the whole row would toggle the action instead of picking
    // it, and a scenario that meant to select would silently disable.
    return { x: g.x + (g.w - 14) / 2, y: s.pinY - t.row * ROW_H + ROW_H / 2 };
  }
  if ("checkbox" in t) {
    const b = checkboxAt(actionsGeometry(layout, sliderGeometry(layout)), s.pinY, t.checkbox);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  const grid = gridFor(layout, PANEL_W, s.floors.length);
  const slot = s.floors.indexOf(t.cell.floor);
  if (slot < 0) {
    throw new Error(`target floor ${t.cell.floor}: the panel is showing ${s.floors.join(", ")}`);
  }
  const o = tileOrigin(grid, slot);
  return { x: o.x + (t.cell.x - 1) * CELL + CELL / 2, y: o.y + (t.cell.y - 1) * CELL + CELL / 2 };
}

/**
 * `[F]` **Every fixture record here fails or runs clean by measurement, not by
 * its name.** `1-5.INSUFFICIENT-POWER` is what the *game* refused to load; 34
 * of its 35 records simulate perfectly well, and record 25 is the one that
 * breaks. The deficit scenarios use `2-1.INSUFFICIENT-GOLD` record 10 instead
 * — four stops, the break at 2 — because a route with a stop either side of
 * its break can show clean, red and grey from one fixture.
 */
/**
 * One shot per error code the deficit UI can actually be asked to draw
 * (`TODO.md` §A1b, the failure corpus).
 *
 * `[D]` **Each is a single disable on a clean corpus route**, taken at the stop
 * that then breaks — so the shot is the red row, its frame, and that code's own
 * deficit badge. A disable rather than an addition because a disable can be
 * aimed: work back from the gate to the action that supplies what it needs and
 * switch that one off. An addition has to be a cell that is insertable *and*
 * spends the right resource, which is a search. `[I]` iestyn.
 *
 * `[D]` **Each is named for the code it shows**, so `break-need-gold` cannot be
 * mistaken for `break-gold-gate` — which is the canonical picture of a break
 * rather than a case of one code. A test holds the two in step.
 *
 * `[F]` **Found by sweep, not by reading the map**: every clean record of all
 * 14 towers, disabling each of its first 150 actions, keeping one example per
 * code. The numbers below are that sweep's output.
 *
 * `[F]` **Seven of the fifteen codes are missing, and six of them cannot
 * appear here at all.** `NEED_GEMS` cannot fire while a route carries the
 * `UNLIMITED_GEMS` sentinel (`STATUS.md`). `OFF_MAP` and `NOT_ADJACENT` guard
 * malformed input, not anything a pointer can do. `UNSUPPORTED_ENTITY` is
 * orbs, which the corpus excludes. And `BLOCKED_IRON`, `BLOCKED_ONE_WAY` and
 * `SPIKE_TOO_STRONG` are codes for an action **aimed at** the obstacle: the
 * auto-pather routes around anything it cannot cross and reports `NO_PATH`
 * instead, and an action aimed straight at one is refused at click time by
 * `classify` — so they are the no-entry sign (`hover-invalid`), never a break.
 * The sweep found none of the three anywhere in the corpus, which is that
 * argument measured rather than asserted.
 */
const FAILURES: readonly Scenario[] = [
  {
    name: "break-enemy-too-strong",
    fixture: "iestyn.2026.08.28/1-5",
    record: 0,
    stop: 18,
    code: "ENEMY_TOO_STRONG",
    steps: [{ click: { checkbox: -1 } }],
    shows: "ENEMY_TOO_STRONG: the power deficit under the player, the enemy's own value beside it",
  },
  {
    name: "break-no-path",
    fixture: "iestyn.2026.08.28/EX-3",
    record: 0,
    stop: 3,
    code: "NO_PATH",
    steps: [{ click: { checkbox: -1 } }],
    shows: "NO_PATH: a break with no deficit numbers at all, because nothing is short — the square is unreachable",
  },
  {
    name: "break-need-gold",
    fixture: "iestyn.2026.08.28/2-4",
    record: 19,
    stop: 1,
    code: "NEED_GOLD",
    steps: [{ click: { checkbox: -1 } }],
    shows: "NEED_GOLD: the gold deficit on a gold gate, the first action of the route having been switched off",
  },
  {
    name: "break-need-light-key",
    fixture: "iestyn.2026.08.28/EX-2",
    record: 3,
    stop: 1,
    code: "NEED_LIGHT_KEY",
    steps: [{ click: { checkbox: -1 } }],
    shows: "NEED_LIGHT_KEY: the light-key deficit on a light gate",
  },
  {
    name: "break-need-dark-key",
    fixture: "iestyn.2026.08.28/2-3",
    record: 0,
    stop: 5,
    code: "NEED_DARK_KEY",
    steps: [{ click: { checkbox: -3 } }],
    shows: "NEED_DARK_KEY: the dark-key deficit, and eight rows of clean actions between the disable and the break",
  },
  {
    name: "break-need-pickaxe",
    fixture: "iestyn.2026.08.28/EX-1",
    record: 8,
    stop: 58,
    code: "NEED_PICKAXE",
    steps: [{ click: { checkbox: -14 } }],
    shows: "NEED_PICKAXE: a Weak Wall with no pickaxe, fourteen rows after the action that would have supplied one",
  },
  {
    name: "break-need-hyper-pickaxe",
    fixture: "iestyn.2026.08.28/2-3",
    record: 8,
    stop: 4,
    code: "NEED_HYPER_PICKAXE",
    steps: [{ click: { checkbox: -1 } }],
    shows: "NEED_HYPER_PICKAXE: a Reinforced Wall — a different code and a different remedy from the Weak Wall above",
  },
];

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "clean",
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 40,
    shows: "a clean current action: lavender row, lavender frame, no deficit anywhere",
  },
  {
    name: "added-action",
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 0,
    steps: [{ click: { cell: { floor: 2, x: 8, y: 11 } } }],
    shows: "an action the player added: blue row, blue frame, the `+` badge",
  },
  {
    name: "break-gold-gate",
    breaks: true,
    fixture: "2-1.INSUFFICIENT-GOLD",
    record: 10,
    stop: 2,
    shows: "the action that breaks the route: red row and frame, the gold deficit, the mark on the track",
  },
  {
    // `[F]` **This was `2-1.INSUFFICIENT-GOLD` stop 3 and showed nothing.**
    // That route has four stops and breaks at 2, and `stops.length ===
    // sites.length + 1` (SPEC-008 §4.1) — so stop 3 is the route's *final
    // position*, which has no action and therefore no row. The shot had a list
    // of three actions and no current row at all, which is not "one past the
    // break" and is not grey. A route needs actions **after** its break to show
    // this, so it is built by disabling one early in a longer route.
    name: "past-break",
    breaks: true,
    fixture: "iestyn.2026.08.28/1-5",
    record: 0,
    stop: 20,
    steps: [{ click: { checkbox: -3 } }],
    shows: "two past the break: grey rows and a grey frame, for actions that would happen and cannot",
  },
  {
    name: "hover-row",
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 40,
    steps: [{ hover: { row: 2 } }],
    shows: "the row under the pointer says it is clickable, and it is the row the pointer is in",
  },
  {
    name: "hover-exclaim",
    breaks: true,
    fixture: "2-1.INSUFFICIENT-GOLD",
    record: 10,
    stop: 0,
    steps: [{ hover: "exclaim" }],
    shows: "the break mark lit, from a stop before the break: it is a control as well as a mark",
  },
  {
    name: "hover-cell",
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 0,
    steps: [{ hover: { cell: { floor: 2, x: 8, y: 11 } } }],
    shows: "hovering an insertable cell: the add mark on it, and the preview row spliced into the list",
  },
  {
    name: "hover-invalid",
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 0,
    steps: [{ hover: { cell: { floor: 2, x: 1, y: 1 } } }],
    shows: "hovering a cell there is no path to: the game's no-entry sign, and no preview row",
  },
  {
    name: "help-open",
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 40,
    steps: [{ click: "help" }],
    shows: "the help panel open, its two switches and the key list, clear of the right panel",
  },
  {
    name: "drag-list",
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 40,
    steps: [{ drag: { from: { row: 0 }, rows: 3 } }],
    shows: "a drag up the list: the rows hold still and the current action lands under the pointer",
  },
  {
    // `[F]` **The one picture that needs an addition.** Every other failure
    // here is cheaper to reach by disabling an action, and `accentOf` treats
    // `inserted` and `breaks` as independent — a break outranks the add, so
    // the row goes red and *keeps* its `+`. That combination exists only when
    // an added action is the one that fails, and nothing else covers it.
    //
    // `[F]` It takes two edits, because an addition **cannot fail on its own**:
    // `insertAt` only inserts when `classify` says the action succeeds, so a
    // click that would break the route is refused with the no-entry sign
    // instead. The inserted attack is made while the power is there, and the
    // disable then takes that power away — `[I]` iestyn's framing: a failure
    // from an addition is always a resource the addition spent, or one the
    // route no longer collects.
    //
    // `[F]` Measured, not chosen: at stop 7 of this record, inserting z1 (3,14)
    // lands the new action at stop 8, and disabling the action four rows below
    // it leaves that attack short of power. `ENEMY_TOO_STRONG`.
    name: "added-then-broken",
    breaks: true,
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 7,
    steps: [{ click: { cell: { floor: 1, x: 3, y: 14 } } }, { click: { checkbox: -4 } }],
    shows: "red over blue: the added action is the break — red row and frame, and the + badge still says it was added",
  },
  ...FAILURES,
];
