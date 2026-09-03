// SPEC-007 §1 + SPEC-008 §8 — the canvas half of the app.
//
// `[D]` One canvas. React owns the chrome — empty state, file input, record
// list, save and export — and nothing inside the canvas; React must not
// re-render on scrub. That is why all scrub state lives here, in a plain class,
// and the only thing React does after mounting is hand this object a session
// and let go. An *edit* is the exception: it changes the document, so it calls
// back once, at the speed of a click.

import { Cursor } from "../sim/cursor";
import { activeSegment } from "../sim/route/document";
import { describeAction, type ActionSummary } from "../sim/route/describe";
import { simulate } from "../sim/simulate";
import type { Timeline, Waypoint } from "../sim/types";
import type { AtlasManifest } from "../../tools/atlas/build";
import type { RouteSession } from "./session";
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
  ROW_H,
  actionsGeometry,
  checkboxAt,
  drawActionCard,
  drawActionList,
  rowAt,
  visibleRows,
  windowStart,
  type ActionListGeometry,
  type ActionRow,
} from "./render/actions";
import {
  bakeIcons,
  cogHitbox,
  drawCellMark,
  drawCog,
  drawSettingsPanel,
  settingsHitboxes,
  settingsPanel,
  type Icons,
} from "./render/marks";
import { drawRightPanel, panelX, sliderGeometry, statusRowAt, stopToY, yToStop } from "./render/right";
import { drawTrail, playerScreenPos, trailPoints, type TrailPoint } from "./render/trail";
import { Screen, ACTIONS_W, CELL, FLOOR, PANEL_PAD, PANEL_W, visibleTiles, type Layout, type ScreenSettings } from "./render/screen";
import { drawText, fontFrom, type AtlasFontRef } from "./render/atlas";
import { textWidth } from "./imagefont";
import { PerfHarness, type PerfReport } from "./perf";

export interface ScrubberSettings extends ScreenSettings {
  perf: boolean;
}

/** What clicking the hovered cell would do. */
type HoverKind = "action" | "invalid" | "none";

interface Hover {
  cell: Waypoint;
  kind: HoverKind;
}

interface Fonts {
  standard: AtlasFontRef;
  digits: AtlasFontRef;
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
  private icons!: Icons;
  private dirty = true;
  private raf = 0;
  private settings: ScrubberSettings;
  private settingsOpen = false;
  private hover: Hover | null = null;
  private hoverRow: number | null = null;
  /** Rebuilt when the stop, the document or the hover changes — never per frame. */
  private rows: ActionRow[] = [];
  private pending: ActionSummary | null = null;
  /**
   * The first action the list shows.
   *
   * `[D]` **An anchor, not a function of the current action.** Centring on every
   * seek meant clicking a row scrolled the list out from under the pointer. It
   * moves only when the current action would leave the window, or when the
   * wheel moves it.
   */
  private rowFirst = 0;
  /** The drawn row the pending slot sits above; frozen while dragging. */
  private gapAbove = 0;
  private draggingList = false;
  /**
   * `[D]` Every listener this object registers is registered with this
   * controller's signal, so `destroy` drops all of them in one call and cannot
   * miss one. `keydown` and `resize` are on `window`, which outlives the
   * canvas: left behind, they hold the whole `FloorCache` alive and keep
   * seeking a scrubber nobody can see. StrictMode double-invokes effects, so
   * there were two from the first mount. D40.
   */
  private readonly input = new AbortController();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly manifest: AtlasManifest,
    private readonly sheet: CanvasImageSource,
    settings: ScrubberSettings,
    private readonly onSettings: (s: ScrubberSettings) => void,
    /**
     * Called when the chrome has something to re-read — an edit, an undo. Never
     * on a scrub, which is the point: React must not re-render at frame rate.
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
    this.icons = bakeIcons(this.manifest, this.sheet);
    this.stop = session.view.stop;
    this.scroll = 0;
    this.scrollTarget = 0;
    this.publishPanelWidth();
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
    this.rebuildRows();
    this.dirty = true;
  }

  update(settings: ScrubberSettings): void {
    this.settings = settings;
    this.screen.update(settings);
    if (!settings.perf) this.perfHarness.reset();
    this.dirty = true;
  }

  /**
   * `[D]` Scrubbing **ends the current run of insertions** (SPEC-008 §5): undo
   * reaches back over the run the player is making and no further.
   */
  seek(stop: number): void {
    const next = Math.max(0, Math.min(this.stops.length - 1, stop));
    if (next === this.stop) return;
    this.stop = next;
    const t0 = performance.now();
    const changed = this.cursor.seekTo(this.stops[next]!);
    this.floors.invalidate(this.cursor.cells, changed);
    this.perfHarness.record({ seek: performance.now() - t0, blit: 0 });
    this.session.view = { ...this.session.view, stop: next };
    this.session.endRun();
    this.rebuildRows();
    this.dirty = true;
  }

  // --- the action list ----------------------------------------------------

  private listGeometry(): ActionListGeometry {
    return actionsGeometry(this.screen.layout, sliderGeometry(this.screen.layout));
  }

  /**
   * The window of rows the list shows, with the hover preview spliced in.
   *
   * `[D]` Built on change, not per frame: each row reads the journal either
   * side of its action, and doing that sixty times a second would put the
   * classification on the frame path for no gain — nothing in it moves unless
   * the stop, the document or the hover does.
   */
  private rebuildRows(): void {
    const g = this.listGeometry();
    const total = this.session.sites.length;
    const capacity = visibleRows(g);

    // The window follows the current action only when it would otherwise leave.
    if (this.stop < this.rowFirst || this.stop >= this.rowFirst + capacity) {
      this.rowFirst = windowStart(this.stop, total, capacity);
    }
    this.rowFirst = Math.max(0, Math.min(Math.max(0, total - capacity), this.rowFirst));

    const rows: ActionRow[] = [];
    for (let i = this.rowFirst; i < total && rows.length < capacity; i++) {
      const site = this.session.sites[i]!;
      const summary = this.session.summarise(this.cursor, i);
      if (summary === null) continue;
      rows.push({
        number: i + 1,
        summary,
        enabled: site.action.disabled !== true,
        inserted: this.session.badgeOf(site.action) === "inserted",
        current: i === this.stop,
      });
    }
    this.rows = rows;
    this.pending = this.hover?.kind === "action" ? this.previewSummary() : null;
    if (!this.draggingList) this.gapAbove = this.stop - this.rowFirst;
  }

  /** The wheel scrolls the list; nothing else does. */
  private scrollList(rows: number): void {
    const capacity = visibleRows(this.listGeometry());
    const total = this.session.sites.length;
    const next = Math.max(0, Math.min(Math.max(0, total - capacity), this.rowFirst + rows));
    if (next === this.rowFirst) return;
    this.rowFirst = next;
    this.rebuildRows();
    this.dirty = true;
  }

  /** What the hovered cell would become, described exactly as a real row is. */
  private previewSummary(): ActionSummary | null {
    const target = this.hover?.cell;
    if (!target) return null;
    const t = simulate(
      { tower: this.session.tower, gemsOwned: this.session.route.gemsOwned, route: [target] },
      { player: this.cursor.player, cells: this.cursor.cells, kills: this.cursor.kills },
    );
    const last = t.steps.at(-1);
    if (last === undefined) return null;
    return describeAction(this.session.tower, this.cursor.cells, t.initial, last.player, target);
  }

  // --- editing ------------------------------------------------------------

  /** Every document-tier change lands here: re-derive, re-seek, tell React once. */
  private commit(stop = this.stop): void {
    this.stop = stop;
    this.rebuild();
    this.onDocument();
  }

  undo(): void {
    if (!this.session.canUndo) return;
    this.session.undo();
    this.commit(Math.max(0, this.stop - 1));
  }

  redo(): void {
    if (!this.session.canRedo) return;
    this.session.redo();
    this.commit(this.stop + 1);
  }

  /**
   * `[F]` SAVE_FORMAT §3: an interaction is recorded **iff** it changes state.
   * So the same question decides whether a click is an action — and the
   * simulator answers it, rather than a list of entity types here that would
   * have to be kept in step with the rules.
   */
  private classify(target: Waypoint): HoverKind {
    const t = simulate(
      { tower: this.session.tower, gemsOwned: this.session.route.gemsOwned, route: [target] },
      { player: this.cursor.player, cells: this.cursor.cells, kills: this.cursor.kills },
    );
    if (t.error !== undefined) return "invalid";
    const last = t.steps.at(-1);
    if (last === undefined) return "none";
    if (t.steps.some((s) => s.edits.length > 0)) return "action";
    const a = t.initial;
    const b = last.player;
    const changed =
      a.power !== b.power || a.gold !== b.gold || a.lightKeys !== b.lightKeys || a.darkKeys !== b.darkKeys ||
      a.pickaxes !== b.pickaxes || a.gemsSpent !== b.gemsSpent || a.held !== b.held || a.win !== b.win;
    return changed ? "action" : "none";
  }

  /** `[I]` Inserting is a click on a floor cell, landing after the current action. */
  private insertAt(target: Waypoint): void {
    const site = this.session.sites[this.stop];
    const epoch = site?.epoch ?? 0;
    const segment = site?.segment ?? this.session.route.epochs[epoch]!.active;
    const index = site ? site.index + 1 : activeSegment(this.session.route.epochs[epoch]!).actions.length;
    const p = this.cursor.player;
    this.session.edit({
      op: "insert",
      epoch,
      segment,
      index,
      action: { from: { z: p.z, x: p.x, y: p.y }, to: target },
    });
    this.hover = null;
    this.commit(this.stop + 1);
  }

  private toggleRow(i: number): void {
    const row = this.rows[i];
    if (!row || row.pending === true) return;
    const site = this.session.sites[row.number - 1];
    if (!site) return;
    this.session.edit({
      op: "setDisabled",
      epoch: site.epoch,
      segment: site.segment,
      index: site.index,
      value: site.action.disabled !== true,
    });
    this.commit();
  }

  // --- drawing ------------------------------------------------------------

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

  /** Tear down for good: stop the loop and drop every listener with it. */
  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.input.abort();
  }

  resize(): void {
    this.screen.resize();
    this.publishPanelWidth();
    this.rebuildRows();
    this.dirty = true;
  }

  /**
   * How wide the right panel is in CSS pixels, for the toolbar to stop at.
   *
   * `[D]` The canvas is the only thing that knows the current integer scale, so
   * it is what tells the chrome. A custom property rather than React state:
   * this changes on resize, which is not a document change and must not
   * re-render anything.
   */
  private publishPanelWidth(): void {
    const l = this.screen.layout;
    const css = Math.round(((PANEL_W + PANEL_PAD * 2) * l.cssW) / l.w);
    this.canvas.parentElement?.style.setProperty("--right-panel", `${css}px`);
  }

  private draw(): void {
    const t0 = performance.now();
    const { ctx, layout } = this.screen;
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
    const fonts: Fonts = { standard: fontFrom(this.manifest, "FONT_STANDARD"), digits: fontFrom(this.manifest, "FONT_DIGITS") };
    const failedFrom = this.session.failedFrom;

    drawTimeline(ctx, this.floors, this.manifest, this.sheet, tower, unit, currentSlot, this.scroll, layout, PANEL_W);
    drawTrail(ctx, this.points, this.visits, unit, this.stop, this.scroll, layout);
    this.drawHover(unit);
    this.drawPlayer(unit);
    this.drawCurrentAction(unit, fonts);
    drawCog(ctx, this.icons, layout, PANEL_W, this.settingsOpen);

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
      perf: this.settings.perf,
      perfLine: this.perfHarness.line,
    }, layout);

    drawActionList(ctx, this.sheet, this.manifest, fonts, this.listGeometry(), this.rows, this.gapAbove, this.pending, this.icons, this.hoverRow);
    this.drawFailureMarker(layout);

    // Last of all, so nothing covers it: it is a thing the player has opened.
    if (this.settingsOpen) {
      drawSettingsPanel(ctx, this.icons, this.sheet, fonts.standard, layout, PANEL_W, this.toggles());
    }

    this.screen.present();
    this.perfHarness.record({ seek: 0, blit: performance.now() - t0 });
    this.dirty = this.settings.perf || this.scroll !== this.scrollTarget;
  }

  /** `[I]` The failing action gets the no-entry sign on the track, and clicks through. */
  private drawFailureMarker(layout: Layout): void {
    const at = this.session.failedFrom;
    if (at === null || this.icons.noEntry === null) return;
    const b = this.failureHitbox(layout, at);
    this.screen.ctx.drawImage(this.icons.noEntry, b.x, b.y);
  }

  private toggles(): Array<{ label: string; on: boolean }> {
    return [{ label: "perf test", on: this.settings.perf }];
  }

  private failureHitbox(layout: Layout, at: number): { x: number; y: number; w: number; h: number } {
    const g = sliderGeometry(layout);
    return { x: g.x, y: Math.round(stopToY(at, this.stops.length, g)) - 8, w: 16, h: 16 };
  }

  /**
   * `[I]` The current action, drawn twice: its cell outlined on the floor, and
   * its row repeated **at the right of that floor's name strip** — a fixed
   * place, never over squares the player may want to click. A line runs from
   * the summary to the player, so the two are read as one thing. A disabled
   * action is ghosted throughout.
   */
  private drawCurrentAction(unit: ScrollUnit, fonts: Fonts): void {
    const { ctx } = this.screen;
    const site = this.session.sites[this.stop];
    const row = this.rows.find((r) => r.number === this.stop + 1);
    if (!site || !row) return;
    const slot = unit.floors.indexOf(site.action.to.z);
    if (slot < 0) return;
    const tile = tileOrigin(slot, this.scroll, this.screen.layout);
    if (tile.x + FLOOR < 0 || tile.x > this.screen.layout.w) return;

    ctx.globalAlpha = site.live ? 1 : 0.45;
    const cardX = tile.x + FLOOR - ACTIONS_W;
    const cardY = tile.y + FLOOR + 1;

    // The line first, so the card and the player both sit on top of it.
    const player = playerScreenPos(this.points, this.visits, unit, this.stop, this.scroll, this.screen.layout);
    if (player) {
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cardX + ACTIONS_W / 2, cardY);
      ctx.lineTo(player.x + CELL / 2, player.y + CELL + 2);
      ctx.stroke();
      ctx.strokeStyle = "#cfc4ff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawActionCard(ctx, this.sheet, this.manifest, fonts, row, cardX, cardY, this.icons);
    ctx.globalAlpha = 1;
  }

  private drawHover(unit: ScrollUnit): void {
    if (this.hover === null || this.hover.kind === "none") return;
    const pos = this.cellOrigin(unit, this.hover.cell);
    if (!pos) return;
    drawCellMark(this.screen.ctx, this.icons, this.hover.kind === "action" ? "inserted" : "invalid", pos.x, pos.y);
  }

  /** Where a cell of a floor is on screen, or null when its floor is not shown. */
  private cellOrigin(unit: ScrollUnit, w: Waypoint): { x: number; y: number } | null {
    const slot = unit.floors.indexOf(w.z);
    if (slot < 0) return null;
    const o = tileOrigin(slot, this.scroll, this.screen.layout);
    if (o.x + FLOOR < 0 || o.x > this.screen.layout.w) return null;
    return { x: o.x + (w.x - 1) * CELL, y: o.y + (w.y - 1) * CELL };
  }

  private drawPlayer(unit: ScrollUnit): void {
    const { ctx, layout } = this.screen;
    const pos = playerScreenPos(this.points, this.visits, unit, this.stop, this.scroll, layout);
    if (!pos) return;
    // `[I]` The lavender ring was still hard to find among fifteen white
    // sprites, so it is bedded on black: two pixels of dark either side is what
    // separates it from whatever the floor happens to be under it.
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(pos.x - 2, pos.y - 2, CELL + 4, CELL + 4);
    ctx.strokeRect(pos.x, pos.y, CELL, CELL);
    ctx.strokeStyle = "#cfc4ff";
    ctx.lineWidth = 2;
    ctx.strokeRect(pos.x - 1, pos.y - 1, CELL + 2, CELL + 2);
    const sprite = this.playerSprite();
    if (sprite) ctx.drawImage(sprite, pos.x, pos.y);
    const digits = fontFrom(this.manifest, "FONT_DIGITS");
    const p = this.cursor.player.power;
    const label = p > 1e9 ? `${Math.floor(p / 1e9)}G` : p > 1e6 ? `${Math.floor(p / 1e6)}M` : p > 1e3 ? `${Math.floor(p / 1e3)}k` : String(p);
    drawText(ctx, this.sheet, digits, label, pos.x + CELL - 1 - textWidth(digits, label), pos.y + 11);
  }

  /**
   * `[F]` The game tints the player `(0.5, 1, 1)` under its `player_tint`
   * setting (leveldata.lua:281-284) and draws everything else white — D26's
   * "monochrome apart from the player".
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
    const unit = this.currentUnit();
    for (const [slot, z] of unit.floors.entries()) {
      const o = tileOrigin(slot, this.scroll, this.screen.layout);
      if (x < o.x || x >= o.x + FLOOR || y < o.y || y >= o.y + FLOOR) continue;
      return { z, x: Math.floor((x - o.x) / CELL) + 1, y: Math.floor((y - o.y) / CELL) + 1 };
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
    const inBox = (p: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
      p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    const stopFromY = (clientY: number): number =>
      yToStop(logical(0, clientY).y, this.stops.length, sliderGeometry(this.screen.layout));
    let draggingSlider = false;

    const onDown = (e: PointerEvent): void => {
      const p = logical(e.clientX, e.clientY);
      const layout = this.screen.layout;

      if (inBox(p, cogHitbox(layout, PANEL_W))) {
        this.settingsOpen = !this.settingsOpen;
        this.dirty = true;
        return;
      }
      // `[I]` While the settings panel is open, a click anywhere off it closes
      // it **and does nothing else** -- dismissing a panel should never also
      // scrub, or insert an action under it.
      if (this.settingsOpen) {
        const toggles = this.toggles();
        for (const [i, b] of settingsHitboxes(layout, PANEL_W, toggles.length).entries()) {
          if (!inBox(p, b)) continue;
          if (i === 0) this.onSettings({ ...this.settings, perf: !this.settings.perf });
          return;
        }
        if (!inBox(p, settingsPanel(layout, PANEL_W, toggles.length))) {
          this.settingsOpen = false;
          this.dirty = true;
        }
        return;
      }
      // The failing action, clickable on the track for inspection.
      const failed = this.session.failedFrom;
      if (failed !== null && inBox(p, this.failureHitbox(layout, failed))) {
        this.seek(failed);
        return;
      }
      const g = this.listGeometry();
      const i = rowAt(g, this.rows.length, this.gapAbove, p.x, p.y);
      if (i !== null) {
        if (inBox(p, checkboxAt(g, i, this.gapAbove))) {
          this.toggleRow(i);
          return;
        }
        // `[I]` Dragging down the list keeps moving the selection: a finer
        // scrub than the slider gives. The pending slot is held where it was
        // until the button comes up, so rows do not slide under the pointer.
        this.draggingList = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.seek(this.rows[i]!.number - 1);
        return;
      }
      const cell = this.cellAt(p.x, p.y);
      if (cell !== null) {
        if (this.classify(cell) === "action") this.insertAt(cell);
        return;
      }
      if (p.x >= panelX(layout) - 2 && p.x <= panelX(layout) + 14) {
        draggingSlider = true;
        this.canvas.setPointerCapture(e.pointerId);
        this.seek(stopFromY(e.clientY));
      }
    };

    const onMove = (e: PointerEvent): void => {
      if (draggingSlider) {
        this.seek(stopFromY(e.clientY));
        return;
      }
      const p = logical(e.clientX, e.clientY);
      const g = this.listGeometry();
      const row = rowAt(g, this.rows.length, this.gapAbove, p.x, p.y);
      if (this.draggingList) {
        if (row !== null) this.seek(this.rows[row]!.number - 1);
        return;
      }
      if (row !== this.hoverRow) {
        this.hoverRow = row;
        this.dirty = true;
      }
      // `[I]` The status column has no room for words, so they are on hover.
      const status = statusRowAt(this.session.tower, this.cursor.player, this.screen.layout, p.x, p.y);
      this.canvas.title = status?.title ?? "";
      this.setHover(row === null ? this.cellAt(p.x, p.y) : null);
    };

    this.canvas.addEventListener("pointerdown", onDown, { signal });
    this.canvas.addEventListener("pointermove", onMove, { signal });
    this.canvas.addEventListener("pointerleave", () => {
      this.hoverRow = null;
      this.setHover(null);
      this.dirty = true;
    }, { signal });
    this.canvas.addEventListener("pointerup", (e) => {
      draggingSlider = false;
      if (this.draggingList) {
        this.draggingList = false;
        // The slot catches up now that nothing is being dragged over it.
        this.rebuildRows();
        this.dirty = true;
      }
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    }, { signal });
    this.canvas.addEventListener("wheel", (e) => {
      const p = logical(e.clientX, e.clientY);
      const g = this.listGeometry();
      if (p.x < g.x || p.x > g.x + g.w) return;
      e.preventDefault();
      // Up is back in time, matching the list's own direction.
      this.scrollList(e.deltaY > 0 ? -1 : 1);
    }, { signal, passive: false });

    window.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowRight") this.seek(this.stop + step);
      else if (e.key === "ArrowLeft") this.seek(this.stop - step);
      else if (e.key === "Home") this.seek(0);
      else if (e.key === "End") this.seek(this.stops.length - 1);
      // `[I]` Z and Y single-step the insertions, mirroring the game's own undo
      // and redo, because a slider cannot pick one step out of thousands.
      else if (e.key === "z" || e.key === "Z") this.undo();
      else if (e.key === "y" || e.key === "Y") this.redo();
      else if (e.key === "+" || e.key === "=") this.setZoom(this.screen.layout.scale + 1);
      else if (e.key === "-" || e.key === "_") this.setZoom(this.screen.layout.scale - 1);
      else if (e.key === "0") this.onSettings({ ...this.settings, zoom: "auto" });
      else if (e.key === "s" || e.key === "S") this.saveCapture();
      else return;
      e.preventDefault();
    }, { signal });
    window.addEventListener("resize", () => this.resize(), { signal });
  }

  /** Hovering a cell is what previews an insertion, so it rebuilds the list. */
  private setHover(cell: Waypoint | null): void {
    const same =
      (cell === null && this.hover === null) ||
      (cell !== null && this.hover !== null &&
        cell.z === this.hover.cell.z && cell.x === this.hover.cell.x && cell.y === this.hover.cell.y);
    if (same) return;
    this.hover = cell === null ? null : { cell, kind: this.classify(cell) };
    this.rebuildRows();
    this.dirty = true;
  }
}
