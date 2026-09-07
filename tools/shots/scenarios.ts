// SPEC-009 §4 — the scenarios, and where on the canvas each step points.
//
// A scenario is data. `pointOf` turns a target into a pixel using the app's
// own geometry functions — never by asking the app where something is — so a
// hitbox that has drifted shows up as a shot of the wrong thing.

import { ROW_H, actionsGeometry, checkboxAt } from "../../src/ui/render/actions";
import { gridFor, tileOrigin } from "../../src/ui/render/left";
import { cogHitbox } from "../../src/ui/render/marks";
import { failureMarkBox, sliderGeometry } from "../../src/ui/render/right";
import { CELL, PANEL_W, type Layout } from "../../src/ui/render/screen";
import type { OrderlyState } from "../../src/ui/dev";
import type { ErrorCode } from "../../src/sim/types";

/** A cell of a floor: which floor, then 1-based (x, y). The floor, not the tile slot, which the layout decides. */
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
  /** The error this shot shows. Checked headlessly: a shot of the wrong failure still looks plausible. */
  code?: ErrorCode;
  /** The route in this shot breaks, by fixture or by edit. Implied by `code`. */
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
 * One shot per error code the deficit UI can be asked to draw (TODO §A1b),
 * each a single disable on a clean corpus route, named for its code. Found by
 * sweeping every clean record of all 14 towers. The seven codes absent here
 * cannot be a break at all — SPEC-009 §4 says which and why.
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
    // Needs actions after the break, so it is a disable early in a long route.
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
    // The one picture that needs an addition: a row both inserted and breaking.
    // Two edits, because an insertion cannot fail on its own — `classify`
    // refuses it — so the disable afterwards is what takes the power away.
    name: "added-then-broken",
    breaks: true,
    fixture: "1-5.INSUFFICIENT-POWER",
    record: 0,
    stop: 7,
    steps: [{ click: { cell: { floor: 1, x: 3, y: 14 } } }, { click: { checkbox: -4 } }],
    shows: "red over blue: the added action is the break — red row and frame, and the + badge still says it was added",
  },
  {
    // 2-5 is built from pop-ups; record 0 raises one at stop 1.
    name: "popup-wall",
    fixture: "iestyn.2026.08.28/2-5",
    record: 0,
    stop: 1,
    shows: "a pop-up wall knocked into place behind the player: the action that walks off it is the one that raises it",
  },
  ...FAILURES,
];
