// SPEC-007 §1 + SPEC-008 §8 — the canvas half of the app.
//
// `[D]` One canvas. React owns the chrome — empty state, file input, record
// list, save and export — and nothing inside the canvas; React must not
// re-render on scrub. That is why all scrub state lives here, in a plain class,
// and the only thing React does after mounting is hand this object a session
// and let go. An *edit* is the exception: it changes the document, so it calls
// back once, at the speed of a click.

import { Cursor } from "../sim/cursor";
import { coords } from "../sim/grid";
import { activeSegment } from "../sim/route/document";
import { describeAction, type ActionSummary } from "../sim/route/describe";
import { simulate } from "../sim/simulate";
import type { Timeline, Waypoint } from "../sim/types";
import type { AtlasManifest } from "../../tools/atlas/build";
import type { RouteSession } from "./session";
import { FloorCache } from "./render/floor";
import {
  computeVisits,
  computeWorkingSets,
  drawTimeline,
  gridCapacity,
  gridFor,
  slotOfVisit,
  tileOrigin,
  workingSetOfVisit,
  type Grid,
  type Visit,
  type WorkingSet,
} from "./render/left";
import {
  CARD_W,
  ROW_H,
  accentOf,
  actionsGeometry,
  dashOf,
  checkboxAt,
  clampPinY,
  defaultPinY,
  drawActionCard,
  drawActionList,
  offsetAt,
  offsetOfY,
  rowTop,
  slotCount,
  type ActionListGeometry,
  type ActionRow,
} from "./render/actions";
import {
  bakeIcons,
  cogHitbox,
  drawCellMark,
  drawHelpButton,
  drawSettingsPanel,
  settingsHitboxes,
  settingsPanel,
  settingsWidth,
  type Icons,
} from "./render/marks";
import { drawRightPanel, failureMarkBox, panelX, sliderGeometry, statusRowAt, stopToY, yToStop } from "./render/right";
import { drawTrail, playerScreenPos, trailPoints, type TrailPoint } from "./render/trail";
import { Screen, CELL, FLOOR, PANEL_PAD, PANEL_W, type Layout, type ScreenSettings } from "./render/screen";
import { drawText, fontFrom, keyOf, spriteFor, type AtlasFontRef } from "./render/atlas";
import * as C from "./render/palette";
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
  private sets: WorkingSet[] = [];
  private setCapacity = 0;
  private points: TrailPoint[] = [];
  private stops: number[] = [];
  private ticks: number[] = [];
  private stop = 0;
  private tintedPlayer: HTMLCanvasElement | null = null;
  private icons!: Icons;
  private dirty = true;
  private raf = 0;
  private settings: ScrubberSettings;
  private settingsOpen = false;
  private hover: Hover | null = null;
  /** Where the pointer last was, in logical pixels; null when it is off the canvas. */
  private pointer: { x: number; y: number } | null = null;
  /** Rebuilt when the stop, the document or the hover changes — never per frame. */
  private rows: ActionRow[] = [];
  private pending: ActionSummary | null = null;
  /**
   * Where the **current** action's row sits, in pixels.
   *
   * `[D]` The list moves under it rather than it moving in the list, so
   * scrubbing never makes the list saw back and forth. A click sets it to
   * exactly where the clicked row already was, so that row does not move at
   * all and the others shift around it.
   */
  private pinY = -1;

  /**
   * Which row the pointer is over.
   *
   * `[F]` **Derived, never stored.** It was cached as an offset from the pin —
   * and a click moves the pin, so the cached number went on naming a row that
   * far from the *new* one: the highlight jumped by exactly the distance
   * clicked, away from the row that had just been selected. An offset only
   * means anything beside the pin it was measured from, so the pointer is what
   * is kept and the offset is worked out where it is wanted. Two call sites
   * would each have had to remember to re-read it; none has to now.
   */
  private get hoverRow(): number | null {
    return this.pointer === null
      ? null
      : offsetAt(this.listGeometry(), this.pinY, this.pointer.x, this.pointer.y);
  }
  private draggingList = false;
  /** Where the drag began, so the selection follows the pointer one-for-one. */
  private dragFrom = { y: 0, stop: 0 };
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
    this.publishPanelWidth();
    this.rebuild();
    this.start();
  }

  /** Everything derived from the evaluation, rebuilt after a load or an edit. */
  private rebuild(): void {
    this.timeline = this.session.evaluation.mainline;
    this.cursor = new Cursor(this.timeline);
    this.stops = this.session.stops;
    this.visits = computeVisits(this.session.positions);
    this.points = trailPoints(this.session.positions, this.visits);
    this.ticks = this.stops
      .map((_, i) => i)
      .filter((i) => i > 0 && this.points[i]!.visit !== this.points[i - 1]!.visit);
    this.sets = [];
    this.setCapacity = 0;
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
    if (this.pinY < 0) this.pinY = defaultPinY(g);
    this.pinY = clampPinY(g, this.pinY);
    const failedFrom = this.session.failedFrom;
    const span = slotCount(g) + 2;

    const rows: ActionRow[] = [];
    for (let offset = -span; offset <= span; offset++) {
      const top = rowTop(this.pinY, offset);
      if (top + ROW_H <= g.y || top >= g.y + g.h) continue;
      const i = this.stop + offset;
      const site = this.session.sites[i];
      if (site === undefined) continue;
      const summary = this.session.summarise(this.cursor, i);
      if (summary === null) continue;
      rows.push({
        offset,
        number: i + 1,
        summary,
        enabled: site.action.disabled !== true,
        inserted: this.session.isInserted(site.action),
        current: offset === 0,
        failed: failedFrom !== null && i >= failedFrom,
        breaks: failedFrom === i,
      });
    }
    this.rows = rows;
    this.pending = this.hover?.kind === "action" ? this.previewSummary() : null;
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

  private toggleRow(row: ActionRow): void {
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

  /**
   * The working sets, recomputed when the window changes how many floors fit
   * and cached in between.
   */
  private workingSets(layout: Layout): WorkingSet[] {
    const cap = gridCapacity(layout, PANEL_W);
    if (this.setCapacity !== cap || this.sets.length === 0) {
      this.sets = computeWorkingSets(this.visits, cap);
      this.setCapacity = cap;
    }
    return this.sets;
  }

  /** A PNG of the logical canvas at 1x — §7's capture control. */
  capture(): string {
    this.draw();
    return this.screen.buffer.toDataURL("image/png");
  }

  /**
   * SPEC-009 §3 — what the visual harness reads back, and all it reads back.
   *
   * `[D]` `harnessState` is the app state a pointer target needs and `Layout`
   * cannot give: the list's pin, the slider's divisions, and how many floors
   * the panel is showing. `run.ts` computes the pixel itself, from these and
   * the same pure functions the app drew with, so a wrong hitbox shows up as a
   * shot pointing at the wrong thing rather than as agreement with itself.
   */
  get stopIndex(): number {
    return this.stop;
  }

  get layout(): Layout {
    return this.screen.layout;
  }

  get harnessState(): { pinY: number; stopCount: number; failedFrom: number | null; floorsShown: number } {
    return {
      pinY: this.pinY,
      stopCount: this.stops.length,
      failedFrom: this.session.failedFrom,
      floorsShown: this.currentSet().floors.length,
    };
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
    const sets = this.workingSets(layout);
    const set = sets[workingSetOfVisit(sets, visit)]!;
    const currentSlot = slotOfVisit(set, this.visits, visit);
    const grid = gridFor(layout, PANEL_W, set.floors.length);

    ctx.fillStyle = "#0c0c10";
    ctx.fillRect(0, 0, layout.w, layout.h);

    const tower = this.timeline.tower;
    const fonts: Fonts = { standard: fontFrom(this.manifest, "FONT_STANDARD"), digits: fontFrom(this.manifest, "FONT_DIGITS") };
    const failedFrom = this.session.failedFrom;

    drawTimeline(ctx, this.floors, this.manifest, this.sheet, tower, set, currentSlot, grid, layout, PANEL_W, this.accent());
    drawTrail(ctx, this.points, this.visits, set, this.stop, grid, layout);
    this.drawHover(set, grid);
    this.drawCurrentAction(set, grid, fonts);
    drawHelpButton(ctx, this.sheet, fonts.standard, layout, PANEL_W, this.settingsOpen);

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

    drawActionList(ctx, this.sheet, this.manifest, fonts, this.listGeometry(), this.rows, this.pinY, this.pending, this.icons, this.hoverRow);
    this.drawFailureMarker(layout);

    // Last of all, so nothing covers it: it is a thing the player has opened.
    if (this.settingsOpen) {
      drawSettingsPanel(ctx, this.icons, this.sheet, fonts.standard, layout, PANEL_W, this.toggles(), this.keys);
    }

    this.screen.present();
    this.perfHarness.record({ seek: 0, blit: performance.now() - t0 });
    // `[F]` Nothing animates any more: the panel jumps from one working set to
    // the next, so a frame is drawn only when something has actually changed.
    this.dirty = this.settings.perf;
  }

  /**
   * `[I]` The failing action is marked on the track, and clicks through to it.
   *
   * `[F]` **The exclamation, not the no-entry sign.** The two say different
   * things — no entry is the rules refusing a move, which is what a hovered
   * cell wears — and the slider is 16 px wide, where the no-entry sign's
   * diagonal fill has nowhere to read as a diagonal and went to a blob. Two
   * strokes survive being small. Both are the game's own art (markers.png), so
   * neither is a shape the player has to be taught.
   */
  private drawFailureMarker(layout: Layout): void {
    const at = this.session.failedFrom;
    if (at === null) return;
    const icon = this.overFailureMark ? this.icons.exclaimHot : this.icons.exclaim;
    if (icon === null) return;
    const b = this.failureHitbox(layout, at);
    this.screen.ctx.drawImage(icon, b.x, b.y);
  }

  /** Whether the pointer is on the break mark, which is a control as well as a mark. */
  private get overFailureMark(): boolean {
    const at = this.session?.failedFrom;
    if (at === null || at === undefined || this.pointer === null) return false;
    const b = this.failureHitbox(this.screen.layout, at);
    const p = this.pointer;
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  private toggles(): Array<{ label: string; on: boolean }> {
    return [{ label: "perf test", on: this.settings.perf }];
  }

  /**
   * `[F]` The help panel sizes itself to its widest line, so the two hitbox
   * calls have to ask for the same width the draw call works out — otherwise a
   * click lands where the panel used to end.
   */
  private settingsW(): number {
    return settingsWidth(fontFrom(this.manifest, "FONT_STANDARD"), this.toggles(), this.keys, this.icons.boxSize);
  }

  /** `[I]` The keys moved off the bottom strip and in here, where help lives. */
  private readonly keys = [
    "click a cell   insert after here",
    "click a row    go to that action",
    "drag a row     scrub",
    "wheel          step",
    "left / right   step",
    "Z / Y          undo / redo an add",
    "+ / - / 0      zoom",
    "S              screenshot",
  ];

  /** The break mark's box; `failureMarkBox` holds the reasoning and the numbers. */
  private failureHitbox(layout: Layout, at: number): { x: number; y: number; w: number; h: number } {
    return failureMarkBox(layout, at, this.stops.length);
  }

  /** The one colour every mark of the current action wears: `accentOf`. */
  private accent(): string {
    // The last stop is a position with no row: it is past the break or not.
    const failed = this.session.failedFrom;
    const row = this.rows.find((r) => r.current) ??
      { breaks: false, failed: failed !== null && this.stop >= failed, inserted: false, enabled: true };
    return accentOf(row);
  }

  /**
   * The current action, drawn as an action rather than as a position.
   *
   * `[I]` **The player stands where it acts *from*.** Drawn on the target it
   * covered the very thing the action was about — a Gold Gate the player could
   * not afford showed as a player standing on empty floor, with nothing to say
   * what had been attempted. From the approach square, the affected tile is
   * visible, an arrow says which way the action goes, and the target itself is
   * knocked askew where it succeeded or wears the no-entry sign where it did
   * not.
   */
  private drawCurrentAction(set: WorkingSet, grid: Grid, fonts: Fonts): void {
    const { ctx } = this.screen;
    const site = this.session.sites[this.stop];
    const row = this.rows.find((r) => r.current);
    const accent = this.accent();
    if (!site || !row) {
      // The last stop is a position, not an action: just the player.
      const at = playerScreenPos(this.points, this.visits, set, this.stop, grid, this.screen.layout);
      if (at) this.drawPlayer(at, accent, null);
      return;
    }

    const from = this.cellOrigin(set, grid, this.approachOf(this.stop) ?? site.action.from);
    const to = this.cellOrigin(set, grid, site.action.to);
    const slot = set.floors.indexOf(site.action.to.z);
    if (slot < 0) return;
    const tile = tileOrigin(grid, slot);
    if (tile.x + FLOOR < 0 || tile.x > this.screen.layout.w) return;

    ctx.globalAlpha = site.live ? 1 : 0.45;
    // Every accent mark of a switched-off action is dashed, as its row is.
    ctx.setLineDash(dashOf(row));
    // `[F]` The target is framed **only** where the box over both squares will
    // not reach it — which is when the player is on a floor this working set
    // does not show. Drawn always, its rect ran down the middle of that box and
    // read as a divider splitting one mark into two.
    if (to) this.drawTarget(row, to, accent, from === null);

    const cardX = tile.x + FLOOR - CARD_W;
    const cardY = tile.y + FLOOR + 1;
    const at = from ?? playerScreenPos(this.points, this.visits, set, this.stop, grid, this.screen.layout);
    if (at) {
      // The line first, so the card and the player both sit on top of it.
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cardX + CARD_W / 2, cardY);
      ctx.lineTo(at.x + CELL / 2, at.y + CELL + 2);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      this.drawPlayer(at, accent, from !== null && to !== null ? to : null);
    }
    ctx.setLineDash([]);
    drawActionCard(ctx, this.sheet, this.manifest, fonts, row, cardX, cardY, this.icons, accent);
    ctx.globalAlpha = 1;
  }

  /**
   * Where the player stands **immediately before** this action: the square the
   * auto-pather walks them to, adjacent to the target.
   *
   * `[F]` Not `action.from`. That is what was recorded when the action was
   * made — where the player stood after the *previous* action — and for an
   * inserted action the two are usually different squares and often different
   * floors: the pather covers the distance between them and the box was drawn
   * around the start of that walk rather than its end. The journal has the
   * answer already, in the `from` of the action's own step.
   *
   * `[F]` A stop whose step does not end on this action's target is not this
   * action's step: a disabled action, or one past the break, holds its
   * predecessor's step index (`stopModel`). Checking the target rather than
   * re-deriving which case it is keeps the guard true for all of them.
   */
  private approachOf(stop: number): Waypoint | null {
    const step = this.stops[stop];
    const site = this.session.sites[stop];
    if (site === undefined || step === undefined || step < 1) return null;
    const s = this.timeline.steps[step - 1];
    if (s === undefined) return null;
    const to = coords(s.to);
    const t = site.action.to;
    if (to.z !== t.z || to.x !== t.x || to.y !== t.y) return null;
    return coords(s.from);
  }

  /**
   * The cell the action is made on, redrawn over the floor.
   *
   * `[I]` Shrunk and turned, as if the player had knocked it away — the floor
   * bitmap already shows the square after the action, so without this there is
   * nothing there to see. A failing action leaves it square and whole: it has
   * not been knocked anywhere. `[F]` The no-entry sign used to go over it and
   * has been taken out — it hid the very thing the player needed to look at,
   * and the red frame and the deficit in the row already say what it said.
   */
  private drawTarget(row: ActionRow, at: { x: number; y: number }, accent: string, frame: boolean): void {
    const { ctx } = this.screen;
    const stem = row.summary.kind === "noop" ? null : spriteFor(keyOf(row.summary.cell), this.manifest);
    const r = stem === null ? undefined : this.manifest.sprites[stem] ?? this.manifest.sprites[this.manifest.entities[stem]?.[0] ?? ""];

    if (frame) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(at.x + 0.5, at.y + 0.5, CELL - 1, CELL - 1);
    }
    if (!r) return;

    if (row.summary.error !== undefined) {
      ctx.drawImage(this.sheet, r.x, r.y, r.w, r.h, at.x, at.y, CELL, CELL);
      return;
    }
    ctx.save();
    ctx.translate(at.x + CELL / 2, at.y + CELL / 2);
    ctx.rotate(0.22);
    ctx.scale(0.78, 0.78);
    ctx.drawImage(this.sheet, r.x, r.y, r.w, r.h, -CELL / 2, -CELL / 2, CELL, CELL);
    ctx.restore();
  }

  private drawHover(set: WorkingSet, grid: Grid): void {
    if (this.hover === null || this.hover.kind === "none") return;
    const pos = this.cellOrigin(set, grid, this.hover.cell);
    if (!pos) return;
    drawCellMark(this.screen.ctx, this.icons, this.hover.kind === "action" ? "inserted" : "invalid", pos.x, pos.y);
  }

  /** Where a cell of a floor is on screen, or null when its floor is not shown. */
  private cellOrigin(set: WorkingSet, grid: Grid, w: Waypoint): { x: number; y: number } | null {
    const slot = set.floors.indexOf(w.z);
    if (slot < 0) return null;
    const o = tileOrigin(grid, slot);
    if (o.x + FLOOR < 0 || o.x > this.screen.layout.w) return null;
    return { x: o.x + (w.x - 1) * CELL, y: o.y + (w.y - 1) * CELL };
  }

  /**
   * `[I]` **One box around both squares**, rather than a box on the player
   * and an arrow to the target. The arrow said which way the action went and
   * hid too much of the floor saying it; a box that covers the square the
   * player stands on and the square they act on says the same thing and covers
   * only its own outline.
   */
  private drawPlayer(pos: { x: number; y: number }, accent: string, target: { x: number; y: number } | null): void {
    const { ctx } = this.screen;
    const x = Math.min(pos.x, target?.x ?? pos.x);
    const y = Math.min(pos.y, target?.y ?? pos.y);
    const w = Math.max(pos.x, target?.x ?? pos.x) + CELL - x;
    const h = Math.max(pos.y, target?.y ?? pos.y) + CELL - y;
    // The ring is bedded on black: two pixels of dark either side is what
    // separates it from whatever the floor happens to be under it.
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
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

  /** The working set currently on screen. */
  private currentSet(): WorkingSet {
    const sets = this.workingSets(this.screen.layout);
    return sets[workingSetOfVisit(sets, this.points[this.stop]?.visit ?? 0)]!;
  }

  /** Which cell of which floor a logical point lands on, or null for none. */
  private cellAt(x: number, y: number): Waypoint | null {
    const set = this.currentSet();
    const grid = gridFor(this.screen.layout, PANEL_W, set.floors.length);
    for (const [slot, z] of set.floors.entries()) {
      const o = tileOrigin(grid, slot);
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
      // A press is a position too: on a touch there may have been no move.
      this.pointer = p;
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
        const w = this.settingsW();
        for (const [i, b] of settingsHitboxes(layout, PANEL_W, toggles.length, w).entries()) {
          if (!inBox(p, b)) continue;
          if (i === 0) this.onSettings({ ...this.settings, perf: !this.settings.perf });
          return;
        }
        if (!inBox(p, settingsPanel(layout, PANEL_W, toggles.length, this.keys.length, w))) {
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
      const offset = offsetAt(g, this.pinY, p.x, p.y);
      if (offset !== null) {
        const row = this.rows.find((r) => r.offset === offset);
        if (row === undefined) return;
        if (inBox(p, checkboxAt(g, this.pinY, offset))) {
          this.toggleRow(row);
          return;
        }
        // `[I]` The clicked row must not move, so the pin goes to exactly where
        // that row already is and everything else shifts around it. From there
        // the drag keeps **the current action under the cursor**: the rows hold
        // still and the highlight follows the pointer, so the row you are
        // aiming at is the row you land on.
        this.pinY = clampPinY(g, rowTop(this.pinY, offset));
        this.draggingList = true;
        this.dragFrom = { y: this.pinY, stop: row.number - 1 };
        this.canvas.setPointerCapture(e.pointerId);
        this.seek(row.number - 1);
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
      const was = this.hoverRow;
      const wasOnMark = this.overFailureMark;
      this.pointer = p;
      if (this.hoverRow !== was || this.overFailureMark !== wasOnMark) this.dirty = true;
      if (this.draggingList) {
        // The rows stay where they were when the drag began; the current action
        // becomes whichever of them the cursor is over, and the pin moves with
        // it so the highlight is under the pointer rather than beside it.
        const g0 = this.listGeometry();
        const steps = offsetOfY(this.dragFrom.y, p.y);
        this.pinY = clampPinY(g0, this.dragFrom.y - steps * ROW_H);
        this.seek(this.dragFrom.stop + steps);
        return;
      }
      const offset = this.hoverRow;
      // `[I]` The status line has no room for words, so they are on hover.
      const status = statusRowAt(this.session.tower, this.cursor.player, this.screen.layout, p.x, p.y);
      this.canvas.title = status?.title ?? "";
      this.setHover(offset === null ? this.cellAt(p.x, p.y) : null);
    };

    this.canvas.addEventListener("pointerdown", onDown, { signal });
    this.canvas.addEventListener("pointermove", onMove, { signal });
    this.canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.setHover(null);
      this.dirty = true;
    }, { signal });
    this.canvas.addEventListener("pointerup", (e) => {
      draggingSlider = false;
      this.draggingList = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    }, { signal });
    // `[I]` The wheel moves the selection wherever the pointer is, not only
    // over the list: scroll to the right moment with the pointer over a floor
    // tile, then click that tile to insert there.
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.seek(this.stop + (e.deltaY > 0 ? -1 : 1));
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
