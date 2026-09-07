// SPEC-009 §3 — the app's side of the visual harness. DEV only.
//
// Two things and no more: the URL opens a fixture, and `window.__orderly`
// reads the frame back. Nothing here drives the app; pointer input goes
// through the real listeners, so a scenario tests the same path a hand does.
//
// Reached only by `await import("./dev")` inside `if (import.meta.env.DEV)`:
// Vite folds the condition to `false` in production and Rollup drops the
// import with it. §5 case 10 asserts nothing here reaches the bundle.

import type { SaveRecord } from "../sav/savefile";
import { parseSaveFile } from "../sav/savefile";
import type { TowerJSON } from "../sim/types";
import { loadTower } from "./assets";
import type { Layout } from "./render/screen";
import type { Scrubber } from "./scrubber";

/**
 * The app state a pointer target needs that `Layout` cannot give. `run.ts`
 * computes every pixel itself from these and the app's own geometry functions.
 */
export interface OrderlyState {
  /** Where the current action's row sits, for `rowTop`. */
  pinY: number;
  /** How many stops the slider divides, for `stopToY`. */
  stopCount: number;
  /** The stop whose action breaks the route, or null. */
  failedFrom: number | null;
  /** The floors on screen, in tile order. A cell target names its floor, not its slot. */
  floors: number[];
}

export interface Orderly {
  /** SPEC-007 §7's capture control: the logical canvas at 1x, as a data URL. */
  capture(): string;
  stop(): number;
  layout(): Layout;
  state(): OrderlyState;
}

declare global {
  interface Window {
    __orderly?: Orderly;
  }
}

export interface DevParams {
  fixture: string;
  record: number;
  stop: number;
}

/** `?fixture=<stem>&record=<n>&stop=<n>`, or null when the app was opened by hand. */
export function devParams(search: string): DevParams | null {
  const q = new URLSearchParams(search);
  const fixture = q.get("fixture");
  if (fixture === null) return null;
  // A stem, or `<dir>/<stem>` for the corpus. The dev server serves the whole
  // repository, so nothing that could leave `data/saves/` is accepted.
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(fixture) || fixture.split("/").includes("..")) {
    throw new Error(`fixture must be <stem> or <dir>/<stem>: ${fixture}`);
  }
  return { fixture, record: int(q.get("record")), stop: int(q.get("stop")) };
}

function int(v: string | null): number {
  if (v === null) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`not a whole number: ${v}`);
  return n;
}

/**
 * The tower a fixture belongs to: what precedes the first dot of the stem.
 * Test saves are `<tower>.<TEST>.sav` (D16); corpus saves are `<dir>/<tower>.sav`.
 */
export function towerOfFixture(fixture: string): string {
  return (fixture.split("/").pop() ?? fixture).split(".")[0]!;
}

/** Guards against StrictMode's double invocation opening the fixture twice. */
let opened = false;

/** Open what the URL asks for, through the app's own record-chooser. */
export async function openFromUrl(
  choose: (record: SaveRecord, tower: TowerJSON, stop: number) => void,
): Promise<void> {
  const p = devParams(window.location.search);
  if (p === null || opened) return;
  opened = true;
  const res = await fetch(`/data/saves/${p.fixture.includes("/") ? p.fixture : `tests/${p.fixture}`}.sav`);
  if (!res.ok) throw new Error(`fixture ${p.fixture}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const tower = await loadTower(towerOfFixture(p.fixture));
  const record = parseSaveFile(bytes).records[p.record];
  if (record === undefined) throw new Error(`fixture ${p.fixture} has no record ${p.record}`);
  choose(record, tower, p.stop);
}

/** Install `window.__orderly`. Reads through App's ref, so it needs no mount hook. */
export function expose(ref: { current: Scrubber | null }): void {
  const live = (): Scrubber => {
    const s = ref.current;
    if (s === null) throw new Error("no scrubber is mounted");
    return s;
  };
  window.__orderly = {
    capture: () => live().capture(),
    stop: () => live().stopIndex,
    layout: () => live().layout,
    state: () => live().harnessState,
  };
}
