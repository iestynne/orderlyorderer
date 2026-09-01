// SPEC-007 §1 — the canvas half of the app.
//
// `[D]` One canvas. React owns the chrome — empty state, file input, record
// list — and nothing inside the canvas; React must not re-render on scrub.
// That is why all scrub state lives here, in a plain class, and the only thing
// React does after mounting is hand this object a record and let go.

import { Cursor, stopStepIndices } from "../sim/cursor";
import { simulate } from "../sim/simulate";
import type { Timeline, TowerJSON, Waypoint } from "../sim/types";
import type { AtlasManifest } from "../../tools/atlas/build";
import { FloorCache } from "./render/floor";
import {
  approachScroll,
  computeScrollUnits,
  computeVisits,
  drawTimeline,
  scrollFor,
  scrollUnitOfVisit,
  slotOfVisit,
  stripWidth,
  type ScrollUnit,
  type Visit,
} from "./render/left";
import { drawRightPanel, panelX, sliderGeometry, yToStop, SETTINGS_HITBOXES } from "./render/right";
import { drawTrail, playerScreenPos, trailPoints, type TrailPoint } from "./render/trail";
import { Screen, CELL, PANEL_W, visibleTiles, type Layout, type ScreenSettings } from "./render/screen";
import { drawText, fontFrom } from "./render/atlas";
import { textWidth } from "./imagefont";
import { PerfHarness, type PerfReport } from "./perf";

export interface ScrubberSettings extends ScreenSettings {
  perf: boolean;
}

export class Scrubber {
  private readonly screen: Screen;
  private readonly perfHarness = new PerfHarness();
  private timeline!: Timeline;
  private cursor!: Cursor;
  private floors!: FloorCache;
  private visits: Visit[] = [];
  private units: ScrollUnit[] = [];
  private unitCapacity = 0;
  private points: TrailPoint[] = [];
  private stops: number[] = [];
  private ticks: number[] = [];
  private stop = 0;
  private scroll = 0;
  private scrollTarget = 0;
  private lastFrame = 0;
  private tintedPlayer: HTMLCanvasElement | null = null;
  private dirty = true;
  private raf = 0;
  private settings: ScrubberSettings;
  /**
   * `[D]` Every listener this object registers is registered with this
   * controller's signal, so `destroy` drops all of them in one call and cannot
   * miss one. `keydown` and `resize` are on `window`, which outlives the
   * canvas: left behind, they hold the whole `FloorCache` alive and keep
   * seeking a scrubber nobody can see, which is work every remount adds to.
   * StrictMode double-invokes effects, so there were two from the first mount.
   * D40.
   */
  private readonly input = new AbortController();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly manifest: AtlasManifest,
    private readonly sheet: CanvasImageSource,
    settings: ScrubberSettings,
    private readonly onSettings: (s: ScrubberSettings) => void,
  ) {
    this.settings = settings;
    this.screen = new Screen(canvas, settings);
    this.bindInput();
  }

  load(tower: TowerJSON, route: Waypoint[]): Timeline {
    this.timeline = simulate({ tower, gemsOwned: Number.POSITIVE_INFINITY, route });
    this.cursor = new Cursor(this.timeline);
    this.floors = new FloorCache(tower, this.manifest, this.sheet);
    this.stops = stopStepIndices(this.timeline, route.length);
    this.visits = computeVisits(this.timeline, this.stops);
    this.points = trailPoints(this.timeline, this.visits, this.stops);
    this.ticks = this.stops
      .map((_, i) => i)
      .filter((i) => i > 0 && this.points[i]!.visit !== this.points[i - 1]!.visit);
    this.stop = 0;
    this.scroll = 0;
    this.scrollTarget = 0;
    this.cursor.seekTo(this.stops[0] ?? 0);
    this.floors.paintAll(this.cursor.cells);
    this.dirty = true;
    this.start();
    return this.timeline;
  }

  update(settings: ScrubberSettings): void {
    this.settings = settings;
    this.screen.update(settings);
    if (!settings.perf) this.perfHarness.reset();
    this.dirty = true;
  }

  seek(stop: number): void {
    const next = Math.max(0, Math.min(this.stops.length - 1, stop));
    if (next === this.stop) return;
    this.stop = next;
    const t0 = performance.now();
    const changed = this.cursor.seekTo(this.stops[next]!);
    this.floors.invalidate(this.cursor.cells, changed);
    this.perfHarness.record({ seek: performance.now() - t0, blit: 0 });
    this.dirty = true;
  }

  /**
   * Scroll units depend on how many tiles fit, so they are recomputed when the
   * window changes size and cached in between.
   */
  private scrollUnitsFor(layout: Layout): ScrollUnit[] {
    const cap = visibleTiles(layout);
    if (this.unitCapacity !== cap || this.units.length === 0) {
      this.units = computeScrollUnits(this.visits, cap);
      this.unitCapacity = cap;
    }
    return this.units;
  }

  /** A PNG of the logical canvas at 1x — §7's capture control. */
  capture(): string {
    this.draw();
    return this.screen.buffer.toDataURL("image/png");
  }

  /**
   * Save that PNG to a file.
   *
   * `[D]` **1x, the logical canvas, not the window.** A screen grab of the
   * upscaled canvas is the same pixels repeated `scale` times and several times
   * the size; this is the exact frame the renderer produced, which is what
   * makes it worth reviewing. §7 asks for the capture to be cheap to produce
   * precisely because manual review is the only judge stage 3 has.
   */
  saveCapture(): void {
    const url = this.capture();
    const a = document.createElement("a");
    a.href = url;
    const tower = this.timeline?.tower.tower_id ?? "tower";
    a.download = `orderlyorderer-${tower}-stop${this.stop + 1}of${this.stops.length}.png`;
    a.click();
  }

  get perfReport(): PerfReport {
    return this.perfHarness.report;
  }

  start(): void {
    if (this.raf !== 0 || this.input.signal.aborted) return;
    const loop = (now: number): void => {
      if (this.settings.perf && this.stops.length > 1) {
        const target = this.perfHarness.tick(now, this.stops.length);
        if (target !== null) this.seek(target);
      }
      if (this.dirty) this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /**
   * Tear down for good: stop the loop and drop every listener with it. Not a
   * pause — a destroyed scrubber does not restart, because the only caller is
   * React unmounting the canvas it draws to.
   */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.abort();
  }

  resize(): void {
    this.screen.resize();
    this.dirty = true;
  }

  private draw(): void {
    const t0 = performance.now();
    const { ctx, layout } = this.screen;
    const captions = this.settings.captions;
    // Smart layout: the strip shows the current scroll unit's working set, one
    // tile per floor. Within a unit nothing moves, so most scrubbing scrolls
    // nothing at all (UI.md §2).
    const visit = this.points[this.stop]?.visit ?? 0;
    const units = this.scrollUnitsFor(layout);
    const unit = units[scrollUnitOfVisit(units, visit)]!;
    const currentSlot = slotOfVisit(unit, this.visits, visit);
    this.scrollTarget = scrollFor(currentSlot, this.scrollTarget, layout, stripWidth(layout, PANEL_W));
    const now = performance.now();
    const dt = this.lastFrame === 0 ? 16 : Math.min(100, now - this.lastFrame);
    this.lastFrame = now;
    this.scroll = approachScroll(this.scroll, this.scrollTarget, dt);

    ctx.fillStyle = "#0c0c10";
    ctx.fillRect(0, 0, layout.w, layout.h);

    const tower = this.timeline.tower;
    drawTimeline(ctx, this.floors, this.manifest, this.sheet, tower, unit, currentSlot, this.scroll, layout, captions, PANEL_W);
    drawTrail(ctx, this.points, this.visits, unit, this.stop, this.scroll, layout, captions);
    this.drawPlayer(unit);

    const player = this.cursor.player;
    drawRightPanel(ctx, this.manifest, this.sheet, this.floors, {
      tower,
      player,
      floorName: tower.floors[player.z - 1]?.name ?? `Floor ${player.z}`,
      stop: this.stop,
      stopCount: this.stops.length,
      ticks: this.ticks,
      currentFloor: player.z,
      captions,
      perf: this.settings.perf,
      perfLine: this.perfHarness.line,
    }, layout);

    this.screen.present();
    this.perfHarness.record({ seek: 0, blit: performance.now() - t0 });
    // Keep redrawing while the strip is still gliding to its target.
    this.dirty = this.settings.perf || this.scroll !== this.scrollTarget;
  }

  /**
   * `[D]` The player is not in the atlas — its value changes every waypoint and
   * it carries an independent tint (§4.3), so it is drawn straight.
   */
  private drawPlayer(unit: ScrollUnit): void {
    const { ctx, layout } = this.screen;
    const pos = playerScreenPos(this.points, this.visits, unit, this.stop, this.scroll, layout, this.settings.captions);
    if (!pos) return;
    const sprite = this.playerSprite();
    if (sprite) ctx.drawImage(sprite, pos.x, pos.y);
    // ...with its power beneath it, as the game does (leveldata.lua:285-295).
    const digits = fontFrom(this.manifest, "FONT_DIGITS");
    const p = this.cursor.player.power;
    const label = p > 1e9 ? `${Math.floor(p / 1e9)}G` : p > 1e6 ? `${Math.floor(p / 1e6)}M` : p > 1e3 ? `${Math.floor(p / 1e3)}k` : String(p);
    drawText(ctx, this.sheet, digits, label, pos.x + CELL - 1 - textWidth(digits, label), pos.y + 11);
  }

  /**
   * `[F]` The game tints the player `(0.5, 1, 1)` under its `player_tint`
   * setting (leveldata.lua:281-284) and draws everything else white — D26's
   * "monochrome apart from the player". Untinted, the player is one more white
   * sprite among fifteen and genuinely hard to find.
   *
   * Canvas 2D has no per-draw colour multiply, so the tint is baked once:
   * `multiply` lays the colour over the sprite, then `destination-in` puts the
   * sprite's own alpha back, which keeps the transparent border transparent.
   */
  private playerSprite(): HTMLCanvasElement | null {
    if (this.tintedPlayer) return this.tintedPlayer;
    const r = this.manifest.sprites["player"];
    if (!r) return null;
    const c = document.createElement("canvas");
    c.width = CELL;
    c.height = CELL;
    const g = c.getContext("2d");
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.sheet, r.x, r.y, r.w, r.h, 0, 0, CELL, CELL);
    g.globalCompositeOperation = "multiply";
    g.fillStyle = "rgb(128, 255, 255)";
    g.fillRect(0, 0, CELL, CELL);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(this.sheet, r.x, r.y, r.w, r.h, 0, 0, CELL, CELL);
    this.tintedPlayer = c;
    return c;
  }

  setZoom(scale: number): void {
    this.onSettings({ ...this.settings, zoom: Math.max(1, Math.min(8, Math.round(scale))) });
  }

  private bindInput(): void {
    const { signal } = this.input;
    const stopFromY = (clientY: number): number => {
      const rect = this.canvas.getBoundingClientRect();
      const g = sliderGeometry(this.screen.layout);
      const y = ((clientY - rect.top) / rect.height) * this.screen.layout.h;
      return yToStop(y, this.stops.length, g);
    };
    let dragging = false;

    const onDown = (e: PointerEvent): void => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.screen.layout.w;
      const y = ((e.clientY - rect.top) / rect.height) * this.screen.layout.h;
      const boxes = SETTINGS_HITBOXES(this.screen.layout);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]!;
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          this.onSettings(i === 0 ? { ...this.settings, perf: !this.settings.perf } : { ...this.settings, captions: !this.settings.captions });
          return;
        }
      }
      if (x >= panelX(this.screen.layout) - 2 && x <= panelX(this.screen.layout) + 14) {
        dragging = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.seek(stopFromY(e.clientY));
      }
    };
    this.canvas.addEventListener("pointerdown", onDown, { signal });
    this.canvas.addEventListener("pointermove", (e) => {
      if (dragging) this.seek(stopFromY(e.clientY));
    }, { signal });
    this.canvas.addEventListener("pointerup", (e) => {
      dragging = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    }, { signal });
    window.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      // `[D]` Left/right only. Up/down were also bound, and inverted against
      // the slider they were meant to match -- but the fix is not to flip them:
      // the toolbar advertises left/right, the timeline reads left to right,
      // and a second binding for the same thing is a second thing to keep
      // consistent. Up/down are free for the tower stack later.
      if (e.key === "ArrowRight") this.seek(this.stop + step);
      else if (e.key === "ArrowLeft") this.seek(this.stop - step);
      else if (e.key === "Home") this.seek(0);
      else if (e.key === "End") this.seek(this.stops.length - 1);
      // Ctrl+ and Ctrl- are the browser's, and the browser zooming a canvas
      // gives a blurry non-integer scale -- so the app owns zoom itself.
      else if (e.key === "+" || e.key === "=") this.setZoom(this.screen.layout.scale + 1);
      else if (e.key === "-" || e.key === "_") this.setZoom(this.screen.layout.scale - 1);
      else if (e.key === "0") this.onSettings({ ...this.settings, zoom: "auto" });
      else if (e.key === "s" || e.key === "S") this.saveCapture();
      else return;
      e.preventDefault();
    }, { signal });
    window.addEventListener("resize", () => this.resize(), { signal });
  }
}


