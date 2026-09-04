// SPEC-008 §4.1, §4.2, §5, §6 — the editing session: the document, its
// evaluation, the stop model, undo, and the unsaved-changes marker.
//
// `[D]` **Document-tier changes set the marker; view-tier changes do not**
// (DESIGN §2.3). Every `Edit` is document-tier and nothing else is, which is why
// `edit()` is the only method that touches the document and no list of
// triggering actions has to be maintained.
//
// `[D]` The marker is a **comparison against the saved document**, not a sticky
// flag, because toggling an action off and back on must clear it. It never runs
// on the frame path: scrubbing touches nothing in the document, and an edit
// happens at the speed of a click, so the hash is computed synchronously here.

import { Cursor, stepsThroughWaypoints } from "../sim/cursor";
import { activeSegment, type Action, type OrdFile, type Route } from "../sim/route/document";
import { describeAction, type ActionSummary } from "../sim/route/describe";
import { apply, type Edit } from "../sim/route/edit";
import { evaluate, type Evaluation } from "../sim/route/evaluate";
import { documentHash, emit, ordFile } from "../sim/route/ordfile";
import { toSaveRecord } from "../sim/route/export";
import type { TowerJSON, Waypoint } from "../sim/types";
import type { ViewState } from "../store/working";

/** Where a stop's action lives in the document, so a click can edit it. */
export interface ActionSite {
  epoch: number;
  segment: number;
  /** Index within that segment, counting disabled actions. */
  index: number;
  action: Action;
  /** False where the action is disabled or its epoch was skipped. */
  live: boolean;
  /** Its index in the realised route, or null where it is not in it. */
  realised: number | null;
}

export type Badge = "inserted" | "disabled";

export class RouteSession {
  evaluation!: Evaluation;
  /**
   * SPEC-008 §4.1. One per action — disabled ones included — plus one for the
   * route's final position, so `stops.length === sites.length + 1`.
   */
  stops: number[] = [];
  sites: ActionSite[] = [];
  /** The first stop the route fails at, or null where it runs clean. */
  failedFrom: number | null = null;
  /**
   * Where the player stands at each stop — or **would** stand, past a failure.
   *
   * `[D]` The simulation stops at the break, so every later stop would report
   * the position it broke at and the whole rest of the route would vanish from
   * the timeline panel. The document knows each action's target whether the
   * simulator reached it or not, so past the break that is what is used: the
   * player keeps moving, the floors keep appearing, and the grey drawing says
   * these are actions that *would* happen (docs/UI.md §6).
   */
  positions: Waypoint[] = [];
  savedHash: string | null = null;

  /** By identity, which survives every op but `setDisabled` (which `edit` fixes up). */
  private readonly insertedSet = new Set<Action>();
  /**
   * SPEC-008 §5. The current contiguous run of insertions, and what `Z` has
   * taken back off it. Anything that is not another insertion ends the run.
   */
  private run: Array<{ epoch: number; segment: number; index: number }> = [];
  private redoable: Array<{ epoch: number; segment: number; index: number; action: Action }> = [];

  constructor(
    public document: OrdFile,
    public routeIndex: number,
    public readonly tower: TowerJSON,
    public view: ViewState,
  ) {
    this.reevaluate();
  }

  get route(): Route {
    return this.document.routes[this.routeIndex]!;
  }

  get dirty(): boolean {
    return documentHash(this.document) !== this.savedHash;
  }

  get canUndo(): boolean {
    return this.run.length > 0;
  }

  get canRedo(): boolean {
    return this.redoable.length > 0;
  }

  edit(e: Edit): void {
    const before = this.route;
    this.replace(apply(before, e));
    if (e.op === "insert") {
      this.insertedSet.add(e.action);
      this.run.push({ epoch: e.epoch, segment: e.segment, index: e.index });
      this.redoable.length = 0;
      return;
    }
    if (e.op === "setDisabled") {
      // The only op that replaces an action object, so the only one whose
      // "new since the last save" marker has to be carried across.
      const old = before.epochs[e.epoch]?.segments[e.segment]?.actions[e.index];
      const now = this.route.epochs[e.epoch]?.segments[e.segment]?.actions[e.index];
      if (old && now && this.insertedSet.delete(old)) this.insertedSet.add(now);
    }
    this.endRun();
  }

  /**
   * `[D]` A run ends at anything that is not another insertion — a scrub, a
   * toggle, a load. Undo therefore never walks back across a gap to dismantle
   * work somewhere the player is no longer looking (SPEC-008 §5).
   */
  endRun(): void {
    this.run.length = 0;
    this.redoable.length = 0;
  }

  /** `Z`: take back the last insertion of the current run. */
  undo(): void {
    const at = this.run.pop();
    if (at === undefined) return;
    const action = this.route.epochs[at.epoch]?.segments[at.segment]?.actions[at.index];
    if (action === undefined) return;
    this.redoable.push({ ...at, action });
    this.insertedSet.delete(action);
    this.replace(removeAction(this.route, at.epoch, at.segment, at.index));
  }

  /** `Y`: put it back. */
  redo(): void {
    const at = this.redoable.pop();
    if (at === undefined) return;
    this.run.push({ epoch: at.epoch, segment: at.segment, index: at.index });
    this.insertedSet.add(at.action);
    this.replace(apply(this.route, { op: "insert", ...at }));
  }

  /**
   * `[I]` Whether the player added this — which stays true when they switch it
   * off. `badgeOf` answered "disabled" first and so hid the `+` on exactly the
   * rows where it mattered most: an action you added and then tried without.
   */
  isInserted(action: Action): boolean {
    return this.insertedSet.has(action);
  }

  badgeOf(action: Action): Badge | null {
    if (action.disabled === true) return "disabled";
    return this.insertedSet.has(action) ? "inserted" : null;
  }

  /**
   * What the action at a stop did, for the Action List (SPEC-008 §4.2).
   *
   * `[D]` Takes a `Cursor` rather than owning one: the caller is already
   * seeking it to draw the floors, and a second cursor would walk the same
   * journal twice per frame.
   */
  summarise(cursor: Cursor, stop: number): ActionSummary | null {
    const site = this.sites[stop];
    if (site === undefined) return null;
    const was = cursor.index;
    // `[F]` **The player either side, then the cells — in that order.**
    // `cursor.cells` is the cursor's own array, not a copy, so seeking after
    // reading it hands `describeAction` the state the action produced rather
    // than the one it acted on: every enemy would read as empty floor, having
    // been killed. Both players are snapshots and can be taken in any order;
    // the cells cannot.
    cursor.seekTo(this.stops[stop] ?? 0);
    const after = cursor.player;
    cursor.seekTo(stop === 0 ? 0 : this.stops[stop - 1]!);
    const summary = describeAction(
      this.tower,
      cursor.cells,
      cursor.player,
      after,
      site.action.to,
      {
        error: this.failedFrom === stop ? this.evaluation.mainline.error : undefined,
        noop: site.realised !== null && this.evaluation.noopActions[site.realised] === true,
      },
    );
    cursor.seekTo(was);
    return summary;
  }

  /**
   * `[I]` The route's name, which the player will want to change: what they
   * imported was named for a save slot, and what they are building is theirs.
   *
   * `[D]` Document-tier, so it sets the unsaved-changes marker like every other
   * edit — but not an `Edit`, because it is not undoable and does not belong in
   * a run of insertions.
   */
  rename(name: string): void {
    const routes = this.document.routes.slice();
    routes[this.routeIndex] = { ...this.route, name };
    this.document = { ...this.document, routes };
  }

  markSaved(): void {
    this.savedHash = documentHash(this.document);
    this.insertedSet.clear();
  }

  /** `[D]` Paths rather than objects, because the working store is structured clone. */
  insertedPaths(): string[] {
    const out: string[] = [];
    this.route.epochs.forEach((epoch, e) => {
      epoch.segments.forEach((segment, s) => {
        segment.actions.forEach((action, i) => {
          if (this.insertedSet.has(action)) out.push(`${e}/${s}/${i}`);
        });
      });
    });
    return out;
  }

  restoreInserted(paths: readonly string[]): void {
    this.insertedSet.clear();
    for (const path of paths) {
      const [e, s, i] = path.split("/").map(Number);
      const action = this.route.epochs[e!]?.segments[s!]?.actions[i!];
      if (action) this.insertedSet.add(action);
    }
  }

  toOrd(): string {
    return emit(ordFile(this.document.routes));
  }

  toSaveRecord(): Uint8Array {
    return toSaveRecord(this.route, this.tower, this.evaluation);
  }

  private replace(route: Route): void {
    const routes = this.document.routes.slice();
    routes[this.routeIndex] = route;
    this.document = { ...this.document, routes };
    this.reevaluate();
  }

  private reevaluate(): void {
    this.evaluation = evaluate(this.route, this.tower);
    const { sites, stops } = stopModel(this.route, this.evaluation);
    this.sites = sites;
    this.stops = stops;
    this.positions = positionsOf(this.evaluation, sites, stops, this.route.final);
    const error = this.evaluation.mainline.error;
    this.failedFrom = error === undefined ? null : failingStop(sites, error.waypointIndex);
    this.view = { ...this.view, stop: Math.min(this.view.stop, Math.max(0, this.stops.length - 1)) };
  }
}

/** SPEC-008 §4.1, and the "would be" half of it. */
function positionsOf(evaluation: Evaluation, sites: ActionSite[], stops: number[], final: Waypoint): Waypoint[] {
  const steps = evaluation.mainline.steps;
  const reached = steps.length;
  const at = (step: number): Waypoint => {
    const p = step === 0 ? evaluation.mainline.initial : steps[step - 1]!.player;
    return { z: p.z, x: p.x, y: p.y };
  };
  return stops.map((step, i) => {
    // A stop the simulator got to reports where the player actually is; one it
    // never reached reports where the action would put them, which is its own
    // target -- the player ends up on the cell they act on.
    if (step < reached || i === 0) return at(step);
    const site = sites[i];
    return site === undefined ? final : site.action.to;
  });
}

export function cellKey(w: Waypoint): string {
  return `${w.z}:${w.x}:${w.y}`;
}

/** Drop one action, for undo. Not an `Edit`: it exists only to invert `insert`. */
function removeAction(route: Route, epoch: number, segment: number, index: number): Route {
  const epochs = route.epochs.slice();
  const e = epochs[epoch]!;
  const segments = e.segments.slice();
  const s = segments[segment]!;
  const actions = s.actions.slice();
  actions.splice(index, 1);
  segments[segment] = { ...s, actions };
  epochs[epoch] = { ...e, segments };
  return { ...route, epochs };
}

/**
 * SPEC-008 §4.1. One site and one stop per action, live or not, plus a final
 * stop for the route's live position.
 *
 * `[D]` A disabled action, and every action of a skipped epoch, takes its
 * **predecessor's** step index: seeking to it lands on the state the route was
 * already in, which is exactly true, the action having done nothing.
 */
function stopModel(route: Route, evaluation: Evaluation): { sites: ActionSite[]; stops: number[] } {
  const through = stepsThroughWaypoints(evaluation.mainline, evaluation.waypoints.length);
  const sites: ActionSite[] = [];
  const stops: number[] = [];
  let last = 0;

  route.epochs.forEach((epoch, e) => {
    const skipped = evaluation.epochs[e]?.skipped === true;
    // Where this epoch's waypoints start in the realised route; a skipped epoch
    // contributed none, so its actions all hold the running step index.
    let w = evaluation.epochs[e]?.startWaypoint ?? 0;
    activeSegment(epoch).actions.forEach((action, index) => {
      const live = !skipped && action.disabled !== true;
      sites.push({ epoch: e, segment: epoch.active, index, action, live, realised: live ? (w >> 1) : null });
      if (live) {
        // Its pair is (w, w + 1); the stop is after the `to` half.
        last = through[w + 1] ?? last;
        w += 2;
      }
      stops.push(last);
    });
  });
  stops.push(evaluation.mainline.steps.length);
  return { sites, stops };
}

/** The stop whose action the route failed on. */
function failingStop(sites: ActionSite[], waypointIndex: number): number {
  let w = 0;
  for (let i = 0; i < sites.length; i++) {
    if (!sites[i]!.live) continue;
    if (waypointIndex <= w + 1) return i;
    w += 2;
  }
  return sites.length;
}
