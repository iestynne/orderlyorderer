// SPEC-007 §1 + SPEC-008 §8 — the canvas half of the app.
//
// `[D]` One canvas. React owns the chrome — empty state, file input, record
// list, the occasional editing commands — and nothing inside the canvas; React
// must not re-render on scrub. That is why all scrub state lives here, in a
// plain class, and the only thing React does after mounting is hand this object
// a session and let go. An *edit* is the exception: it changes the document, so
// it calls back once, at the speed of a click.

import { Cursor } from "../sim/cursor";
import { simulate } from "../sim/simulate";
import type { Timeline, Waypoint } from "../sim/types";
import type { AtlasManifest } from "../../tools/atlas/build";
import { activeSegment } from "../sim/route/document";
import { cellKey, type RouteSession } from "./session";
import type { Mode } from "../store/working";
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
  tileOrigin,
  type ScrollUnit,
  type Visit,
} from "./render/left";
import {
  MODES,
  drawBadges,
  drawBracket,
  drawFailure,
  drawModeButtons,
  modeHitboxes,
  pipHitboxes,
  type BracketState,
} from "./render/edit";
import { drawRightPanel, panelX, sliderGeometry, yToStop, SETTINGS_HITBOXES } from "./render/right";
import { drawTrail, playerScreenPos, trailPoints, type TrailPoint } from "./render/trail";
import { Screen, CELL, FLOOR, PANEL_W, visibleTiles, type Layout, type ScreenSettings } from "./render/screen";
import { drawText, fontFrom } from "./render/atlas";
import { textWidth } from "./imagefont";
import { PerfHarness, type PerfReport } from "./perf";

export interface ScrubberSettings extends ScreenSettings {
  perf: boolean;
}

export class Scrubber {
  private readonly screen: Screen;
  private readonly perfHarness = new PerfHarness();
  private session!: RouteSession;
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
    /**
     * Called when the chrome has something to re-read — an edit, an undo, a
     * mode change. Never on a scrub, which is the whole point: React must not
     * re-render at frame rate.
     */
    private readonly onDocument: () => void = () => {},
  ) {
    this.settings = settings;
    this.screen = new Screen(canvas, settings);
    this.bindInput();
  }

  load(session: RouteSession): void {
    this.session = session;
    this.floors = new FloorCache(session.tower, this.manifest, this.sheet);
    this.stop = session.view.stop;
    this.scroll = 0;
    this.scrollTarget = 0;
    this.rebuild();
    this.start();
  }

  /** Everything derived from the evaluation, rebuilt after a load or an edit. */
  private rebuild(): void {
    this.timeline = this.session.evaluation.mainline;
    this.cursor = new Cursor(this.timeline);
    this.stops = this.session.stops;
    this.visits = computeVisits(this.timeline, this.stops);
    this.points = trailPoints(this.timeline, this.visits, this.stops);
    this.ticks = this.stops
      .map((_, i) => i)
      .filter((i) => i > 0 && this.points[i]!.visit !== this.points[i - 1]!.visit);
    this.units = [];
    this.unitCapacity = 0;
    this.stop = Math.max(0, Math.min(this.stops.length - 1, this.stop));
    this.cursor.seekTo(this.stops[this.stop] ?? 0);
    this.floors.paintAll(this.cursor.cells);
    this.session.view = { ...this.session.view, stop: this.stop };
    this.dirty = true;
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
    this.session.view = { ...this.session.view, stop: next };
    this.dirty = true;
  }

  // --- editing -----------------------------------------------------------

  get mode(): Mode {
    return this.session.view.mode;
  }

  setMode(mode: Mode): void {
    this.session.setMode(mode);
    this.dirty = true;
    this.onDocument();
  }

  /** Every document-tier change lands here: re-derive, re-seek, tell React once. */
  private commit(stop = this.stop): void {
    this.stop = stop;
    this.rebuild();
    this.onDocument();
  }

  undo(): void {
    this.session.undo();
    this.commit();
  }

  redo(): void {
    this.session.redo();
    this.commit();
  }

  /** Cut the current epoch in two at the action the slider is on. */
  splitHere(): void {
    const site = this.session.sites[this.stop];
    if (!site) return;
    this.session.edit({ op: "split", epoch: site.epoch, index: site.index });
    this.commit();
  }

  addAlternative(): void {
    const { epoch } = this.session.selection();
    this.session.edit({ op: "addSegment", epoch });
    this.commit();
  }

  toggleSkippable(): void {
    const { epoch } = this.session.selection();
    this.session.edit({ op: "setSkippable", epoch, value: !this.session.route.epochs[epoch]!.skippable });
    this.commit();
  }

  rename(name: string): void {
    const { epoch, segment } = this.session.selection();
    this.session.edit({ op: "rename", epoch, segment, name });
    this.commit();
  }

  mergeNext(): void {
    const { epoch } = this.session.selection();
    if (epoch + 1 >= this.session.route.epochs.length) return;
    this.session.edit({ op: "merge", epoch });
    this.commit();
  }

  /**
   * `[F]` SAVE_FORMAT §3: an interaction is recorded **iff** it changes state.
   * So the same question decides whether a click in add mode is an action —
   * and the simulator answers it, rather than a list of entity types here that
   * would have to be kept in step with the rules.
   */
  private wouldAct(target: Waypoint): boolean {
    const t = simulate(
      { tower: this.session.tower, gemsOwned: this.session.route.gemsOwned, route: [target] },
      { player: this.cursor.player, cells: this.cursor.cells, kills: this.cursor.kills },
    );
    const last = t.steps.at(-1);
    if (t.error !== undefined || last === undefined) return false;
    if (t.steps.some((s) => s.edits.length > 0)) return true;
    const a = t.initial;
    const b = last.player;
    return (
      a.power !== b.power || a.gold !== b.gold || a.lightKeys !== b.lightKeys || a.darkKeys !== b.darkKeys ||
      a.pickaxes !== b.pickaxes || a.gemsSpent !== b.gemsSpent || a.held !== b.held || a.win !== b.win
    );
  }

  /**
   * `[I]` In add mode a left-click paths the player to the clicked tile and
   * performs whatever action is implied, exactly as the game does; a click
   * implying no action is ignored.
   */
  private addAt(target: Waypoint): void {
    if (!this.wouldAct(target)) return;
    const site = this.session.sites[this.stop];
    const selection = this.session.selection();
    const epoch = site?.epoch ?? selection.epoch;
    const segment = site?.segment ?? selection.segment;
    const index = site ? site.index + 1 : activeSegment(this.session.route.epochs[epoch]!).actions.length;
    const p = this.cursor.player;
    this.session.edit({
      op: "insert",
      epoch,
      segment,
      index,
      action: { from: { z: p.z, x: p.x, y: p.y }, to: target },
    });
    this.commit(this.stop + 1);
  }

  /** `[I]` In remove mode a left-click toggles the clicked action. */
  private toggleAt(target: Waypoint): void {
    const key = cellKey(target);
    let found: { epoch: number; segment: number; index: number } | null = null;
    let nearest = Number.POSITIVE_INFINITY;
    this.session.route.epochs.forEach((epoch, e) => {
      activeSegment(epoch).actions.forEach((action, index) => {
        if (cellKey(action.to) !== key) return;
        // A route revisits a cell, so the action the player means is the one
        // they are standing on. A disabled one has no stop, and loses the tie.
        const stop = this.session.sites.findIndex((s) => s.epoch === e && s.index === index);
        const distance = stop < 0 ? Number.MAX_SAFE_INTEGER : Math.abs(stop - this.stop);
        if (distance >= nearest) return;
        nearest = distance;
        found = { epoch: e, segment: epoch.active, index };
      });
    });
    if (found === null) return;
    const site: { epoch: number; segment: number; index: number } = found;
    const action = this.session.route.epochs[site.epoch]!.segments[site.segment]!.actions[site.index]!;
    const disabling = action.disabled !== true;
    this.session.edit({ ...site, op: "setDisabled", value: disabling });
    this.commit(disabling ? Math.max(0, this.stop - 1) : this.stop);
  }

  // --- drawing -----------------------------------------------------------

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

  /** The epoch the slider is in, and its alternatives, for the bracket. */
  private bracket(unit: ScrollUnit): BracketState {
    const { epoch: e } = this.session.selection();
    const epoch = this.session.route.epochs[e]!;
    const result = this.session.evaluation.epochs[e];
    const slots: number[] = [];
    this.session.sites.forEach((site, stop) => {
      if (site.epoch !== e) return;
      const visit = this.points[stop]?.visit;
      if (visit === undefined || visit < unit.from || visit >= unit.to) return;
      const slot = unit.floors.indexOf(this.visits[visit]!.z);
      if (slot >= 0) slots.push(slot);
    });
    const segment = activeSegment(epoch);
    return {
      span: slots.length === 0 ? null : { from: Math.min(...slots), to: Math.max(...slots) },
      name: epoch.name ? `${epoch.name}: ${segment.name}` : segment.name,
      skippable: epoch.skippable,
      skipped: result?.skipped === true,
      pips: epoch.segments.map((_, i) =>
        i === epoch.active ? "active" : result?.forks[i] === null || result === undefined ? "passes" : "fails",
      ),
    };
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
    const standard = fontFrom(this.manifest, "FONT_STANDARD");
    const failedFrom = this.session.failedFrom;
    drawTimeline(ctx, this.floors, this.manifest, this.sheet, tower, unit, currentSlot, this.scroll, layout, captions, PANEL_W);
    drawBadges(ctx, unit, this.session.badgeCells(), this.scroll, layout, captions);
    drawTrail(ctx, this.points, this.visits, unit, this.stop, this.scroll, layout, captions, failedFrom);
    this.drawPlayer(unit);
    drawBracket(ctx, this.sheet, standard, this.bracket(unit), this.scroll, layout, captions);
    const error = this.session.evaluation.mainline.error;
    if (error !== undefined) {
      drawFailure(ctx, this.sheet, standard, error, unit, this.visits, this.scroll, layout, captions);
    }
    drawModeButtons(ctx, layout, PANEL_W, this.mode);

    const player = this.cursor.player;
    drawRightPanel(ctx, this.manifest, this.sheet, this.floors, {
      tower,
      player,
      floorName: tower.floors[player.z - 1]?.name ?? `Floor ${player.z}`,
      stop: this.stop,
      stopCount: this.stops.length,
      ticks: this.ticks,
      currentFloor: player.z,
      failedFrom,
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

  /** The scroll unit currently on screen. */
  private currentUnit(): ScrollUnit {
    const units = this.scrollUnitsFor(this.screen.layout);
    return units[scrollUnitOfVisit(units, this.points[this.stop]?.visit ?? 0)]!;
  }

  /** Which cell of which floor a logical point lands on, or null for none. */
  private cellAt(x: number, y: number): Waypoint | null {
    const layout = this.screen.layout;
    const unit = this.currentUnit();
    for (const [slot, z] of unit.floors.entries()) {
      const o = tileOrigin(slot, this.scroll, layout, this.settings.captions);
      if (x < o.x || x >= o.x + FLOOR || y < o.y || y >= o.y + FLOOR) continue;
      return { z, x: Math.floor((x - o.x) / CELL) + 1, y: Math.floor((y - o.y) / CELL) + 1 };
    }
    return null;
  }

  private pipAt(x: number, y: number): number | null {
    const layout = this.screen.layout;
    const boxes = pipHitboxes(this.bracket(this.currentUnit()), this.scroll, layout, this.settings.captions);
    for (const [i, b] of boxes.entries()) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i;
    }
    return null;
  }

  private bindInput(): void {
    const { signal } = this.input;
    const logical = (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * this.screen.layout.w,
        y: ((clientY - rect.top) / rect.height) * this.screen.layout.h,
      };
    };
    const stopFromY = (clientY: number): number => {
      const g = sliderGeometry(this.screen.layout);
      return yToStop(logical(0, clientY).y, this.stops.length, g);
    };
    let dragging = false;

    const onDown = (e: PointerEvent): void => {
      const { x, y } = logical(e.clientX, e.clientY);
      const modes = modeHitboxes(this.screen.layout, PANEL_W);
      for (const [i, b] of modes.entries()) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          this.setMode(MODES[i]!);
          return;
        }
      }
      const boxes = SETTINGS_HITBOXES(this.screen.layout);
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]!;
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          this.onSettings(i === 0 ? { ...this.settings, perf: !this.settings.perf } : { ...this.settings, captions: !this.settings.captions });
          return;
        }
      }
      // `[I]` Choosing between parallel segments by clicking.
      const pip = this.pipAt(x, y);
      if (pip !== null) {
        const { epoch } = this.session.selection();
        this.session.edit({ op: "setActive", epoch, segment: pip });
        this.commit();
        return;
      }
      if (this.mode !== "scrub") {
        const cell = this.cellAt(x, y);
        if (cell !== null) {
          if (this.mode === "add") this.addAt(cell);
          else this.toggleAt(cell);
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
      // `[I]` Z and Y single-step the history, mirroring the game's own undo
      // and redo, because a slider cannot pick one step out of thousands.
      else if (e.key === "z" || e.key === "Z") this.undo();
      else if (e.key === "y" || e.key === "Y") this.redo();
      // Ctrl+ and Ctrl- are the browser's, and the browser zooming a canvas
      // gives a blurry non-integer scale -- so the app owns zoom itself.
      else if (e.key === "+" || e.key === "=") this.setZoom(this.screen.layout.scale + 1);
      else if (e.key === "-" || e.key === "_") this.setZoom(this.screen.layout.scale - 1);
      else if (e.key === "0") this.onSettings({ ...this.settings, zoom: "auto" });
      else if (e.key === "s" || e.key === "S") this.saveCapture();
      else if (e.key === "1" || e.key === "2" || e.key === "3") this.setMode(MODES[Number(e.key) - 1]!);
      else return;
      e.preventDefault();
    }, { signal });
    window.addEventListener("resize", () => this.resize(), { signal });
  }
}
