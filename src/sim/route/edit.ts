// SPEC-008 §5 — the editing operations.
//
// `[D]` Every op names an **epoch** first, because that is the addressable
// unit; `segment` selects within it and is omitted only by `rename`, which
// names an epoch when absent. `[D]` `reorder` moves epochs, never segments:
// segments within an epoch are alternatives, so their order carries no meaning.
//
// `[D]` **Every Edit is document-tier**, so every one sets the unsaved-changes
// marker and pushes an undo entry, and nothing else does (DESIGN §2.3). That is
// one rule with no exceptions, which is why it needs no list to maintain --
// and it is why `apply` returns a new document rather than mutating one: the
// undo stack is the sequence of results.
//
// Pure module: no UI imports (D7).

import { RouteShapeError, activeSegment, type Action, type Epoch, type Route, type Segment } from "./document";

export type Edit =
  /** `[F]` An action is a pair, so an insert carries both halves (§2.2). */
  | { op: "insert"; epoch: number; segment: number; index: number; action: Action }
  | { op: "setDisabled"; epoch: number; segment: number; index: number; value: boolean }
  /** A new, empty parallel segment. */
  | { op: "addSegment"; epoch: number; name?: string }
  | { op: "split"; epoch: number; index: number }
  /** With its successor. */
  | { op: "merge"; epoch: number }
  | { op: "setActive"; epoch: number; segment: number }
  | { op: "rename"; epoch: number; segment?: number; name: string }
  /** Epochs. */
  | { op: "reorder"; from: number; to: number }
  | { op: "setSkippable"; epoch: number; value: boolean };

function at<T>(xs: T[], i: number, what: string): T {
  const v = xs[i];
  if (v === undefined) throw new RouteShapeError(`${what} ${i} is out of range (0..${xs.length - 1})`);
  return v;
}

function put<T>(xs: T[], i: number, v: T): T[] {
  const out = xs.slice();
  out[i] = v;
  return out;
}

function withEpoch(route: Route, i: number, f: (e: Epoch) => Epoch): Route {
  return { ...route, epochs: put(route.epochs, i, f(at(route.epochs, i, "epoch"))) };
}

function withSegment(route: Route, i: number, j: number, f: (s: Segment) => Segment): Route {
  return withEpoch(route, i, (e) => ({ ...e, segments: put(e.segments, j, f(at(e.segments, j, "segment"))) }));
}

export function apply(route: Route, edit: Edit): Route {
  switch (edit.op) {
    case "insert":
      return withSegment(route, edit.epoch, edit.segment, (s) => {
        if (edit.index < 0 || edit.index > s.actions.length) {
          throw new RouteShapeError(`insert index ${edit.index} is out of range (0..${s.actions.length})`);
        }
        const actions = s.actions.slice();
        actions.splice(edit.index, 0, edit.action);
        return { ...s, actions };
      });

    case "setDisabled":
      return withSegment(route, edit.epoch, edit.segment, (s) => {
        const a = at(s.actions, edit.index, "action");
        // Absent, not false: invariant 4 asks for the byte-identical document
        // back when an action is disabled and re-enabled.
        const next: Action = edit.value ? { ...a, disabled: true } : { from: a.from, to: a.to };
        return { ...s, actions: put(s.actions, edit.index, next) };
      });

    case "addSegment":
      return withEpoch(route, edit.epoch, (e) => ({
        ...e,
        segments: [...e.segments, { name: edit.name ?? `alternative ${e.segments.length + 1}`, actions: [] }],
      }));

    case "split": {
      const e = at(route.epochs, edit.epoch, "epoch");
      if (e.segments.length > 1) {
        throw new RouteShapeError(
          `epoch ${edit.epoch} holds ${e.segments.length} segments; there is no meaning for where the others divide`,
        );
      }
      const s = e.segments[0]!;
      if (edit.index < 0 || edit.index > s.actions.length) {
        throw new RouteShapeError(`split index ${edit.index} is not an action boundary (0..${s.actions.length})`);
      }
      const halves: Epoch[] = [
        { ...e, active: 0, segments: [{ ...s, actions: s.actions.slice(0, edit.index) }] },
        { ...e, active: 0, segments: [{ ...s, actions: s.actions.slice(edit.index) }] },
      ];
      const epochs = route.epochs.slice();
      epochs.splice(edit.epoch, 1, ...halves);
      return { ...route, epochs };
    }

    case "merge": {
      const a = at(route.epochs, edit.epoch, "epoch");
      const b = at(route.epochs, edit.epoch + 1, "epoch");
      for (const [i, e] of [[edit.epoch, a], [edit.epoch + 1, b]] as const) {
        if (e.segments.length > 1) {
          throw new RouteShapeError(`epoch ${i} holds ${e.segments.length} segments; merging would have to choose one`);
        }
      }
      const merged: Epoch = {
        ...a,
        active: 0,
        segments: [{ ...a.segments[0]!, actions: [...a.segments[0]!.actions, ...b.segments[0]!.actions] }],
      };
      const epochs = route.epochs.slice();
      epochs.splice(edit.epoch, 2, merged);
      return { ...route, epochs };
    }

    case "setActive":
      return withEpoch(route, edit.epoch, (e) => {
        at(e.segments, edit.segment, "segment");
        return { ...e, active: edit.segment };
      });

    case "rename":
      return edit.segment === undefined
        ? withEpoch(route, edit.epoch, (e) => ({ ...e, name: edit.name }))
        : withSegment(route, edit.epoch, edit.segment, (s) => ({ ...s, name: edit.name }));

    case "reorder": {
      at(route.epochs, edit.from, "epoch");
      at(route.epochs, edit.to, "epoch");
      const epochs = route.epochs.slice();
      epochs.splice(edit.to, 0, ...epochs.splice(edit.from, 1));
      return { ...route, epochs };
    }

    case "setSkippable":
      return withEpoch(route, edit.epoch, (e) => ({ ...e, skippable: edit.value }));
  }
}

/**
 * The action index, within the whole route's active segments, that a given
 * epoch's active segment starts at. What the UI needs to turn a slider stop
 * into an (epoch, index) pair.
 */
export function epochActionOffsets(route: Route): number[] {
  const out: number[] = [];
  let n = 0;
  for (const e of route.epochs) {
    out.push(n);
    n += activeSegment(e).actions.length;
  }
  return out;
}
