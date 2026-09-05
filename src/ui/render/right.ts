// SPEC-007 §5 + docs/UI.md §4 — the control panel: scrub slider, tower stack,
// player status, settings.
//
// The panel holds a fixed shape at any window size while the left panel takes
// the rest. It is headed, as the game is, with the tower name over the floor
// name.

import type { Player, TowerJSON } from "../../sim/types";
import type { AtlasManifest } from "../../../tools/atlas/build";
import { drawText, fontFrom, type AtlasFontRef } from "./atlas";
import * as C from "./palette";
import { textWidth } from "../imagefont";
import type { FloorCache } from "./floor";
import { ACTIONS_W, PANEL_HEAD, PANEL_PAD, PANEL_W, SLIDER_W, STACK_W, type Layout } from "./screen";

/** `[F]` util.lua:3-22. Dot separators every three digits; never an abbreviation. */
export function powerToString(n: number): string {
  let v = Math.floor(n);
  let out = "";
  while (v > 999) {
    const seg = v % 1000;
    v = (v - seg) / 1000;
    out = `.${String(seg).padStart(3, "0")}${out}`;
  }
  return `${v}${out}`;
}

// The tower stack. Being iterated on by eye (D24a).
//
// `[D]` Three rounds of enlarging it, and the cause was the same every time: a
// miniature of a 15x15 grid needs pixels before it needs anything else. The box
// filter in `FloorCache.mini` stopped it shimmering; these numbers are what stop
// it being too small to read. `[F]` A box filter is correct at any ratio, so
// none of them has to be a clean fraction.
/**
 * `[D]` **A 2:1 shear, not 1:1** — one pixel of horizontal offset per *two*
 * rows of vertical drop, where SPEC-007 §5's original projection used one per
 * row.
 *
 * That is what lets the floors be twice as tall for nothing: the horizontal
 * footprint is set by the total shear, so halving the shear rate pays for
 * doubling the height. The sides now rake at about 27° rather than 45°, which
 * is a shallower, more map-like view of a floor.
 */
export const STACK_SHEAR = 2;
export const STACK_FLOOR_H = 64;
/** `[D]` Floors may overlap, so at most this much clear air between them. */
const STACK_MAX_GAP = 2;
/** Thick enough to read as a boundary where floors overlap. */
export const STACK_BORDER = 2;

/**
 * `[F]` **Derived, not chosen.** The shear pushes the top row of a floor
 * `ceil((h - 1) / STACK_SHEAR)` px to the right, so a floor plus its own shear
 * is the real width of the stack. Picking the width by eye and the height
 * separately silently cropped every floor's right-hand edge against the clip
 * box, so the width comes out of the budget instead, and is asserted in test.
 *
 * `[F]` **The outline is part of the width.** It is stroked ON the floor's edge
 * and so reaches `STACK_BORDER / 2` outside it at each side — which put the left
 * one under the action list, drawn afterwards, and cost every floor two pixels
 * of its own boundary. A whole border at each end buys the outline its room and
 * leaves the drawn stack inside the column it was given.
 */
export const STACK_FLOOR_W = STACK_W - STACK_BORDER * 2 - Math.ceil((STACK_FLOOR_H - 1) / STACK_SHEAR);

/**
 * How far apart consecutive floors sit, so the whole tower fits without
 * scrolling.
 *
 * `[D]` The stack no longer scrolls at all. A tower is a fixed, knowable shape
 * and the point of drawing it is to see that shape whole; scrolling to find a
 * floor defeats it. So the pitch is whatever makes the tower fit, and on a tall
 * tower that is less than a floor's height — the floors overlap, each showing
 * a band of itself, which is why they need a 2 px border to stay separable.
 *
 * `[D]` Capped so a short tower does not sprawl: at most `STACK_MAX_GAP` of
 * clear air between floors, with the whole stack centred in the panel.
 */
export function stackPitch(depth: number, availH: number): number {
  if (depth <= 1) return 0;
  const room = availH - STACK_FLOOR_H;
  return Math.max(1, Math.min(STACK_FLOOR_H + STACK_MAX_GAP, Math.floor(room / (depth - 1))));
}

export function stackHeight(depth: number, availH: number): number {
  return (depth - 1) * stackPitch(depth, availH) + STACK_FLOOR_H;
}

export interface StatusRow {
  /** The sprite naming the row, drawn at the column's right edge. */
  sprite: string;
  /** The value, right-aligned to the left of the sprite. Empty for the held row. */
  value: string;
  /** What the row means, for the hover tooltip: the words the column has no room for. */
  title: string;
}

/**
 * The status line: everything but Power, which leads on its own line.
 *
 * `[F]` Conditional rows, matching the game: dark keys are hidden under
 * negative_keys (the counter is meaningless on EX-3), gold appears only under
 * the money_system flag, and the held item only when something is held.
 *
 * `[D]` Every row is a sprite and a number, with no word anywhere. Gems are an
 * amount **spent** — the total moves as gems come in on other towers, so spent
 * is what a route is planned against — and that is now said in the row's hover
 * text rather than in a label the column has no width for.
 */
export function statusRows(tower: TowerJSON, p: Player): StatusRow[] {
  const flags = tower.metadata.computed_flags;
  const rows: StatusRow[] = [{ sprite: "key", value: String(p.lightKeys), title: "light keys" }];
  if (flags.negative_keys !== true) rows.push({ sprite: "dark_key", value: String(p.darkKeys), title: "dark keys" });
  rows.push({ sprite: "pickaxe", value: String(p.pickaxes), title: "pickaxes" });
  if (flags.money_system === true) rows.push({ sprite: "money", value: String(p.gold), title: "gold" });
  rows.push({ sprite: "gem", value: String(p.gemsSpent), title: "gems spent" });
  if (p.held !== null) rows.push({ sprite: p.held, value: "", title: `held: ${p.held}` });
  return rows;
}

export interface RightPanelState {
  tower: TowerJSON;
  player: Player;
  floorName: string;
  stop: number;
  stopCount: number;
  /** Stop indices where the route changes floor, for the slider's ticks. */
  ticks: number[];
  currentFloor: number;
  /** The first stop the route fails at, or null where it runs clean. */
  failedFrom: number | null;
  perf: boolean;
  perfLine: string;
}

/**
 * A status row names an **entity type**; the atlas is keyed by **sprite file
 * stem**, and the two are not always the same word.
 *
 * `[F]` Most held items happen to match — `shield`, `feather`, `master_key` —
 * which is why looking up the type directly appeared to work. The Vorpal Blade
 * is `vorpal` as a type and `vorpal_sword.png` as a sprite, so its icon silently
 * failed to draw. `entitydef.lua` is the authority on that mapping and the atlas
 * manifest already carries it, so go through it rather than trusting the name.
 */
export function spriteRect(manifest: AtlasManifest, name: string): { x: number; y: number; w: number; h: number } | undefined {
  return manifest.sprites[name] ?? manifest.sprites[manifest.entities[name]?.[0] ?? ""];
}

export function panelX(layout: Layout): number {
  return layout.w - PANEL_W - PANEL_PAD;
}

/** Left edge of the tower stack: past the slider, the action list, and the
 * border's own width, which is drawn outside this edge. */
export function stackX(layout: Layout): number {
  return panelX(layout) + SLIDER_W + ACTIONS_W + STACK_BORDER;
}



/**
 * The columns all start below the header and run to the foot of the panel.
 *
 * `[D]` The 78 px that used to be reserved at the bottom was the settings
 * block, which now lives behind the cog (docs/UI.md §4), so the slider, the
 * action list and the stack each get it back.
 */
export function sliderGeometry(layout: Layout): { x: number; y: number; h: number } {
  return { x: panelX(layout), y: PANEL_HEAD, h: Math.max(40, layout.h - PANEL_HEAD - 8) };
}

export function drawRightPanel(
  ctx: CanvasRenderingContext2D,
  manifest: AtlasManifest,
  sheet: CanvasImageSource,
  floors: FloorCache,
  s: RightPanelState,
  layout: Layout,
): void {
  const x0 = panelX(layout);
  const standard = fontFrom(manifest, "FONT_STANDARD");
  const digits = fontFrom(manifest, "FONT_DIGITS");

  ctx.fillStyle = C.PANEL;
  ctx.fillRect(x0 - PANEL_PAD, 0, PANEL_W + PANEL_PAD * 2, layout.h);

  // Two lines of header. `[I]` The word Power stays, to the right of the
  // number: a bare figure that large needs saying what it is.
  drawText(ctx, sheet, standard, s.tower.metadata.name, x0, 5);
  const power = `${powerToString(s.player.power)} Power`;
  drawText(ctx, sheet, standard, power, x0 + PANEL_W - textWidth(standard, power), 5);

  // ...and under it the action counter, which is short and fixed, opposite
  // everything the player is carrying. The floor name is not here: the stack
  // labels the current floor and every tile in the strip is captioned.
  //
  // `[F]` **Drawn once.** The slider drew it a second time three pixels lower,
  // from before it moved up here, and two copies of a changing number three
  // pixels apart read as one number that will not hold still.
  drawText(ctx, sheet, standard, `${s.stop + 1}/${s.stopCount}`, x0, 17);
  drawStatus(ctx, sheet, manifest, digits, s, layout);

  // `[I]` A line under the header, with air either side, so the two lines read
  // as a heading rather than as the top of the slider.
  ctx.fillStyle = C.DIVIDER;
  ctx.fillRect(x0, PANEL_HEAD - 4, PANEL_W, 1);

  drawSlider(ctx, s, layout);
  drawStack(ctx, floors, standard, sheet, s, layout);
}

/**
 * The status line sits immediately below Power.
 *
 * `[D]` The line has no room for words, so the words are on hover. The canvas
 * cannot carry per-region tooltips itself, so the host element's `title` is set
 * from `statusRowAt` — one attribute, moved as the pointer moves.
 */
export const STATUS_Y = 14;

/** Widest an item gets: a 16 px sprite, a gap, and four digits. */
export const STATUS_ITEM_W = 44;

/** Which status item a point is over, for the hover tooltip, or null. */
export function statusRowAt(tower: TowerJSON, player: Player, layout: Layout, x: number, y: number): StatusRow | null {
  if (y < STATUS_Y || y > STATUS_Y + 16) return null;
  const rows = statusRows(tower, player);
  // Hit-testing has no font to measure with, and the items are near enough
  // evenly spaced that the block divided by their count is the right answer.
  const i = rows.length - 1 - Math.floor((panelX(layout) + PANEL_W - x) / STATUS_ITEM_W);
  return i >= 0 && i < rows.length ? rows[i]! : null;
}
/**
 * `[D]` **Time runs upward: stop 0 is at the bottom.** The route is climbing a
 * tower, and the tower stack beside it already puts floor 1 at the bottom — a
 * slider running the other way made scrubbing back feel like going up.
 */
export function stopToY(stop: number, stopCount: number, g: { y: number; h: number }): number {
  const t = stopCount <= 1 ? 0 : stop / (stopCount - 1);
  return g.y + (1 - t) * (g.h - 1);
}

export function yToStop(y: number, stopCount: number, g: { y: number; h: number }): number {
  const t = 1 - (y - g.y) / Math.max(1, g.h - 1);
  return Math.round(t * (stopCount - 1));
}

function drawSlider(
  ctx: CanvasRenderingContext2D,
  s: RightPanelState,
  layout: Layout,
): void {
  const g = sliderGeometry(layout);
  const mid = g.x + SLIDER_W / 2;
  ctx.fillStyle = C.TRACK;
  ctx.fillRect(mid - 2, g.y, 4, g.h);

  // `[I]` **The track is the verdict, and it starts green.** A save the game
  // wrote replays clean, so the whole track is green the moment it loads; the
  // suffix turns red only once an edit has broken something. The trail says
  // tense instead (docs/UI.md §3) -- one of the two has to, and the track is
  // the one that pictures the whole route at once.
  const split = s.failedFrom === null ? g.y : Math.round(stopToY(s.failedFrom, s.stopCount, g));
  ctx.fillStyle = C.PASS;
  ctx.fillRect(mid - 2, split, 4, g.y + g.h - split);
  if (s.failedFrom !== null) {
    ctx.fillStyle = C.FAIL;
    ctx.fillRect(mid - 2, g.y, 4, Math.max(1, split - g.y));
  }

  // Ticks on the track mark where the route changes floor.
  ctx.fillStyle = C.DIVIDER;
  for (const t of s.ticks) ctx.fillRect(g.x + 2, Math.round(stopToY(t, s.stopCount, g)), SLIDER_W - 4, 1);

  // `[D]` The nub is an hourglass on its side, crossing the track at its waist:
  // a plain bar was too small to aim at, and a bigger bar would have hidden the
  // tick it sits on. The waist keeps the exact position visible while the flared
  // ends give it something to grab.
  const cy = Math.round(stopToY(s.stop, s.stopCount, g));
  const half = SLIDER_W / 2;
  ctx.fillStyle = C.LAVENDER;
  ctx.beginPath();
  ctx.moveTo(mid - half, cy - NUB_HALF_H);
  ctx.lineTo(mid + half, cy - NUB_HALF_H);
  ctx.lineTo(mid + 1, cy);
  ctx.lineTo(mid + half, cy + NUB_HALF_H);
  ctx.lineTo(mid - half, cy + NUB_HALF_H);
  ctx.lineTo(mid - 1, cy);
  ctx.closePath();
  ctx.fill();
}

/** Half the height of the hourglass nub's flared end. */
export const NUB_HALF_H = 5;

/**
 * docs/UI.md §4 — the whole tower as a vertical stack, each floor squashed
 * vertically with its sides raked over at 45 degrees, reusing the same floor
 * images as the timeline panel so the two always agree.
 *
 * `[F]` §5: the shear is pixel-exact, one pixel of horizontal offset per row of
 * vertical drop, and no resampling happens along it. Only the vertical squash
 * resamples, which is why it is done a source row at a time.
 */
function drawStack(
  ctx: CanvasRenderingContext2D,
  floors: FloorCache,
  font: AtlasFontRef,
  sheet: CanvasImageSource,
  s: RightPanelState,
  layout: Layout,
): void {
  const g = sliderGeometry(layout);
  const x0 = stackX(layout);
  ctx.save();
  ctx.beginPath();
  // `[F]` The clip has to allow for the outline, which is drawn ON the floor's
  // edge and so reaches half its width outside it. Clipped to the floors alone
  // it cut the left and right sides of every outline off.
  ctx.rect(x0 - STACK_BORDER, g.y, STACK_W + STACK_BORDER * 2, g.h);
  ctx.clip();

  // Floor 1 at the bottom, as the tower is numbered (D1). The whole tower is
  // laid out to fit the panel and centred in it, so nothing scrolls and no
  // floor is ever off-screen.
  const pitch = stackPitch(floors.depth, g.h);
  const total = stackHeight(floors.depth, g.h);
  const base = Math.round(g.y + (g.h + total) / 2);

  // `[D]` **Every floor is drawn identically.** The current one used to be
  // taller, which made the whole stack shift as you scrubbed — every floor
  // above it moved by the difference. Being drawn last and wearing the lavender
  // outline is enough to find it, and a stack that holds still is worth more
  // than one that emphasises: the floors are about to become hoverable, and a
  // target that moves when you approach it is the wrong kind of interface.
  const h = STACK_FLOOR_H;
  // `[F]` The shear is what makes the horizontal footprint, so its rate and the
  // floor height trade off exactly: at 2:1 a floor twice as tall costs no more
  // width. `x` is a whole pixel per row, so nothing resamples along it -- only
  // the vertical squash does, and that is pre-filtered into `mini`. The shear
  // is pre-applied there too, so a floor is one blit rather than 64 (D39).
  const shear = (r: number): number => Math.floor((h - 1 - r) / STACK_SHEAR);

  const drawFloor = (z: number): void => {
    const current = z === s.currentFloor;
    const top = base - (z - 1) * pitch - h;
    if (top + h < g.y || top > g.y + g.h) return;

    // `[I]` Every floor but the current one is knocked back towards grey, which
    // is what lets the black outline separate them and stops a tall tower
    // reading as one field of noise. `knockBack` says why it is baked into the
    // miniature rather than washed over it here.
    ctx.drawImage(floors.mini(z, STACK_FLOOR_W, h, shear, !current), x0, top);

    // Outline every floor, following the shear. Floors overlap on a tall tower,
    // so this is the only thing separating one from the next.
    ctx.strokeStyle = current ? C.LAVENDER : "#000";
    ctx.lineWidth = STACK_BORDER;
    const half = STACK_BORDER / 2;
    ctx.beginPath();
    ctx.moveTo(x0 + shear(0) - half, top - half);
    ctx.lineTo(x0 + shear(0) + STACK_FLOOR_W + half, top - half);
    ctx.lineTo(x0 + shear(h - 1) + STACK_FLOOR_W + half, top + h + half);
    ctx.lineTo(x0 + shear(h - 1) - half, top + h + half);
    ctx.closePath();
    ctx.stroke();

    if (current) {
      // The current floor is the only one labelled; the rest name themselves on
      // hover, because a tall tower has nowhere near room for every name. On its
      // own dark plate, since with the floors overlapping there is no clear air
      // to put it in.
      const w = textWidth(font, s.floorName);
      ctx.fillStyle = C.PANEL;
      ctx.fillRect(x0 + shear(0) - 2, top - 12, w + 4, 11);
      drawText(ctx, sheet, font, s.floorName, x0 + shear(0), top - 10);
    }
  };

  // Low floors first, so a higher floor overlaps the one below it -- then the
  // current floor again, last, so nothing above can bury the one being read.
  for (let z = 1; z <= floors.depth; z++) if (z !== s.currentFloor) drawFloor(z);
  if (s.currentFloor >= 1 && s.currentFloor <= floors.depth) drawFloor(s.currentFloor);
  ctx.restore();
}

/**
 * Everything but Power, on one line under it.
 *
 * `[D]` **The held item's slot is reserved and leftmost**, so picking one up or
 * spending it moves nothing else. An item that appears and disappears in the
 * middle of a line drags every value after it sideways, and these are numbers
 * the player reads by position.
 */
function drawStatus(
  ctx: CanvasRenderingContext2D,
  sheet: CanvasImageSource,
  manifest: AtlasManifest,
  digits: AtlasFontRef,
  s: RightPanelState,
  layout: Layout,
): void {
  const rows = statusRows(s.tower, s.player);
  let x = panelX(layout) + PANEL_W - rows.length * STATUS_ITEM_W;
  for (const row of rows) {
    const r = spriteRect(manifest, row.sprite);
    if (r) ctx.drawImage(sheet, r.x, r.y, r.w, r.h, x, STATUS_Y, 16, 16);
    if (row.value !== "") drawText(ctx, sheet, digits, row.value, x + 18, STATUS_Y + 5);
    x += STATUS_ITEM_W;
  }
}

// The settings block is gone from the panel: its two checkboxes live behind
// the cog at the top-right of the left panel now (docs/UI.md §4), which is what
// gave the slider, the action list and the stack their bottom 78 px back.
