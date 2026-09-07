// SPEC-009 §5 — the Verification Contract for the visual harness.
//
// The browser-dependent cases skip, loudly, when `.browsers/` is absent: a
// fresh clone has no browser (§2) and `npm test` must still be green.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { LAUNCH_ARGS, browsersInstalled, isLoopback, launch, VIEWPORT, type Harness } from "../../tools/shots/browser";
import { SCENARIOS, pointOf } from "../../tools/shots/scenarios";
import { GOLDEN_DIR, runAll, shoot, urlFor } from "../../tools/shots/run";
import { diffPng } from "../../tools/shots/diff";
import { crop } from "../../tools/shots/crop";
import { devParams, towerOfFixture } from "../../src/ui/dev";
import { ROW_H } from "../../src/ui/render/actions";
import { layoutFor } from "../../src/ui/render/screen";
import { decodePng, encodePng } from "../../src/mapdiff/png";
import { parseSaveFile } from "../../src/sav/savefile";
import { routeFromRecord } from "../../src/sav/route";
import { importRoute, UNLIMITED_GEMS } from "../../src/sim/route/document";
import { ordFile } from "../../src/sim/route/ordfile";
import { RouteSession } from "../../src/ui/session";
import type { TowerJSON } from "../../src/sim/types";
import { haveSaves } from "../sav/helpers";

const HAVE_BROWSER = browsersInstalled();
const browserIt = HAVE_BROWSER ? it : it.skip;

if (!HAVE_BROWSER) {
  console.warn(
    "\nSPEC-009: .browsers/ is absent, so cases 2-6 and 8-9 are SKIPPED.\n" +
      "  Install it with `npm run shots:install` — the one command here that reaches the network.\n",
  );
}

// --- cases that need neither a browser nor a server ------------------------

describe("SPEC-009 §5 — confinement and scenarios", () => {
  it("case 1: the launch args are the proxy, the bypass list and all six disable flags", () => {
    expect([...LAUNCH_ARGS]).toEqual([
      "--proxy-server=127.0.0.1:9",
      "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
      "--no-first-run",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-extensions",
      "--disable-default-apps",
    ]);
  });

  it("case 7: at least eight scenarios, covering every named picture", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(8);
    const names = SCENARIOS.map((s) => s.name);
    // The eight §5 case 7 names, in its order.
    for (const required of [
      "clean",
      "added-action",
      "break-gold-gate",
      "past-break",
      "hover-row",
      "hover-exclaim",
      "hover-cell",
      "help-open",
    ]) {
      expect(names).toContain(required);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  it("the router lets loopback through and nothing else", () => {
    for (const u of ["http://localhost:5173/", "http://127.0.0.1:5173/x.sav", "http://[::1]:5173/"]) {
      expect(isLoopback(u)).toBe(true);
    }
    for (const u of ["http://example.invalid/", "http://1.1.1.1/", "https://registry.npmjs.org/"]) {
      expect(isLoopback(u)).toBe(false);
    }
  });

  it("the viewport puts the layout at scale 1, which is what makes a shot logical pixels", () => {
    const l = layoutFor(VIEWPORT.width, VIEWPORT.height, { pixelPerfect: true, linearFilter: false, zoom: "auto" }, 1);
    expect(l.scale).toBe(1);
    expect(l.w).toBe(VIEWPORT.width);
    expect(l.h).toBe(VIEWPORT.height);
  });

  it("§3: the URL is parsed, and a fixture is a stem rather than a path", () => {
    expect(devParams("")).toBeNull();
    expect(devParams("?record=1")).toBeNull();
    expect(devParams("?fixture=2-1.INSUFFICIENT-GOLD")).toEqual({
      fixture: "2-1.INSUFFICIENT-GOLD",
      record: 0,
      stop: 0,
    });
    expect(devParams("?fixture=a&record=10&stop=2")).toEqual({ fixture: "a", record: 10, stop: 2 });
    expect(() => devParams("?fixture=../../etc/passwd")).toThrow();
    expect(() => devParams("?fixture=a/b/c")).toThrow();
    expect(devParams("?fixture=iestyn.2026.08.28/2-1")?.fixture).toBe("iestyn.2026.08.28/2-1");
    expect(towerOfFixture("iestyn.2026.08.28/2-1")).toBe("2-1");
    expect(() => devParams("?fixture=a&stop=-1")).toThrow();
    expect(() => devParams("?fixture=a&record=1.5")).toThrow();
    expect(towerOfFixture("2-1.INSUFFICIENT-GOLD")).toBe("2-1");
  });

  it("every scenario names a fixture that exists, and a record inside it", () => {
    for (const s of SCENARIOS) {
      // A fixture is a test stem, or `<corpus dir>/<tower>` for the full corpus.
      const path = s.fixture.includes("/") ? s.fixture : `tests/${s.fixture}`;
      expect(existsSync(`data/saves/${path}.sav`), `${s.name}: ${path}.sav`).toBe(true);
      expect(existsSync(`data/towers/v0.7-455/${towerOfFixture(s.fixture)}.json`)).toBe(true);
      expect(s.record).toBeGreaterThanOrEqual(0);
      expect(s.stop).toBeGreaterThanOrEqual(0);
      expect(s.shows.length).toBeGreaterThan(20);
    }
  });

  it("§4: a target resolves to a pixel inside the thing it names", () => {
    const layout = layoutFor(VIEWPORT.width, VIEWPORT.height, { pixelPerfect: true, linearFilter: false, zoom: "auto" }, 1);
    const state = { pinY: 300, stopCount: 4, failedFrom: 2, floors: [3] };
    for (const t of [{ row: 0 } as const, { row: 2 } as const, "exclaim" as const, "help" as const]) {
      const p = pointOf(t, layout, state);
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(layout.w);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(layout.h);
    }
    // A row's point is left of the enable box: clicking it selects rather than toggles.
    expect(pointOf({ row: 0 }, layout, state).x).toBeLessThan(layout.w - 14);
    // Row +1 is exactly one row above row 0 — the pin is the origin, not the list's top.
    expect(pointOf({ row: 0 }, layout, state).y - pointOf({ row: 1 }, layout, state).y).toBe(ROW_H);
    // `exclaim` on a clean route is an error, not a plausible-looking pixel.
    expect(() => pointOf("exclaim", layout, { ...state, failedFrom: null })).toThrow();
    expect(() => pointOf({ cell: { floor: 9, x: 1, y: 1 } }, layout, state)).toThrow();
  });
});

// --- the PNG tools, which the report leans on ------------------------------

describe("SPEC-009 §4 — the diff and the crop", () => {
  const solid = (w: number, h: number, rgb: [number, number, number]): Uint8Array => {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = rgb[0];
      px[i + 1] = rgb[1];
      px[i + 2] = rgb[2];
      px[i + 3] = 255;
    }
    return encodePng(w, h, px);
  };

  it("identical images differ in zero pixels; one changed pixel is found and located", () => {
    const a = solid(8, 4, [10, 20, 30]);
    expect(diffPng(a, a).count).toBe(0);

    const img = decodePng(a);
    const px = new Uint8Array(img.pixels);
    px[(2 * 8 + 5) * 4] = 200; // (5, 2)
    const b = encodePng(8, 4, px);
    const d = diffPng(b, a);
    expect(d.count).toBe(1);
    expect(d.first).toEqual({ x: 5, y: 2 });
    expect(d.image).not.toBeNull();
  });

  it("a size mismatch is reported as -1 rather than compared", () => {
    expect(diffPng(solid(8, 4, [0, 0, 0]), solid(8, 5, [0, 0, 0])).count).toBe(-1);
  });

  it("a crop magnifies by nearest neighbour and refuses to read outside the image", () => {
    const img = decodePng(solid(8, 4, [10, 20, 30]));
    const out = crop(img, 1, 1, 2, 2, 4);
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    expect([...out.pixels.slice(0, 4)]).toEqual([10, 20, 30, 255]);
    expect(() => crop(img, 7, 0, 4, 1, 2)).toThrow();
    expect(() => crop(img, 0, 0, 2, 2, 0)).toThrow();
  });
});

// --- case 10: nothing of the harness reaches a production build ------------

describe("SPEC-009 §5 case 10 — the production build", () => {
  it("`dist/` mentions neither __orderly nor the dev module", () => {
    if (!existsSync("dist")) {
      console.warn("case 10: dist/ is absent — run `npm run build` to check it");
      return;
    }
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|html|css)$/.test(e)) files.push(p);
      }
    };
    walk("dist");
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, `${f} carries the harness`).not.toContain("__orderly");
      expect(text, `${f} carries the fixture loader`).not.toContain("fixture is a stem");
    }
  });
});

// --- everything that needs the browser -------------------------------------

describe("SPEC-009 §5 — the browser", () => {
  let server: ViteDevServer | null = null;
  let base = "";

  beforeAll(async () => {
    if (!HAVE_BROWSER) return;
    // `[F]` 127.0.0.1, not 0.0.0.0. The harness reaches loopback and nothing
    // else, and a server on every interface would be the one thing in this
    // arrangement that faced outward.
    server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
    await server.listen();
    const addr = server.httpServer?.address();
    if (addr === null || addr === undefined || typeof addr === "string") throw new Error("no dev server address");
    base = `http://127.0.0.1:${addr.port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.close();
  });

  browserIt("case 2: the profile directory is gone after close()", async () => {
    const h = await launch();
    expect(existsSync(h.profileDir)).toBe(true);
    await h.close();
    expect(existsSync(h.profileDir)).toBe(false);
  }, 120_000);

  browserIt("case 3: an off-host fetch is refused, twice, and logged twice", async () => {
    const h: Harness = await launch();
    try {
      await h.page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      const outcomes = await h.page.evaluate(async () => {
        const tryIt = async (u: string): Promise<string> => {
          try {
            await fetch(u, { mode: "no-cors" });
            return "resolved";
          } catch {
            return "rejected";
          }
        };
        return [await tryIt("http://example.invalid/"), await tryIt("http://1.1.1.1/")];
      });
      expect(outcomes).toEqual(["rejected", "rejected"]);
      expect(h.aborts.filter((u) => !isLoopback(u))).toHaveLength(2);
      expect(h.requests.filter((u) => !isLoopback(u) && !h.aborts.includes(u))).toHaveLength(0);
    } finally {
      await h.close();
    }
  }, 120_000);

  browserIt("case 4: a fixture fetch is 200, and the abort log does not move", async () => {
    const h = await launch();
    try {
      await h.page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      const before = h.aborts.length;
      const status = await h.page.evaluate(async () => {
        const r = await fetch("/data/saves/tests/1-5.INSUFFICIENT-POWER.sav");
        return r.status;
      });
      expect(status).toBe(200);
      expect(h.aborts.length).toBe(before);
    } finally {
      await h.close();
    }
  }, 120_000);

  browserIt("cases 5 and 6: the URL seeks, the layout is scale 1, and capture() is that size", async () => {
    const h = await launch();
    try {
      const s = SCENARIOS.find((x) => x.name === "break-gold-gate")!;
      await h.page.goto(urlFor({ ...s, stop: 0 }, base), { waitUntil: "domcontentloaded" });
      await h.page.waitForFunction(() => {
        try {
          return window.__orderly !== undefined && window.__orderly.stop() >= 0;
        } catch {
          return false;
        }
      });
      const read = await h.page.evaluate(() => ({
        stop: window.__orderly!.stop(),
        layout: window.__orderly!.layout(),
        png: window.__orderly!.capture(),
      }));
      expect(read.stop).toBe(0);
      expect(read.layout.scale).toBe(1);

      const img = decodePng(new Uint8Array(Buffer.from(read.png.slice(read.png.indexOf(",") + 1), "base64")));
      expect(img.width).toBe(read.layout.w);
      expect(img.height).toBe(read.layout.h);

      // Case 5 again, at a stop that is not the default: 0 could be the value
      // a broken seek left behind.
      await h.page.goto(urlFor(s, base), { waitUntil: "domcontentloaded" });
      await h.page.waitForFunction(() => {
        try {
          return window.__orderly !== undefined && window.__orderly.stop() >= 0;
        } catch {
          return false;
        }
      });
      expect(await h.page.evaluate(() => window.__orderly!.stop())).toBe(s.stop);
    } finally {
      await h.close();
    }
  }, 180_000);

  browserIt("invariant 2: the app's own buffer is what the browser shows, pixel for pixel", async () => {
    const h = await launch();
    try {
      await h.page.goto(urlFor(SCENARIOS[0]!, base), { waitUntil: "domcontentloaded" });
      await h.page.waitForFunction(() => {
        try {
          return window.__orderly !== undefined && window.__orderly.stop() >= 0;
        } catch {
          return false;
        }
      });
      await h.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const url = await h.page.evaluate(() => window.__orderly!.capture());
      const own = new Uint8Array(Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
      // `.tools` is `position: fixed` over the canvas, and an element screenshot
      // includes whatever is painted on top. The invariant is about the canvas.
      await h.page.addStyleTag({ content: ".tools { display: none !important }" });
      const shown = new Uint8Array(await h.page.locator("canvas.stage").screenshot({ type: "png" }));
      expect(diffPng(own, shown).count).toBe(0);
    } finally {
      await h.close();
    }
  }, 180_000);

  browserIt("invariant 3: a scenario is replayable — two runs, identical PNGs", async () => {
    const h = await launch();
    try {
      const s = SCENARIOS.find((x) => x.name === "hover-cell")!;
      const a = await shoot(h, s, base);
      const b = await shoot(h, s, base);
      expect(diffPng(a, b).count).toBe(0);
    } finally {
      await h.close();
    }
  }, 180_000);

  browserIt("case 8: every scenario matches its golden, exactly", async () => {
    const missing = SCENARIOS.filter((s) => !existsSync(join(GOLDEN_DIR, `${s.name}.png`)));
    if (missing.length > 0) {
      throw new Error(
        `no golden for ${missing.map((s) => s.name).join(", ")}. ` +
          "Take the shots, look at them, then `npm run shots -- --update` in the commit that adds them.",
      );
    }
    const results = await runAll([], false, base);
    for (const r of results) expect(r.differing, `${r.name}`).toBe(0);
  }, 600_000);

  browserIt("case 9 (D18): dim the SHORTFALL ink and only the deficit shots move", async () => {
    const file = "src/ui/render/palette.ts";
    const original = readFileSync(file, "utf8");
    expect(original).toContain('export const SHORTFALL = "#ffa3a3";');
    let results;
    try {
      // The colour it was before "brighter deficit ink": dark enough that every
      // pixel of deficit ink changes, and nothing else in the palette does.
      writeFileSync(file, original.replace('export const SHORTFALL = "#ffa3a3";', 'export const SHORTFALL = "#c46a6a";'));
      results = await runAll([], false, base);
    } finally {
      writeFileSync(file, original);
    }
    const by = new Map(results.map((r) => [r.name, r.differing ?? 0]));
    // The break shows a deficit, so its shot must move.
    expect(by.get("break-gold-gate")).toBeGreaterThan(0);
    // Every shot of a breaking route carries deficit ink (the list window shows
    // the breaking row from nearby stops), so the diagnostic is that no shot
    // *without* a break moves. Whether a shot breaks is the scenario's, not the
    // fixture's: `added-then-broken` breaks a clean record by editing it.
    for (const s of SCENARIOS.filter((x) => x.code === undefined && x.breaks !== true)) {
      expect(by.get(s.name), `${s.name} shows no break and must not move`).toBe(0);
    }
  }, 900_000);
});

/**
 * A failure scenario is checked against the simulator, not only its golden: a
 * shot of the wrong failure still looks plausible, and a blessed golden keeps
 * it. Headless, so drift is caught before a shot is taken.
 */
describe("SPEC-009 §4 — every failure scenario still shows the failure it names", () => {
  const withCode = SCENARIOS.filter((s) => s.code !== undefined);

  it("is named for the code it shows, so two shots cannot be confused", () => {
    // A failure shot carries its code in its name, so `break-need-gold` and
    // the canonical `break-gold-gate` cannot be confused.
    for (const s of withCode) {
      expect(s.name).toBe(`break-${s.code!.toLowerCase().replace(/_/g, "-")}`);
    }
  });

  it("names at least six error codes, each exactly once", () => {
    expect(withCode.length).toBeGreaterThanOrEqual(6);
    const codes = withCode.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  for (const s of withCode) {
    it(`${s.name}: disabling its action breaks the route with ${s.code}`, () => {
      if (!haveSaves) return;
      const step = s.steps?.find((x) => "click" in x && typeof x.click === "object" && "checkbox" in x.click);
      expect(step, `${s.name} must disable an action`).toBeDefined();
      if (!step || !("click" in step) || typeof step.click !== "object" || !("checkbox" in step.click)) return;

      const session = sessionFor(s);
      expect(session.failedFrom, `${s.name}: the record must be clean before the edit`).toBeNull();

      const site = session.sites[s.stop + step.click.checkbox];
      expect(site, `${s.name}: no action at the checkbox offset`).toBeDefined();
      if (!site) return;
      session.edit({ op: "setDisabled", epoch: site.epoch, segment: site.segment, index: site.index, value: true });

      expect(session.evaluation.mainline.error?.code).toBe(s.code);
      // And the break must land on the very stop the scenario navigates to,
      // or the shot is of a clean action with a failure somewhere off-screen.
      expect(session.failedFrom).toBe(s.stop);
    });
  }
});

/** A `RouteSession` for a scenario's fixture and record, as the app builds it. */
function sessionFor(s: (typeof SCENARIOS)[number]): RouteSession {
  const towerId = towerOfFixture(s.fixture);
  const tower = JSON.parse(readFileSync(`data/towers/v0.7-455/${towerId}.json`, "utf8")) as TowerJSON;
  const path = s.fixture.includes("/") ? s.fixture : `tests/${s.fixture}`;
  const record = parseSaveFile(new Uint8Array(readFileSync(`data/saves/${path}.sav`))).records[s.record]!;
  const route = importRoute({
    name: record.name,
    tower: tower.tower_id,
    gemsOwned: UNLIMITED_GEMS,
    waypoints: routeFromRecord(record),
  });
  return new RouteSession(ordFile([route]), 0, tower, { route: 0, stop: 0, captions: true, zoom: "auto" });
}
