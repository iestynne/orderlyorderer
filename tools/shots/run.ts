// SPEC-009 §4 — drive every scenario and write `build/shots/<name>.png`.
//
//   npm run shots              take every shot and diff it against its golden
//   npm run shots -- --update  re-baseline: write the goldens instead
//   npm run shots -- --only=hover-row
//
// `[D]` **Re-baselining is a command, not a fallback.** A task runs `--update`
// only when the change to the picture was the point of the task, and the
// diffs are looked at before the commit that carries them. A golden that gets
// quietly rewritten whenever it fails is a golden that tests nothing.
//
// `[D]` **The shot is the app's own frame**, `capture()`'s 1× buffer, not a
// window screenshot: every pixel in it is a logical pixel, so a claim about
// one is a claim about a pixel the app drew. Invariant 2 is what makes that
// safe to assume — it checks the buffer against what the browser actually
// shows, and if those ever part company every golden is suspect.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { ROW_H } from "../../src/ui/render/actions";
import type { Layout } from "../../src/ui/render/screen";
import type { OrderlyState } from "../../src/ui/dev";
import { launch, type Harness } from "./browser";
import { SCENARIOS, pointOf, type Scenario, type Step } from "./scenarios";
import { diffPng } from "./diff";

export const SHOTS_DIR = "build/shots";
export const GOLDEN_DIR = "test/ui/golden";

/** Where the dev server is. Loopback only — there is nowhere else to point it. */
export const BASE_URL = process.env["SHOTS_URL"] ?? "http://localhost:5173";

export function urlFor(s: Scenario, base = BASE_URL): string {
  return `${base}/?fixture=${encodeURIComponent(s.fixture)}&record=${s.record}&stop=${s.stop}`;
}

interface Readback {
  layout: Layout;
  state: OrderlyState;
}

async function readback(page: Page): Promise<Readback> {
  return page.evaluate(() => ({
    layout: window.__orderly!.layout(),
    state: window.__orderly!.state(),
  }));
}

/**
 * `[F]` Read back before **every** step, never once at the start. A click on a
 * row moves the pin, and an insertion changes the stop count and can change
 * which floors are shown, so a target resolved against stale state points at
 * where the thing used to be. Re-reading is also what keeps `run.ts` from
 * having to reimplement the app's "the clicked row does not move" rule.
 */
async function playStep(page: Page, step: Step): Promise<void> {
  const { layout, state } = await readback(page);
  if ("hover" in step) {
    const p = pointOf(step.hover, layout, state);
    await page.mouse.move(p.x, p.y);
    return;
  }
  if ("click" in step) {
    const p = pointOf(step.click, layout, state);
    // Move first: a click without a move never fires `pointermove`, and the
    // hover state a click lands in is half of what the shot is showing.
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    return;
  }
  const from = pointOf(step.drag.from, layout, state);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // ROW_H per row, upward: `rowTop` counts offsets up the list.
  await page.mouse.move(from.x, from.y - step.drag.rows * ROW_H);
  await page.mouse.up();
}

/**
 * One scenario, from navigation to a PNG.
 *
 * `[F]` The waits are what invariant 3 buys: two runs of a scenario must
 * produce identical PNGs, and the fix for anything else is a wait here, never
 * a tolerance in the diff. `__orderly` appearing means the module loaded;
 * a mounted scrubber is a separate wait, because the fixture is still being
 * fetched and simulated when the global is installed.
 */
export async function shoot(h: Harness, s: Scenario, base = BASE_URL): Promise<Uint8Array> {
  const before = h.aborts.length;
  await h.page.goto(urlFor(s, base), { waitUntil: "domcontentloaded" });
  await h.page.waitForFunction(() => window.__orderly !== undefined);
  await h.page.waitForFunction(() => {
    try {
      return window.__orderly!.stop() >= 0;
    } catch {
      return false;
    }
  });
  // The atlas decodes and the floors are painted inside the first frames; a
  // capture taken before them is a picture of a canvas that is not finished.
  await h.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

  for (const step of s.steps ?? []) {
    await playStep(h.page, step);
    await h.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  const url = await h.page.evaluate(() => window.__orderly!.capture());
  const png = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  if (h.aborts.length !== before) {
    throw new Error(`${s.name}: reached off-host — ${h.aborts.slice(before).join(", ")}`);
  }
  return new Uint8Array(png);
}

export interface Result {
  name: string;
  /** Differing pixels; 0 is a pass, -1 a size mismatch, null when re-baselined. */
  differing: number | null;
  first: { x: number; y: number } | null;
  goldenMissing: boolean;
}

export async function runAll(names: readonly string[], update: boolean, base = BASE_URL): Promise<Result[]> {
  const chosen = names.length === 0 ? SCENARIOS : SCENARIOS.filter((s) => names.includes(s.name));
  if (chosen.length === 0) throw new Error(`no scenario matches ${names.join(", ")}`);
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(GOLDEN_DIR, { recursive: true });

  const h = await launch();
  const results: Result[] = [];
  try {
    for (const s of chosen) {
      const png = await shoot(h, s, base);
      const shot = join(SHOTS_DIR, `${s.name}.png`);
      writeFileSync(shot, png);
      const golden = join(GOLDEN_DIR, `${s.name}.png`);
      if (update) {
        writeFileSync(golden, png);
        results.push({ name: s.name, differing: null, first: null, goldenMissing: false });
        continue;
      }
      if (!existsSync(golden)) {
        results.push({ name: s.name, differing: -1, first: null, goldenMissing: true });
        continue;
      }
      const d = diffPng(png, new Uint8Array(readFileSync(golden)));
      if (d.count !== 0 && d.image !== null) writeFileSync(join(SHOTS_DIR, `${s.name}.diff.png`), d.image);
      results.push({ name: s.name, differing: d.count, first: d.first, goldenMissing: false });
    }
  } finally {
    await h.close();
  }
  // Invariant 1, checked on every run and not only in §5 case 3: an abort IS a
  // request with a non-loopback host, so an empty abort log is the invariant.
  if (h.aborts.length > 0) throw new Error(`off-host requests: ${h.aborts.join(", ")}`);
  return results;
}

async function main(argv: string[]): Promise<void> {
  const update = argv.includes("--update");
  const only = argv.filter((a) => a.startsWith("--only=")).map((a) => a.slice("--only=".length));
  const results = await runAll(only, update, BASE_URL);
  for (const r of results) {
    const verdict = r.goldenMissing
      ? "NO GOLDEN — run with --update once the shot has been looked at"
      : r.differing === null
        ? "re-baselined"
        : r.differing === 0
          ? "0 differing pixels"
          : r.differing < 0
            ? "SIZE MISMATCH"
            : `${r.differing} differing pixels, first at ${r.first?.x},${r.first?.y}`;
    console.log(`${r.name.padEnd(16)} ${verdict}`);
  }
  const bad = results.filter((r) => r.differing !== null && r.differing !== 0).length;
  if (bad > 0) {
    console.log(`\n${bad} scenario(s) differ. The diffs are in ${SHOTS_DIR}/<name>.diff.png.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).catch((e: Error) => {
    console.error(String(e));
    process.exitCode = 1;
  });
}
