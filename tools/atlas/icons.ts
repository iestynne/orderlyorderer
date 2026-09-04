// The app's own icons — the ones the game has no art for.
//
// `[D]` **Pixel maps, packed into the atlas beside the game's sprites.** They
// were drawn with `arc()` and `cos/sin` at first, which is how you get a `+`
// whose arms differ by a pixel and a cog that leans: the renderer is built on
// whole-pixel drawing (SPEC-007 §4.1) and those were the one place breaking it.
// Written out as characters they are symmetric by construction, diffable, and
// editable without a paint program — and packing them into `atlas.png` means
// they can be inspected the same way every other sprite is.
//
// `#` is ink and `o` is outline. Ink is packed **white** so the app can tint it
// at draw time, as it does the player and the no-entry sign; the outline is
// packed black, which a multiply tint leaves alone.

export const ICONS: Readonly<Record<string, readonly string[]>> = {
  /**
   * An added action.
   *
   * `[F]` **Opaque inside, not hollow.** The disc used to be a tinted ring with
   * a tinted plus and nothing but transparency between them, so the row outline
   * underneath showed through the badge and read as a smear across the glyph.
   * The gaps are black now: outline black, which a multiply tint leaves alone,
   * so the badge is a solid disc at any tint.
   */
  icon_plus: [
    "..ooooo..",
    ".oo###oo.",
    "o##ooo##o",
    "o#oo#oo#o",
    "o#o###o#o",
    "o#oo#oo#o",
    "o##ooo##o",
    ".oo###oo.",
    "..ooooo..",
  ],
  /** The enable box, and its tick, drawn one over the other. */
  icon_box: [
    "#########",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#.......#",
    "#########",
  ],
  icon_tick: [
    ".........",
    ".........",
    ".......#.",
    "......##.",
    ".#...##..",
    ".##.##...",
    "..###....",
    "...#.....",
    ".........",
  ],
  /**
   * No way through. `[I]` A reachability failure expends nothing, so the slot
   * that would name the item names the problem instead.
   */
  icon_arrow: [
    ".....#.....",
    "....##.....",
    "...###.....",
    "..####.....",
    ".##########",
    "##########.",
    ".##########",
    "..####.....",
    "...###.....",
    "....##.....",
    ".....#.....",
  ],
  /**
   * Settings. `[P]` A placeholder, for iestyn to replace with game-congruent art.
   *
   * `[F]` The first one was a ring with a square hole, which at this size read
   * as a minus sign rather than as a cog. It needs teeth that clear the body on
   * all four sides and a hole small enough to be a hole.
   */
  icon_cog: [
    ".....###.....",
    ".....###.....",
    "..#########..",
    "..#########..",
    "#############",
    "#####...#####",
    "#####...#####",
    "#####...#####",
    "#############",
    "..#########..",
    "..#########..",
    ".....###.....",
    ".....###.....",
  ],
};

/** Every icon is square, and the map is what says how big it is. */
export function iconSize(name: string): number {
  return ICONS[name]?.length ?? 0;
}
