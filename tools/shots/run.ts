// SPEC-009 §4 — drive every scenario and write `build/shots/<name>.png`.
//
//   npm run shots              take every shot and diff it against its golden
//   npm run shots -- --update  re-baseline: write the goldens instead
//   npm run shots -- --only=hover-row,break-gold   (or repeat the flag)
//
// Re-baselining is a command, never a fallback: `--update` only when the change
// to the picture was the point, and after looking. The shot is `capture()`'s 1×
// buffer, not a window screenshot; invariant 2 checks the two agree.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright-core";
import { ROW_H } from "../../src/ui/render/actions";
import type { Layout } from "../../src/ui/render/screen";
import type { OrderlyState } from "../../src/ui/dev";
import { launch, type Harness } from "./browser";
import { SCENARIOS, pointOf, type Scenario, type Step } from "./scenarios";
import { diffPng, reviewImage } from "./diff";
import { CROPS_DIR } from "./crop";
import { sitePath } from "../worktree";

export const SHOTS_DIR = "build/shots";
export const GOLDEN_DIR = "test/ui/golden";

/**
 * `SHOTS_URL` with this worktree's base path supplied if it names only an
 * origin. `[F]` Without this, a bare `http://localhost:5175` left over in a
 * shell sends the harness to a path that serves no app, and the failure reads
 * as "that server is not a dev build" rather than "you are pointing at the
 * wrong path".
 */
function envUrl(): string | undefined {
  const raw = process.env["SHOTS_URL"];
  if (raw === undefined) return undefined;
  const trimmed = raw.replace(/\/$/, "");
  return new URL(trimmed).pathname === "/" ? `${trimmed}${sitePath()}` : trimmed;
}

/** Where the dev server is. Loopback only — there is nowhere else to point it. */
export const BASE_URL = envUrl() ?? `http://localhost:5173${sitePath()}`;

/** The ports Vite walks when 5173 is taken — one per worktree, in practice. */
const PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];

/**
 * This worktree's dev server, found by walking Vite's ports at this worktree's
 * own base path (`tools/worktree.ts`) — a sibling's server answers on a different
 * path and is skipped. `window.__orderly` then confirms it is a dev build, which
 * the HTML cannot: every worktree serves the same `index.html`. Hence a page,
 * not `fetch`.
 */
export async function resolveBaseUrl(page: Page): Promise<string> {
  const env = envUrl();
  const candidates = env !== undefined ? [env] : PORTS.map((p) => `http://localhost:${p}${sitePath()}`);
  for (const url of candidates) {
    try {
      await page.goto(`${url}/`, { waitUntil: "domcontentloaded", timeout: 2000 });
      await page.waitForFunction(() => window.__orderly !== undefined, undefined, { timeout: 2000 });
      return url;
    } catch {
      // Not listening, not this app, or not a dev build. Try the next.
    }
  }
  throw new Error(
    env !== undefined
      ? `${env} is not serving this worktree in dev mode: window.__orderly never appeared. ` +
        "A production build does not expose it, and neither does another worktree's server."
      : `no dev server exposing window.__orderly on ports ${PORTS[0]}-${PORTS[PORTS.length - 1]}. ` +
        "Start one with `npm run dev` in THIS worktree, or set SHOTS_URL.",
  );
}

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

/** State is read back before every step: a click moves the pin, an insertion changes the floors. */
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
 * One scenario, from navigation to a PNG. The waits are what makes a scenario
 * replayable (invariant 3); a timing fault is fixed here, never with a tolerance.
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
  /** The shot itself, so a caller can bless it without taking it again. */
  png: Uint8Array;
}

export async function runAll(names: readonly string[], update: boolean, base?: string): Promise<Result[]> {
  const chosen = names.length === 0 ? SCENARIOS : SCENARIOS.filter((s) => names.includes(s.name));
  if (chosen.length === 0) throw new Error(`no scenario matches ${names.join(", ")}`);
  mkdirSync(SHOTS_DIR, { recursive: true });
  mkdirSync(GOLDEN_DIR, { recursive: true });

  const h = await launch();
  const results: Result[] = [];
  try {
    // Found once, with the browser already up, and reused for every scenario.
    base ??= await resolveBaseUrl(h.page);
    for (const s of chosen) {
      const png = await shoot(h, s, base);
      const shot = join(SHOTS_DIR, `${s.name}.png`);
      writeFileSync(shot, png);
      // A crop is evidence about one frame; retaking the frame makes it stale.
      const crops = join(SHOTS_DIR, CROPS_DIR);
      for (const f of existsSync(crops) ? readdirSync(crops) : []) {
        if (f.startsWith(`${s.name}.crop-`)) rmSync(join(crops, f), { force: true });
      }
      const golden = join(GOLDEN_DIR, `${s.name}.png`);
      if (update) {
        writeFileSync(golden, png);
        results.push({ name: s.name, differing: null, first: null, goldenMissing: false, png });
        continue;
      }
      if (!existsSync(golden)) {
        results.push({ name: s.name, differing: -1, first: null, goldenMissing: true, png });
        continue;
      }
      const goldenBytes = new Uint8Array(readFileSync(golden));
      const d = diffPng(png, goldenBytes);
      if (d.count !== 0 && d.image !== null) {
        writeFileSync(join(SHOTS_DIR, `${s.name}.diff.png`), d.image);
        // Always, not behind a flag: a changed golden is always the same question.
        const sheet = reviewImage(goldenBytes, png, d.image);
        if (sheet !== null) writeFileSync(join(SHOTS_DIR, `${s.name}.review.png`), sheet);
      }
      results.push({ name: s.name, differing: d.count, first: d.first, goldenMissing: false, png });
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
  // Repeated flags, or one comma-separated list: a twelve-name re-baseline is
  // far easier to paste as `--only=clean,break,hover-row` than as twelve flags.
  const only = argv
    .filter((a) => a.startsWith("--only="))
    .flatMap((a) => a.slice("--only=".length).split(","))
    .map((n) => n.trim())
    .filter((n) => n !== "");
  const results = await runAll(only, update);
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
    console.log(
      `\n${bad} scenario(s) differ. Look at ${SHOTS_DIR}/<name>.review.png — golden, then shot,\n` +
        "then the diff — and decide which it is: a fault to fix, or intended churn to re-baseline\n" +
        "with --update. A count cannot tell you which, and that is the only question worth asking.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main(process.argv.slice(2)).catch((e: Error) => {
    console.error(String(e));
    process.exitCode = 1;
  });
}
