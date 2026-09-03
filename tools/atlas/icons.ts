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
  /** An added action. */
  icon_plus: [
    "..ooooo..",
    ".oo###oo.",
    "o##...##o",
    "o#..#..#o",
    "o#.###.#o",
    "o#..#..#o",
    "o##...##o",
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
  /** Settings. `[P]` A placeholder, for iestyn to replace with game-congruent art. */
  icon_cog: [
    "...#####...",
    "...#####...",
    ".#########.",
    ".#########.",
    "###.....###",
    "###.....###",
    "###.....###",
    ".#########.",
    ".#########.",
    "...#####...",
    "...#####...",
  ],
};

/** Every icon is square, and the map is what says how big it is. */
export function iconSize(name: string): number {
  return ICONS[name]?.length ?? 0;
}
