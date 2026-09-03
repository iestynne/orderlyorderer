// SPEC-008 §4 — the forward pass: mainline plus per-segment forks.
//
// `[D]` **A single forward pass over epochs.** Each epoch is evaluated against
// the state its predecessors produced, so nothing cascades backwards
// (invariant 6). A skippable epoch whose active segment fails is rewound to its
// start and its successor continues from there.
//
// `[D]` **Rewind is `Cursor.seekTo`**, not a re-simulation from zero: SPEC-004's
// `undo(do(s)) == s` and SPEC-007's seek symmetry are what make that sound, and
// this spec adds no new undo machinery. The Cursor here walks a `steps` array
// that is still being appended to, which is exactly what makes it usable as the
// running state of a route that is still being built.
//
// Pure module: no UI imports (D7).

import { Cursor, stepsThroughWaypoints } from "../cursor";
import { effectiveCell, inBounds } from "../grid";
import { initialPlayer, simulate } from "../simulate";
import type { Player, SimError, Step, Timeline, TowerJSON, Waypoint } from "../types";
import { activeSegment, segmentWaypoints, type Route, type Segment } from "./document";

export interface EpochResult {
  /** A skippable epoch whose active segment failed. */
  skipped: boolean;
  /** SPEC-004 §7, the first failure in the active segment. */
  error?: SimError;
  /**
   * Indexed **by segment**, so the UI can colour each alternative where it
   * sits. `null` is "passes, or was not run"; the active segment's own slot is
   * always `null` and its outcome is `error`.
   */
  forks: (SimError | null)[];
  /** Index into `mainline.steps`. */
  startStep: number;
  /** Index into `waypoints` where this epoch's contribution begins. */
  startWaypoint: number;
}

export interface Evaluation {
  /** Over the realised route: the active segments, minus the skipped epochs. */
  mainline: Timeline;
  epochs: EpochResult[];
  /**
   * The realised waypoint list the mainline was run against, `2S+1` shaped.
   * `[F]` It is `flatten()` minus every skipped epoch, which is why it is
   * returned rather than recomputed: only evaluation knows which those are.
   */
  waypoints: Waypoint[];
  /**
   * One per realised action: did it find its work already done?
   *
   * `[D]` **"Its cell is empty and it changed nothing"**, and both halves are
   * needed. Changing nothing on its own catches a spike crossed with a Feather,
   * which the game does record and which must therefore still be exported; an
   * empty cell on its own catches the pop-up chain, which changes plenty. What
   * is left is exactly the case an edit creates — an action whose enemy is
   * already dead, whose item is already taken, whose gate is already open.
   */
  noopActions: boolean[];
}

export interface EvaluateOptions {
  /** Off for invariant 8, which asserts the mainline does not notice them. */
  forks?: boolean;
}

export function evaluate(route: Route, tower: TowerJSON, options: EvaluateOptions = {}): Evaluation {
  const gemsOwned = route.gemsOwned;
  const initial = initialPlayer({ tower, gemsOwned, route: [] });
  const steps: Step[] = [];
  const mainline: Timeline = { tower, initial, steps };
  const cursor = new Cursor(mainline);
  const epochs: EpochResult[] = [];
  const waypoints: Waypoint[] = [];
  let stopped = false;

  // From the epoch's start state, which is where the cursor stands. `simulate`
  // copies the cells and kills it is handed, so a fork cannot write through to
  // the mainline it borrowed its prefix from (invariant 8).
  const from = (segment: Segment): Timeline =>
    simulate(
      { tower, gemsOwned, route: segmentWaypoints(segment) },
      { player: cursor.player, cells: cursor.cells, kills: cursor.kills, waypointBase: waypoints.length },
    );

  for (const epoch of route.epochs) {
    const result: EpochResult = {
      skipped: false,
      forks: epoch.segments.map(() => null),
      startStep: steps.length,
      startWaypoint: waypoints.length,
    };
    epochs.push(result);

    const active = activeSegment(epoch);
    if (stopped) {
      // Never run, but still part of the route: its actions stay on the
      // timeline so the player sees the whole red tail, not a truncated one.
      waypoints.push(...segmentWaypoints(active));
      continue;
    }

    // Forks first, while the cursor is still at the epoch's start.
    if (options.forks !== false) {
      epoch.segments.forEach((segment, i) => {
        if (i !== epoch.active) result.forks[i] = from(segment).error ?? null;
      });
    }

    const run = from(active);
    steps.push(...run.steps);
    cursor.seekTo(steps.length);

    if (run.error === undefined) {
      waypoints.push(...segmentWaypoints(active));
      continue;
    }
    result.error = run.error;
    if (epoch.skippable) {
      // Rewind to the epoch's start and let the successor continue from there.
      result.skipped = true;
      cursor.seekTo(result.startStep);
      steps.length = result.startStep;
      continue;
    }
    // `[D]` A failing non-skippable epoch stops the whole route. Skippable is
    // the exception, not the default.
    waypoints.push(...segmentWaypoints(active));
    mainline.error = run.error;
    stopped = true;
  }

  if (!stopped) {
    const tail = simulate(
      { tower, gemsOwned, route: [route.final] },
      { player: cursor.player, cells: cursor.cells, kills: cursor.kills, waypointBase: waypoints.length },
    );
    steps.push(...tail.steps);
    if (tail.error !== undefined) mainline.error = tail.error;
  }
  waypoints.push(route.final);

  return { mainline, epochs, waypoints, noopActions: findNoops(tower, mainline, waypoints) };
}

/** SPEC-008 §4.2. One forward walk of the journal; see `Evaluation.noopActions`. */
function findNoops(tower: TowerJSON, mainline: Timeline, waypoints: readonly Waypoint[]): boolean[] {
  const actions = (waypoints.length - 1) >> 1;
  const out = new Array<boolean>(actions).fill(false);
  if (actions === 0) return out;

  const through = stepsThroughWaypoints(mainline, waypoints.length);
  // Cell edits made by the time each step has run, so a range test is a subtraction.
  const editsThrough = new Int32Array(mainline.steps.length + 1);
  mainline.steps.forEach((s, i) => {
    editsThrough[i + 1] = editsThrough[i]! + s.edits.length;
  });

  const cursor = new Cursor(mainline);
  for (let k = 0; k < actions; k++) {
    const from = k === 0 ? 0 : through[2 * k - 1]!;
    const to = through[2 * k + 1]!;
    cursor.seekTo(from);
    const before = cursor.player;
    const target = waypoints[2 * k + 1]!;
    // An edit can name a cell no map has; that action is a failure, never a
    // no-op, so it is not worth asking the grid about.
    const empty =
      inBounds(tower, target.z, target.x, target.y) &&
      effectiveCell(tower, cursor.cells, target.z, target.x, target.y) === 0;
    cursor.seekTo(to);
    out[k] = empty && editsThrough[to]! === editsThrough[from]! && same(before, cursor.player);
  }
  return out;
}

/** Everything an action could change about the player, position aside. */
function same(a: Player, b: Player): boolean {
  return (
    a.power === b.power && a.gold === b.gold && a.lightKeys === b.lightKeys && a.darkKeys === b.darkKeys &&
    a.pickaxes === b.pickaxes && a.gemsSpent === b.gemsSpent && a.held === b.held && a.win === b.win
  );
}

/** The epoch a realised waypoint index falls in. */
export function epochOfWaypoint(evaluation: Evaluation, waypointIndex: number): number {
  const es = evaluation.epochs;
  for (let i = es.length - 1; i >= 0; i--) if (waypointIndex >= es[i]!.startWaypoint) return i;
  return 0;
}
