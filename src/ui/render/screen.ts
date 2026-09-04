// SPEC-007 §4.1 and §5 — the logical canvas, the integer upscale, and every
// layout constant in logical pixels at 1x.
//
// `[F]` The game renders to 426x248 with nearest filtering throughout and
// scales by min(w/426, h/248), floored to an integer only under the
// pixel_perfect setting (main.lua:17, 203-232). We mirror both settings, but
// the app's logical size is its own: it grows with the window so that more
// floors fit, in steps rather than sliding, because the scale is an integer.

export const CELL = 16;
export const FLOOR = 240; // 15 x 15 cells
export const CAPTION = 18;
export const GAP = 4;
export const BORDER = 1;

/**
 * `[F]` **Value labels do not sit inside their cell**, and getting this wrong
 * is what made a 100-power serpent read as `1001`.
 *
 * `leveldata.lua:271` prints them with
 * `printf(value_str, x*16-11, y*16-1, 16, "right")` — right-aligned in a 16 px
 * box that starts 1 px inside the cell. So the text ENDS at cell + 17, and the
 * last glyph's ink can reach cell + 18. Vertically it starts 11 px down a
 * 16 px cell in a 7 px font, ending at cell + 18 there too.
 *
 * A label therefore overhangs its cell by up to 2 px right and 2 px down and is
 * drawn over whatever is beneath. That is why labels are baked and blitted
 * separately from tiles: every tile first, then every label on top. Trying to
 * carry the label inside a tile bitmap makes correctness depend on paint order,
 * which is fragile in exactly the way it proved to be.
 */
export const LABEL_W = 18;
export const LABEL_H = 7;
/** Right edge of the label box, relative to the cell's left edge. */
export const LABEL_RIGHT = 17;
/** Top of the label, relative to the cell's top edge. */
export const LABEL_Y = 11;

/**
 * `[F]` The panel used to lay tiles half a tile-width apart in two rows — a
 * bricklayer pattern, so that a sliding strip could never put two consecutive
 * visits in the same horizontal range. Nothing slides now: the panel shows one
 * working set at a time and reading order says which tile is later, so the
 * stagger is gone and the floors sit on a plain grid.
 */
/** `[D]` Lowered from 4 on 2026-08-31 so a 1080p window reaches 2x. UI.md §6. */
export const MIN_TILES = 3;

export const SLIDER_W = 16;
/**
 * The action list.
 *
 * `[F]` Exactly what a row needs and no more: four digits of number, a slot for
 * the item carried, one for what was acted on, one for gold, then the add badge
 * and the enable box hard right. It was 128 while the toggles floated at the
 * right edge with thirty pixels of nothing before them.
 */
export const ACTIONS_W = 104;
export const STACK_W = 232;
/**
 * `[F]` **The status column is gone.** Power leads on its own line across the
 * top — it is the only figure that needs width, reaching eleven digits observed
 * and fifteen characters at the cap — and every other value is at most four
 * digits, measured over the whole corpus: gold peaks at 3 343, gems at 230,
 * keys and pickaxes at two. They fit on one line under it, which lets the stack
 * run to the panel's right edge and takes 76 px off the panel.
 */
export const PANEL_W = SLIDER_W + ACTIONS_W + STACK_W; // 348
export const PANEL_PAD = 6;
/** Two lines of header at the top of the panel, which the columns start below. */
export const PANEL_HEAD = 33;

/**
 * A tile is its floor plus its name strip.
 *
 * `[D]` **The strip is not optional.** It used to be, and turning it off gave
 * its height back to the floors — but it is where the current action's summary
 * is drawn now (docs/UI.md §6), and the alternative was drawing that over the
 * grid, on squares the player may want to click.
 */
export function tileHeight(): number {
  return FLOOR + CAPTION;
}

export function rowPitch(): number {
  return tileHeight() + GAP;
}

/** The smallest logical viewport the §5 minimum fits in. */
export function minLogical(): { w: number; h: number } {
  return {
    w: PANEL_W + PANEL_PAD * 2 + MIN_TILES * FLOOR + (MIN_TILES + 1) * GAP,
    h: rowPitch() + tileHeight() + GAP,
  };
}

export interface ScreenSettings {
  /** `[F]` The game's pixel_perfect: floor the scale to an integer. */
  pixelPerfect: boolean;
  /** `[F]` The game's linear_filter: choose the upscale filter. */
  linearFilter: boolean;
  /** `[D]` "auto" is the largest scale that fits; a number overrides it. */
  zoom: number | "auto";
}

export interface Layout {
  scale: number;
  /** Logical size, in the units every §5 constant is written in. */
  w: number;
  h: number;
  /** Backing-store size, in device pixels. */
  deviceW: number;
  deviceH: number;
  /** CSS size the canvas element must be given, so one backing pixel is one device pixel. */
  cssW: number;
  cssH: number;
  /** The largest scale that would fit, whatever the zoom override says. */
  fitScale: number;
}

/**
 * `[D]` The layout rule is the largest integer scale at which the §5 minimum
 * still fits, so the visible floor count jumps in steps rather than sliding.
 *
 * `[F]` **`dpr` belongs here and did not use to.** The canvas backing store was
 * sized in device pixels and then stretched by CSS to fill its element, which
 * put a fractional scale underneath the integer one — the "wonky, definitely
 * not an integer multiple" look. The element now gets an explicit CSS size, so
 * a logical pixel is exactly `scale` device pixels and nothing resamples.
 */
export function layoutFor(cssWidth: number, cssHeight: number, s: ScreenSettings, dpr = 1): Layout {
  const min = minLogical();
  const availW = cssWidth * dpr;
  const availH = cssHeight * dpr;
  const raw = Math.min(availW / min.w, availH / min.h);
  const fitScale = Math.max(1, Math.floor(raw));
  const scale = s.zoom === "auto" ? (s.pixelPerfect ? fitScale : Math.max(1, raw)) : Math.max(1, s.zoom);
  const w = Math.max(min.w, Math.floor(availW / scale));
  const h = Math.max(min.h, Math.floor(availH / scale));
  const deviceW = Math.floor(w * scale);
  const deviceH = Math.floor(h * scale);
  return { scale, w, h, deviceW, deviceH, cssW: deviceW / dpr, cssH: deviceH / dpr, fitScale };
}



/**
 * An offscreen 1x canvas plus the blit that puts it on screen. Everything the
 * app draws goes through here, so "no smoothing, whole-number scaling" is one
 * decision in one place rather than a rule to remember at every draw call.
 */
export class Screen {
  readonly buffer: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  layout: Layout;

  constructor(
    private readonly visible: HTMLCanvasElement,
    private settings: ScreenSettings,
  ) {
    this.buffer = document.createElement("canvas");
    const ctx = this.buffer.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.layout = layoutFor(1, 1, settings, 1);
    this.resize();
  }

  update(settings: ScreenSettings): void {
    this.settings = settings;
    this.resize();
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    // `[F]` Measure the HOST, never the canvas — and collapse the canvas first.
    //
    // Two feedback loops live here, both of which shipped. Measuring the canvas
    // is one: this method sets the canvas's own CSS size, so zooming in grew the
    // element, the next measurement read that larger element, and the available
    // space ratcheted up and never came back.
    //
    // Measuring the host while an oversized canvas is still inside it is the
    // other: the host scrolls, so its `clientWidth` is short by the width of the
    // scrollbars our own last layout caused. Zooming from 2x to 1x then laid out
    // against a viewport ~15 px too small, leaving a gap down the right and
    // bottom — and pressing the key again "fixed" it, because by then the
    // scrollbars had gone. Collapsing the canvas to nothing before reading makes
    // the host report its true size every time, with no second pass to get right.
    const host = this.visible.parentElement;
    this.visible.style.width = "0px";
    this.visible.style.height = "0px";
    const cssW = host?.clientWidth || window.innerWidth;
    const cssH = host?.clientHeight || window.innerHeight;
    this.layout = layoutFor(Math.max(1, cssW), Math.max(1, cssH), this.settings, dpr);

    this.buffer.width = this.layout.w;
    this.buffer.height = this.layout.h;
    this.visible.width = this.layout.deviceW;
    this.visible.height = this.layout.deviceH;
    this.visible.style.width = `${this.layout.cssW}px`;
    this.visible.style.height = `${this.layout.cssH}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Blit the 1x buffer up. Smoothing follows the game's linear_filter setting. */
  present(): void {
    const ctx = this.visible.getContext("2d", { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = this.settings.linearFilter;
    ctx.drawImage(this.buffer, 0, 0, this.layout.w, this.layout.h, 0, 0, this.layout.deviceW, this.layout.deviceH);
  }
}
