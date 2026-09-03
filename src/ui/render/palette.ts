// Every colour the app chooses, in one place.
//
// `[D]` **Gathered here so a variant is a swap, not a search.** The app is
// monochrome apart from the player (D26); everything below belongs to things
// the game does not draw, and the pass/fail pair is red against green — which
// is the one pair that fails for red-green colour blindness, around 8% of men.
//
// `[D]` **A hue swap alone is not the fix, and this file is not the whole
// answer.** Where a state is *only* a colour, no palette rescues it; where it
// carries a second signal — a shape, a thickness, a position, a badge — the
// palette can be anything. So the marks that say "this failed" are deliberately
// not colour alone: the failing row is outlined *thicker*, the deficit is a
// *number*, an action past the failure is drawn in *grey* rather than in a
// second hue, and the slider's break carries the no-entry *sign*. What is left
// for a variant to fix is the pairs that are still only colour.
//
// `[O]` The variants themselves are not built. Swapping `FAIL`/`PASS` for blue
// and orange — distinguishable under both deuteranopia and protanopia — is a
// two-line change here once iestyn has said which he wants.

/** The app's own accent: the current thing, whatever it is. */
export const LAVENDER = "#cfc4ff";
/** An action that would happen but cannot, because something earlier broke. */
export const GREY = "#8a8a99";

/** The route gets this far. */
export const PASS = "#5aa85a";
/** ...and no further. */
export const FAIL = "#a85a5a";
/** The failing action itself, which has to be findable at a glance. */
export const FAIL_BRIGHT = "#ff5a5a";
/** The game's own no-entry sign, tinted. */
export const REFUSED = "rgb(190, 40, 40)";
/** An unticked enable box, filled so it reads as off rather than as blank. */
export const DISABLED_FILL = "#7a3030";
/** A deficit badge: the number you are short. */
export const SHORTFALL = "#e04040";

/** An added action. */
export const ADDED = "#8fe08f";

// --- surfaces -------------------------------------------------------------

export const GROUND = "#0c0c10";
export const PANEL = "#15151a";
export const LINE = "#3a3a44";
/** The divider under the panel's header. */
export const DIVIDER = "#55556a";
export const INK = "#e8e6f2";
export const DIM = "#9a97ad";
export const TRACK = "#2a2a33";

/** Alternating bands behind the action list, a shade either side of the panel. */
export const BAND = ["#191920", "#131318"] as const;
/** The same alternation, shifted towards the failure colour. */
export const BAND_FAILED = ["#241b1b", "#1d1616"] as const;
export const BAND_HOVER = "#2a2a36";

/**
 * The route trail: two lavenders separated only by hue, the past towards blue
 * and the future towards red.
 *
 * `[O]` `D_HUE` is not settled; expected to be adjusted by eye (UI.md §3).
 */
export const TRAIL_HUE = 262;
export const D_HUE = 26;

export function trailColour(past: boolean, fade: number): string {
  return `hsla(${TRAIL_HUE + (past ? -D_HUE : D_HUE)}, 62%, ${past ? 72 : 66}%, ${fade.toFixed(3)})`;
}
