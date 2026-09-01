// SPEC-008 §5, §6 — the editing session: the document, its evaluation, undo,
// selection, and the unsaved-changes marker.
//
// `[D]` **Document-tier changes are undoable and set the marker; view-tier
// changes are neither** (DESIGN §2.3). Every `Edit` is document-tier and
// nothing else is, which is why `edit()` is the only method that touches the
// undo stack and no list of triggering actions has to be maintained.
//
// `[D]` The marker is a **comparison against the saved document**, not a sticky
// flag, because toggling an action off and back on must clear it. It never runs
// on the frame path: scrubbing touches nothing in the document, and an edit
// happens at the speed of a click, so the hash is computed synchronously here.

import { stopStepIndices } from "../sim/cursor";
import {
  activeSegment,
  type Action,
  type OrdFile,
  type Route,
} from "../sim/route/document";
import { apply, type Edit } from "../sim/route/edit";
import { evaluate, type Evaluation } from "../sim/route/evaluate";
import { documentHash, emit, ordFile } from "../sim/route/ordfile";
import { toSaveRecord } from "../sim/route/export";
import type { TowerJSON, Waypoint } from "../sim/types";
import type { Mode, ViewState } from "../store/working";

/** Where a realised action came from, so a click on the timeline can edit it. */
export interface ActionSite {
  epoch: number;
  segment: number;
  /** Index within that segment, counting disabled actions. */
  index: number;
  action: Action;
}

export type Badge = "inserted" | "disabled";

export class RouteSession {
  evaluation!: Evaluation;
  stops: number[] = [];
  /** One per slider stop below the last: which action the stop acts on. */
  sites: ActionSite[] = [];
  /** The first stop the route fails at, or null where it runs clean. */
  failedFrom: number | null = null;
  savedHash: string | null = null;

  private readonly undoStack: Route[] = [];
  private readonly redoStack: Route[] = [];
  /** By identity, which survives every op but `setDisabled` (which `edit` fixes up). */
  private readonly insertedSet = new Set<Action>();

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
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  edit(e: Edit): void {
    const before = this.route;
    const after = apply(before, e);
    this.undoStack.push(before);
    this.redoStack.length = 0;
    this.replace(after);
    if (e.op === "insert") {
      this.insertedSet.add(e.action);
    } else if (e.op === "setDisabled") {
      // The only op that replaces an action object, so the only one whose
      // "new since the last save" marker has to be carried across.
      const old = before.epochs[e.epoch]?.segments[e.segment]?.actions[e.index];
      const now = after.epochs[e.epoch]?.segments[e.segment]?.actions[e.index];
      if (old && now && this.insertedSet.delete(old)) this.insertedSet.add(now);
    }
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.redoStack.push(this.route);
    this.replace(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.route);
    this.replace(next);
  }

  setMode(mode: Mode): void {
    this.view = { ...this.view, mode };
  }

  /** The segment edits apply to: the player's pick, else the one being scrubbed. */
  selection(): { epoch: number; segment: number } {
    if (this.view.selection !== null) return this.view.selection;
    const site = this.sites[Math.min(this.view.stop, this.sites.length - 1)];
    if (site) return { epoch: site.epoch, segment: site.segment };
    return { epoch: 0, segment: this.route.epochs[0]!.active };
  }

  badgeOf(action: Action): Badge | null {
    if (action.disabled === true) return "disabled";
    return this.insertedSet.has(action) ? "inserted" : null;
  }

  /** Cells carrying a badge, keyed `z:x:y`, for the timeline overlay. */
  badgeCells(): Map<string, Badge> {
    const out = new Map<string, Badge>();
    this.route.epochs.forEach((epoch) => {
      for (const action of activeSegment(epoch).actions) {
        const badge = this.badgeOf(action);
        if (badge !== null) out.set(cellKey(action.to), badge);
      }
    });
    return out;
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
    this.stops = stopStepIndices(this.evaluation.mainline, this.evaluation.waypoints.length);
    this.sites = realisedSites(this.route, this.evaluation);
    const error = this.evaluation.mainline.error;
    this.failedFrom = error === undefined ? null : Math.min(error.waypointIndex >> 1, this.sites.length);
    this.view = { ...this.view, stop: Math.min(this.view.stop, Math.max(0, this.stops.length - 1)) };
  }
}

export function cellKey(w: Waypoint): string {
  return `${w.z}:${w.x}:${w.y}`;
}

/**
 * One entry per realised action, in slider-stop order.
 *
 * `[F]` The realised route is the active segments minus the skipped epochs
 * minus the disabled actions, and the slider stops once per action plus once at
 * the final position (SPEC-007 §3) — so this array is exactly the stops below
 * the last, and index `i` is the action the i-th stop acts on.
 */
function realisedSites(route: Route, evaluation: Evaluation): ActionSite[] {
  const out: ActionSite[] = [];
  route.epochs.forEach((epoch, e) => {
    if (evaluation.epochs[e]?.skipped === true) return;
    const s = epoch.active;
    activeSegment(epoch).actions.forEach((action, index) => {
      if (action.disabled !== true) out.push({ epoch: e, segment: s, index, action });
    });
  });
  return out;
}
