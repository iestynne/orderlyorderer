// Stage 3 smoke: run the whole draw path over real records with a stub 2D
// context.
//
// SPEC-007 §8 deliberately does NOT put the UI under the Verification
// Contract — it is judged by looking at it. This is not a substitute for
// looking. What it does is much narrower and still worth having: it proves the
// draw path executes end to end for every visit of a real route without
// throwing, and that the visit and trail arithmetic lines up with the route.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fontFrom } from "../../src/ui/render/atlas";
import { textWidth } from "../../src/ui/imagefont";

import { routeFromRecord } from "../../src/sav/route";
import { Cursor, stopStepIndices } from "../../src/sim/cursor";
import { simulate } from "../../src/sim/simulate";
import type { TowerJSON } from "../../src/sim/types";
import { computeVisits, computeWorkingSets, drawTimeline, gridCapacity, gridFor, slotOfVisit, visitOfStop, workingSetOfVisit } from "../../src/ui/render/left";
import { drawRightPanel, sliderGeometry, spriteRect, stackHeight, stackPitch, statusRows, STACK_FLOOR_H, STACK_FLOOR_W, STACK_SHEAR, } from "../../src/ui/render/right";
import { drawTrail, trailPoints } from "../../src/ui/render/trail";
import { layoutFor, PANEL_W, STACK_W } from "../../src/ui/render/screen";
import { bake } from "../../src/ui/render/atlas";
import { buildAtlas, type AtlasManifest } from "../../tools/atlas/build";
import { TOWER_IDS } from "../../tools/maps/types";
import { haveSaves, loadAllSaves } from "../sav/helpers";
import { existsSync } from "node:fs";

const STACK_MAX_GAP_PX = 2;

const GAME_DIR = process.env["TOS_GAME_DIR"] ?? join(process.cwd(), "..", "local", "game", "v0.7-455");
const ready = haveSaves && existsSync(join(GAME_DIR, "res"));
const d = ready ? describe : describe.skip;

/** Where the player stands at each stop, which is what the panel lays out. */
function positionsOf(timeline: ReturnType<typeof simulate>, stops: number[]) {
  return stops.map((step) => {
    const p = step === 0 ? timeline.initial : timeline.steps[step - 1]!.player;
    return { z: p.z, x: p.x, y: p.y };
  });
}

/** Records what was asked of it and nothing else. Enough for "did it throw". */
function stubCtx(): { ctx: any; calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = (k: string) => () => {
    calls[k] = (calls[k] ?? 0) + 1;
  };
  const ctx = {
    canvas: { width: 0, height: 0 },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    imageSmoothingEnabled: false,
    drawImage: count("drawImage"),
    fillRect: count("fillRect"),
    strokeRect: count("strokeRect"),
    beginPath: count("beginPath"),
    moveTo: count("moveTo"),
    lineTo: count("lineTo"),
    stroke: count("stroke"),
    rect: count("rect"),
    clip: count("clip"),
    save: count("save"),
    restore: count("restore"),
    setLineDash: count("setLineDash"),
    closePath: count("closePath"),
    fill: count("fill"),
    clearRect: count("clearRect"),
    arc: count("arc"),
  };
  return { ctx, calls };
}

function stubCanvas(w: number, h: number): { canvas: any; ctx: any } {
  return { canvas: { width: w, height: h }, ctx: stubCtx().ctx };
}

/** A FloorCache stand-in: the real one needs document.createElement. */
function stubFloors(depth: number, manifest: AtlasManifest, tower: TowerJSON): any {
  const atlas = bake(tower, manifest, {} as any, stubCanvas);
  return {
    depth,
    atlas,
    image: () => ({ width: 240, height: 240 }),
    // The real one supersamples with a box filter; that needs a canvas, and
    // what this test is asking is whether the draw path runs, not how it looks.
    mini: (_z: number, w: number, h: number) => ({ width: w, height: h }),
  };
}

d("stage 3 — the draw path runs over real records", () => {
  const manifest = buildAtlas(GAME_DIR).manifest;
  const layout = layoutFor(1920, 1080, { pixelPerfect: true, linearFilter: false, zoom: "auto" as const });

  it("draws every visit of a long route with no exception", () => {
    const save = loadAllSaves().find((s) => s.towerId === "2-5")!;
    const rec = save.file.records.reduce((a, b) => (b.entries.length > a.entries.length ? b : a));
    const route = routeFromRecord(rec);
    const timeline = simulate({ tower: save.tower, gemsOwned: Number.POSITIVE_INFINITY, route });
    expect(timeline.error).toBeUndefined();

    const stops = stopStepIndices(timeline, route.length);
    const visits = computeVisits(positionsOf(timeline, stops));
    const sets = computeWorkingSets(visits, gridCapacity(layout, PANEL_W));
    const points = trailPoints(positionsOf(timeline, stops), visits);
    expect(points.length).toBe(stops.length);
    // Every trail point names a visit that exists, on the floor the player is on.
    for (let i = 0; i < points.length; i++) {
      const v = visits[points[i]!.visit];
      expect(v, `stop ${i}`).toBeDefined();
    }

    const cursor = new Cursor(timeline);
    const floors = stubFloors(save.tower.floors.length, manifest, save.tower);
    const { ctx, calls } = stubCtx();

    for (let i = 0; i < stops.length; i += Math.max(1, Math.floor(stops.length / 60))) {
      cursor.seekTo(stops[i]!);
      const current = points[i]!.visit;
      const set = sets[workingSetOfVisit(sets, current)]!;
      const slot = slotOfVisit(set, visits, current);
      const grid = gridFor(layout, PANEL_W, set.floors.length);
      drawTimeline(ctx, floors, manifest, {} as any, save.tower, set, slot, grid, layout, PANEL_W);
      drawTrail(ctx, points, visits, set, i, grid, layout);
      drawRightPanel(ctx, manifest, {} as any, floors, {
        tower: save.tower,
        player: cursor.player,
        floorName: save.tower.floors[cursor.player.z - 1]!.name,
        stop: i,
        stopCount: stops.length,
        ticks: [],
        failedFrom: null,
        currentFloor: cursor.player.z,
          perf: false,
        perfLine: "", score: 0,
      }, layout);
    }
    expect(calls["drawImage"]).toBeGreaterThan(0);
    expect(calls["stroke"]).toBeGreaterThan(0);
  });

  // docs/UI.md §2. The feature UI.md §6 deferred for wanting a tuning
  // parameter: it turns out capacity IS the parameter.
  it("a working set that fits is one set: one tile per floor, and the panel never moves", () => {
    const save = loadAllSaves().find((s) => s.towerId === "1-5")!;
    const rec = save.file.records.find((r) => r.name === "4.6G win") ?? save.file.records[0]!;
    const route = routeFromRecord(rec);
    const timeline = simulate({ tower: save.tower, gemsOwned: Number.POSITIVE_INFINITY, route });
    const stops = stopStepIndices(timeline, route.length);
    const visits = computeVisits(positionsOf(timeline, stops));
    const sets = computeWorkingSets(visits, gridCapacity(layout, PANEL_W));

    // 1-5 is three floors, so however much the route bounces between them it is
    // one set with three tiles -- where per-visit layout gave dozens.
    expect(save.tower.floors.length).toBe(3);
    expect(visits.length).toBeGreaterThan(3);
    expect(sets.length).toBe(1);
    expect(sets[0]!.floors.length).toBeLessThanOrEqual(3);

    // ...and every stop of the route is in it, so the panel never changes.
    for (let i = 0; i < stops.length; i++) {
      expect(workingSetOfVisit(sets, visitOfStop(visits, i))).toBe(0);
    }
  });

  it("every working set fits the panel, and the sets tile the visit list", () => {
    for (const cap of [3, 5, 8]) {
      for (const { tower, file } of loadAllSaves().slice(0, 5)) {
        for (const rec of file.records.slice(0, 2)) {
          const route = routeFromRecord(rec);
          const timeline = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route });
          if (timeline.error) continue;
          const stops = stopStepIndices(timeline, route.length);
          const visits = computeVisits(positionsOf(timeline, stops));
          const segs = computeWorkingSets(visits, cap);
          expect(segs[0]!.from).toBe(0);
          expect(segs.at(-1)!.to).toBe(visits.length);
          for (let i = 0; i < segs.length; i++) {
            expect(segs[i]!.floors.length, `cap ${cap}`).toBeLessThanOrEqual(cap);
            if (i > 0) expect(segs[i]!.from).toBe(segs[i - 1]!.to);
            // Every visit in the set has a tile to be drawn in.
            for (let v = segs[i]!.from; v < segs[i]!.to; v++) {
              expect(segs[i]!.floors).toContain(visits[v]!.z);
            }
          }
        }
      }
    }
  });

  it("a floor revisited gets a second tile, and visits tile the stop list", () => {
    for (const { tower, file } of loadAllSaves().slice(0, 4)) {
      for (const rec of file.records.slice(0, 3)) {
        const route = routeFromRecord(rec);
        const timeline = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route });
        if (timeline.error) continue;
        const stops = stopStepIndices(timeline, route.length);
        const visits = computeVisits(positionsOf(timeline, stops));
        expect(visits[0]!.from).toBe(0);
        expect(visits.at(-1)!.to).toBe(stops.length);
        for (let i = 1; i < visits.length; i++) {
          expect(visits[i]!.from, "no gap between visits").toBe(visits[i - 1]!.to);
          expect(visits[i]!.z, "a visit is a change of floor").not.toBe(visits[i - 1]!.z);
        }
        for (const v of visits) expect(visits[visitOfStop(visits, v.from)]!.z).toBe(v.z);
      }
    }
  });

  // `[D]` D39. The shear used to be applied a source row at a time, which on
  // 2-5 is 32 floors x 64 rows = 2 048 drawImage calls in every scrub update,
  // for a projection that never changes. It is baked into the cached miniature
  // now, so a floor is one blit; the panel's remaining draws are its text, a
  // glyph at a time. The bound is what separates those two regimes.
  it("the tower stack is one blit per floor, not one per row", () => {
    const save = loadAllSaves().find((s) => s.towerId === "2-5")!;
    const depth = save.tower.floors.length;
    const floors = stubFloors(depth, manifest, save.tower);
    const { ctx, calls } = stubCtx();
    const player = { ...simulate({ tower: save.tower, gemsOwned: Number.POSITIVE_INFINITY, route: [] }).initial };
    drawRightPanel(ctx, manifest, {} as any, floors, {
      tower: save.tower,
      player,
      floorName: save.tower.floors[0]!.name,
      stop: 0,
      stopCount: 100,
      ticks: [],
      currentFloor: 1,
      failedFrom: null,
      perf: false,
      perfLine: "", score: 0,
    }, layout);
    expect(depth).toBe(32);
    expect(calls["drawImage"]!).toBeGreaterThanOrEqual(depth);
    expect(calls["drawImage"]!).toBeLessThan(depth * 8);
  });

  // The shear pushes a floor's top row ceil((h-1)/SHEAR) px right, so the
  // tallest floor plus its shear is the stack's true width. Getting this wrong
  // cropped every floor's right edge against the clip box.
  it("the tower stack fits its own width, shear included", () => {
    expect(STACK_SHEAR).toBe(2);
    expect(STACK_FLOOR_W + Math.ceil((STACK_FLOOR_H - 1) / STACK_SHEAR)).toBeLessThanOrEqual(STACK_W);
    expect(STACK_FLOOR_W).toBeGreaterThan(120);
  });

  // `[D]` The stack does not scroll. Whatever the tower, it is laid out to fit
  // the panel -- so this has to hold for the tallest one in the game, not just
  // the ones with saves.
  it("every tower fits the stack without scrolling, 3 floors to 75", () => {
    const panel = sliderGeometry(layout).h;
    for (const id of TOWER_IDS) {
      const depth = JSON.parse(
        readFileSync(join(process.cwd(), "data", "towers", "v0.7-455", `${id}.json`), "utf8"),
      ).floors.length as number;
      expect(stackHeight(depth, panel), `${id} (${depth} floors)`).toBeLessThanOrEqual(panel);
      const pitch = stackPitch(depth, panel);
      expect(pitch, `${id} pitch`).toBeGreaterThanOrEqual(1);
      // A short tower is spaced out but not sprawling: at most 2 px of air.
      expect(pitch, `${id} pitch cap`).toBeLessThanOrEqual(STACK_FLOOR_H + STACK_MAX_GAP_PX);
    }
  });

  it("a short tower gets gaps, a tall one overlaps", () => {
    const panel = sliderGeometry(layout).h;
    // Tiny Tower: three floors, so the cap binds and they sit apart.
    expect(stackPitch(3, panel)).toBe(STACK_FLOOR_H + STACK_MAX_GAP_PX);
    // The Orderly Order at 32 and the Golden Dojo at 75 must overlap to fit,
    // which is what the 2 px border is for.
    expect(stackPitch(32, panel)).toBeLessThan(STACK_FLOOR_H);
    expect(stackPitch(75, panel)).toBeLessThan(stackPitch(32, panel));
  });

  // `vorpal` the entity type is `vorpal_sword.png` the sprite. Most held items
  // share a name with their sprite, which is exactly why looking up the type
  // directly seemed to work until it met the one that does not.
  it("every held item resolves to a sprite in the atlas", () => {
    const { manifest } = { manifest: buildAtlas(GAME_DIR).manifest };
    const held = [
      "vorpal", "golden_dagger", "golden_claymore", "light_rod", "dark_rod",
      "master_key", "hyper_pickaxe", "feather", "shield", "keysmasher",
    ] as const;
    const missing = held.filter((h) => spriteRect(manifest, h) === undefined);
    expect(missing).toEqual([]);
    // The one that would have been missed by a bare name lookup.
    expect(manifest.sprites["vorpal"]).toBeUndefined();
    expect(spriteRect(manifest, "vorpal")).toBeDefined();
    // ...and the rows that are addressed by sprite name still resolve.
    for (const s of ["key", "dark_key", "pickaxe", "gem"]) {
      expect(spriteRect(manifest, s), s).toBeDefined();
    }
  });

  it("hides the rows the game hides", () => {
    const ex3 = JSON.parse(
      readFileSync(join(process.cwd(), "data", "towers", "v0.7-455", "EX-3.json"), "utf8"),
    ) as TowerJSON;
    const player = {
      z: 1, x: 1, y: 1, power: 1284900, gold: 0, lightKeys: -3, darkKeys: 0, pickaxes: 2,
      gemsSpent: 4, held: null, pendingPopup: null, win: 0 as const, submittedScore: 0,
    };
    // EX-3 runs negative_keys, so the dark-key counter is meaningless and absent.
    const sprites = statusRows(ex3, player).map((r) => r.sprite);
    expect(sprites).not.toContain("dark_key");
    expect(sprites).toContain("key");
    // No money system on EX-3, and nothing held.
    expect(sprites).not.toContain("money");
    expect(statusRows(ex3, { ...player, held: "shield" }).map((r) => r.sprite)).toContain("shield");
  });

  // `[F]` Power leads on its own line precisely because it is the only value
  // that needs width; the line under it is sized for the rest, and this is what
  // says so. Every item gets the same slot, so none of them shifts as another
  // appears or disappears.
  it("no status item outgrows the digits it reserves, over every record", () => {
    // Measured over the corpus, never from a made-up player: a synthetic maximum
    // only proves the fixture is bigger than the slot.
    const digits = fontFrom(manifest, "FONT_DIGITS");
    const worst = new Map<string, { value: string; digits: number; where: string }>();
    for (const { towerId, file, tower } of loadAllSaves()) {
      for (const record of file.records) {
        let tl;
        try {
          tl = simulate({ tower, gemsOwned: Number.MAX_SAFE_INTEGER, route: routeFromRecord(record) });
        } catch {
          continue;
        }
        for (const step of tl.steps) {
          for (const row of statusRows(tower, step.player)) {
            const prev = worst.get(row.title);
            if (prev === undefined || row.value.length > prev.value.length) {
              worst.set(row.title, { value: row.value, digits: row.digits, where: towerId + "/" + record.name });
            }
          }
        }
      }
    }
    expect(worst.size, "the sweep must have seen some rows").toBeGreaterThan(3);
    for (const [title, seen] of worst) {
      expect(textWidth(digits, seen.value), title + " = " + seen.value + " in " + seen.where)
        .toBeLessThanOrEqual(textWidth(digits, "0".repeat(seen.digits)));
    }
  });
});
