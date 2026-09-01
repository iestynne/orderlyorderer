// SPEC-008 §2 — the route document: epochs, segments, actions, and flatten().
//
// Pure module: no UI imports (D7). The simulator sees only the Waypoint[] that
// flatten() produces; it never receives an epoch or a segment.

import type { Waypoint } from "../types";

/**
 * `gemsOwned` for a route whose real gem total is not known.
 *
 * `[F]` The simulator wants a number and the app has none: the total is grade
 * gems plus the sum of per-tower crown tiers, and only the `crown` file
 * supplies it (TODO §B2). `[D]` A finite sentinel rather than `Infinity`,
 * because the document is JSON and JSON has no infinity -- it would serialize
 * as `null` and parse back as a broken route. Any value above every gem cost
 * in the game behaves identically, so the sentinel is the largest integer JSON
 * round-trips exactly.
 */
export const UNLIMITED_GEMS = Number.MAX_SAFE_INTEGER;

export interface OrdFile {
  format: "orderlyorderer-route";
  version: 1;
  routes: Route[];
}

export interface Route {
  name: string;
  /** Tower id, e.g. '2-5'. */
  tower: string;
  /** SPEC-004 §10.1. */
  gemsOwned: number;
  /** Absent for a route not imported from a .sav. */
  source?: SaveSource;
  epochs: Epoch[];
  /**
   * The player's live position — the last of the record's `2S+1` entries.
   *
   * `[D]` **Route-level, not the tail of the last segment.** It is the one
   * entry that is not part of any action, so a segment holding it would be a
   * segment of odd length and every operation below would need a "except the
   * last one" clause.
   */
  final: Waypoint;
}

export interface SaveSource {
  /** Filename as opened, for the player's benefit. */
  file: string;
  /** Save name within it. */
  record: string;
  /** SHA-256 of the record's decompressed payload. */
  hash: string;
}

export interface Epoch {
  /** The span, e.g. '5F'. */
  name?: string;
  /** May resolve to nothing; SPEC-008 §3. */
  skippable: boolean;
  /** Index into segments. */
  active: number;
  /** Length >= 1. */
  segments: Segment[];
}

export interface Segment {
  /** The player's own, e.g. 'take the Light Key'. */
  name: string;
  actions: Action[];
}

/**
 * One recorded interaction: the position the player made it from, and the cell
 * they made it on.
 *
 * `[D]` **An action is the pair, not a single waypoint.** SAVE_FORMAT §3's
 * `2S+1` rule is positional — S pairs then the live position — so an edit that
 * adds or removes one entry mis-pairs every entry after it and the game reads a
 * different route. Both halves of the pair are data: the `from` is the tile the
 * player approached from, which decides adjacency and which side of a one-way
 * wall they are on, and the auto-pather reproduces neither. Pairing them here
 * makes `2S+1` an invariant of the structure rather than a rule every edit has
 * to remember, which is what lets `insert` and `setDisabled` be one line each.
 */
export interface Action {
  from: Waypoint;
  to: Waypoint;
  /** Absent means enabled (SPEC-008 §2.4). */
  disabled?: boolean;
}

export function activeSegment(epoch: Epoch): Segment {
  return epoch.segments[epoch.active] ?? epoch.segments[0]!;
}

/** The waypoints one segment contributes: both halves of each enabled action. */
export function segmentWaypoints(segment: Segment): Waypoint[] {
  const out: Waypoint[] = [];
  for (const a of segment.actions) {
    if (a.disabled === true) continue;
    out.push(a.from, a.to);
  }
  return out;
}

/**
 * SPEC-008 §2.3. The active segment of each epoch in order, dropping disabled
 * actions, then the route's live position. Always odd, so it is always a legal
 * `2S+1` entry list.
 */
export function flatten(route: Route): Waypoint[] {
  const out: Waypoint[] = [];
  for (const e of route.epochs) out.push(...segmentWaypoints(activeSegment(e)));
  out.push(route.final);
  return out;
}

/** Every action of the route's active segments, in order, disabled ones included. */
export function activeActions(route: Route): Action[] {
  return route.epochs.flatMap((e) => activeSegment(e).actions);
}

export class RouteShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteShapeError";
  }
}

/**
 * SPEC-008 §9 invariant 1 and the "epochs in a freshly imported route = 1" case:
 * a `2S+1` waypoint list becomes one epoch holding one segment, nothing
 * disabled, and `flatten()` gives the list back unchanged.
 */
export function importRoute(opts: {
  name: string;
  tower: string;
  gemsOwned: number;
  waypoints: readonly Waypoint[];
  source?: SaveSource;
  segmentName?: string;
}): Route {
  const wps = opts.waypoints;
  if (wps.length % 2 !== 1) {
    throw new RouteShapeError(`entry count ${wps.length} is even; the 2S+1 rule requires odd`);
  }
  const actions: Action[] = [];
  for (let i = 0; i + 1 < wps.length; i += 2) actions.push({ from: wps[i]!, to: wps[i + 1]! });
  const route: Route = {
    name: opts.name,
    tower: opts.tower,
    gemsOwned: opts.gemsOwned,
    epochs: [{ skippable: false, active: 0, segments: [{ name: opts.segmentName ?? "route", actions }] }],
    final: wps[wps.length - 1]!,
  };
  if (opts.source) route.source = opts.source;
  return route;
}
