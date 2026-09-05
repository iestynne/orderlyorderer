// SPEC-009 §3 — the app's side of the visual harness. DEV only.
//
// `[D]` **Dev-only, and real.** Two things and no more: the URL opens a
// fixture, and `window.__orderly` reads the frame back. Nothing here drives
// the app — pointer input goes through the real listeners, driven by
// Playwright's mouse, so a scenario tests the same path a hand does. The
// moment this module could click something, a shot would stop being evidence
// about the app and start being evidence about this file.
//
// `[F]` Reached by `await import("./dev")` from inside an
// `if (import.meta.env.DEV)`, never by a static import: Vite replaces the
// condition with `false` in a production build and Rollup then drops the whole
// dynamic import, so nothing in here reaches the bundle. §5 case 10 asserts it.

import type { SaveRecord } from "../sav/savefile";
import { parseSaveFile } from "../sav/savefile";
import type { TowerJSON } from "../sim/types";
import { loadTower } from "./assets";
import type { Layout } from "./render/screen";
import type { Scrubber } from "./scrubber";

/**
 * What a scenario may read back.
 *
 * `[D]` `state()` is not a convenience. `run.ts` computes every pointer
 * target from `layout()` and the app's own pure geometry functions — that is
 * what makes a wrong hitbox show up as a shot pointing at the wrong thing —
 * but three of those functions take app state as an argument and cannot be
 * derived from `Layout` alone: the list's pin, the slider's stop count, and
 * how many floors the panel is showing. Those three, and nothing that is
 * already computable.
 */
export interface OrderlyState {
  /** Where the current action's row sits, for `rowTop`. */
  pinY: number;
  /** How many stops the slider divides, for `stopToY`. */
  stopCount: number;
  /** The stop whose action breaks the route, or null. */
  failedFrom: number | null;
  /** Floors in the working set on screen, for `gridFor`. */
  floorsShown: number;
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
  // `[F]` **A stem, or one directory and a stem** — `1-5.SUFFICIENT-POWER`, or
  // `iestyn.2026.08.28/2-1` to reach the full corpus, which is where most
  // failure cases are built from. Nothing else: the dev server's root is the
  // repository, so an unchecked value here reads any file in it. The pattern
  // admits no `..` segment and no second separator, which is what keeps this
  // inside `data/saves/`.
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
 * The tower a fixture belongs to.
 *
 * `[F]` Not `towerIdFromFilename`, which wants the whole stem to be a tower id
 * and hands back null for every name in `data/saves/tests/`. Those are named
 * `<tower>.<TEST>.sav` (D16), so the id is what precedes the first dot — and a
 * corpus save is `<dir>/<tower>.sav`, where the directory is dated and full of
 * dots of its own, so the directory goes first.
 */
export function towerOfFixture(fixture: string): string {
  return (fixture.split("/").pop() ?? fixture).split(".")[0]!;
}

/** Guards against StrictMode's double invocation opening the fixture twice. */
let opened = false;

/**
 * Open what the URL asks for, through the app's own record-chooser: a shot has
 * to be of the app, so the harness may not assemble a session of its own.
 */
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

/**
 * Install `window.__orderly`, reading through a ref rather than a scrubber.
 *
 * `[F]` The ref is App's own, set when the scrubber mounts and cleared when it
 * unmounts, so this is installed once at start-up and needs no hook into the
 * mount effect — and it reports honestly when nothing is mounted rather than
 * closing over a scrubber that has been destroyed.
 */
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
