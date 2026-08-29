# NOTES: Full map extraction — DEFERRED

> **This is not a spec. Do not implement any of it.**
> It is a research record so the work already done is not lost if the need ever
> returns. The active spec is `SPEC_MAP_DIFF.md`, which covers final-state
> diffing only and deliberately requires none of what follows.

Status: deferred 2026-08-29. Game source: `v0.7455`.

---

## 1. Why this is deferred

`EXTRACTION.md` opens with "Map exports are the **only** source of a tower's
initial state — the savegame contains none." `[F]` **That premise is now
obsolete.** The game's level data files are available and are being converted
to JSON directly: `LevelData.new(file)` (`leveldata.lua:47+`) reads a plain
text file carrying, per floor, the 15×15 wall grid, every entity with its type
and value, and the tutorial textboxes — plus tower metadata (name,
`crowns_needed`, `start_power`, `start_floor/x/y`, flags, and the six `grades`
score thresholds).

So tower initial state comes from the level files, exactly and losslessly.
Recovering it from pixels would be a strictly worse path to the same data, and
would require building all of the following for no benefit:

- a sprite → entity table
- badge OCR from the bitmap font
- tutorial-overlay detection
- negative-enemy sprite synthesis
- palette normalisation for tinted exports

`[I]` iestyn's call: not needed now, and the CLI should not write this code.

---

## 2. Corrections to EXTRACTION.md

Worth recording even while deferred, because `EXTRACTION.md` remains the
reference for the measured geometry and badge analysis and these errors would
mislead anyone returning to it.

### 2.1 Exports ARE tinted

`EXTRACTION.md` does not consider tinting. `[F]` Measured: a 1-5 export under
the red palette is red throughout, floor-name text included. The shader
(`the_shader.lua`, a 5-entry palette remap plus brightness/contrast) is bound
as global state that persists between frames, so it is still active when
`dump_image` runs from a menu action; `renderTo` on a fresh canvas does not
escape it.

`[F]` Ten palettes are literal constants at `settings.lua:13`. **Palette 7 is
exactly inverted**, so any luminance-ordering normalisation is invalid.

`[F]` Tinting can lose information: the red 1-5 export has 11 distinct colours
where the same tower has 12 untinted.

### 2.2 Panel index does not reliably give the floor number

`[F]` `dump_image` iterates `game.unlocks.maps[tower]` and includes only floors
the player has ever visited, in any run. So `save_floor = panel_index + 1`
holds only when every floor has been visited; an unvisited optional or secret
floor is absent and every later panel shifts.

`[F]` The title box is `rectangle("fill", 122 - 3.5*len, -7, 5 + 7*len, 10)`
inside a panel translated by `(+4, +8)`, so `box_width = 5 + 7*len(name)` and
`box_left = floor(126 - 3.5*len(name))`. Verified on a 1-5 export: 89 / 124 /
82 px wide and left edges 84 / 66 / 87 for 12 / 17 / 11 character names. That
recovers the name's exact character count with no glyph reading, which would
identify most floors outright.

### 2.3 Overlay regions are known data, not a detection problem

`[F]` `leveldata.lua:168-176` serialises `textboxes` per floor as
`x, y, w, h, str`. The tutorial rectangles that `EXTRACTION.md` §4 finds by
hunting 1px white borders are already in the level file. Reading them removes
the need for a reference hash corpus and removes the ambiguity between "overlay"
and "unrecognised new entity" — closing `EXTRACTION.md` open question 3.

### 2.4 Geometry confirmed from source

`[F]` `renderTo` translates by `(x*256+4, y*256+8)`; `LevelData:draw` fills
`0,0,248,248` and draws sprites at `(x*16-12, y*16-12)` for 1-based `x,y`. Cell
(1,1) therefore lands at `(8, 12)` — identical to `EXTRACTION.md` §2, now
derived as well as measured. Title box rows 1–7, frame row 8, grid from row 12.

---

## 3. Sketch, if it is ever needed

1. Verify the file (PNG, palette mode, colour count).
2. Recover the pixel → palette-level mapping. Three **structural anchors** at
   fixed coordinates give reference points with no sprite knowledge: the canvas
   clear (`clear(0,0,0,1)`) is level 0.0 in the panel padding; the title box
   (`setColor(0.25,…)`) is level 0.25 in rows 1–7; the panel frame
   (`setColor(1,1,1)`) is level 1.0 in row 8. Match those three against the ten
   known palettes, then fit brightness and contrast —
   `rgb = (p − 0.5)(1 + contrast) + 0.5 + brightness/2`, two parameters per
   channel — to get the remaining two levels analytically.
   `[F]` Worked example: iestyn's red export is palette 2 with
   `contrast ≈ 1.195, brightness ≈ 0`, reproducing `(30,0,0)`, `(66,0,0)`,
   `(255,0,0)` and `(255,188,188)` to within a unit.
   `[F]` Do **not** assume five output colours — that export has eleven, so
   some source art sits between levels and the shader blends for it.
3. Slice cells per §2.4 and hash rows 2..10 (the band invariant to badge
   content — a badge occupies rows 11–15 of its own cell and rows 0–1 of the
   cell below).
4. Look up each hash in a sprite table built by hashing the unpacked sprite
   files, keyed by `entitydef` name so it regenerates for a new game version.
5. OCR value badges from the bottom rows using the unpacked font atlas.
   `[F]` Badge values are exact even when abbreviated — `5k` means exactly
   5000; the game uses integer arithmetic and the notation is unambiguous.
6. Mark textbox-covered cells blank from the level data (§2.3).
7. Emit tower JSON stamped with tower ID, app version, and a content hash.

`[F]` **The enemy tier reference row** — 2-1 floor 2F, grid row 14 — is a
canonical left-to-right sample of all ten enemy tiers, cell-aligned, hashing
identically to the same enemies on ordinary floors. It supplies every positive
enemy sprite from one export.

`[F]` Negative variants synthesise from the positive: invert every foreground
pixel, then set every background pixel orthogonally adjacent to a foreground
pixel to white. Validated for Slime, Bat, Serpent, Skeleton, Zombie and
Warlock. An 8-neighbour variant matches nothing. `[O]` Negative Scorpion does
not match under rows 2..10 but does under 2..8 — unresolved; with the sprite
atlas now unpacked this should be checked directly rather than by synthesis.

`[F]` 2-1 yields 36 distinct cell types across its non-overlay floors. Distinct
counts per floor are 119 / 61 / 61 / 43 on the four overlay floors and ≤ 18 on
every other — inflation confined exactly to overlay floors, which is a useful
sanity check.

`[D]` If this is ever built: never silently blank an unrecognised hash. It may
equally mean a genuinely new entity. Flag unknowns for review.

### 3.1 The enemy tier table

`[F]` Read off the tier reference row. This is game reference data rather than
extraction data — it belongs in `GAME_MECHANICS.md` if that document is ever
written, and `SPEC_SIM.md`'s `tier()` function is its arithmetic counterpart.

| Column | Tier | Name | Power range | Gold |
|---|---|---|---|---|
| 3 | 1 | Slime | 1–9 | 1 |
| 4 | 2 | Bat | 10–99 | 2 |
| 5 | 3 | Serpent | 100–999 | 3 |
| 6 | 4 | Scorpion | 1k–9,999 | 4 |
| 7 | 5 | Skeleton | 10k–99,999 | 5 |
| 8 | 6 | Zombie | 100k–999,999 | 6 |
| 9 | 7 | S. Warrior | 1M–9,999,999 | 7 |
| 10 | 8 | Armor | 10M–99,999,999 | 8 |
| 11 | 9 | Warlock | 100M–999,999,999 | 9 |
| 14 | 10 | Demon | 1G and above | 10 |

`[F]` The same tiering appears in `entitydef.enemy.get_spr`, which selects the
sprite by `value >= 10^n` thresholds — independent confirmation of the ranges.

### 3.2 Overlay detection by white border — the fallback

Superseded by reading `textboxes` from the level data (§2.3), but retained as
the cross-check recommended there.

`[F]` Overlay boxes are black rectangles with a **1px pure-white border**.
Within the grid area (`y` 12..251, `x` 8..247), find rows where at least 200 of
the 240 columns are pure white; these are box top/bottom borders, and their `x`
extent gives the horizontal bounds. Verified on 2-1: panels 2, 3, 5 and 11
(floors 1F, 2F, 4F, 10F) produce hits; overlay-free panels 0 and 6 produce none
above `y=250`. Rows 252–255 are the panel frame and must be excluded.

`[F]` **Boxes are not cell-aligned.** 1-1 panel 6 has borders at `y=14` and
`y=65`, covering grid row 1 through part of row 4. Mark every cell that
*intersects* the rectangle as blank, not only fully covered ones.

`[I]` Covered cells are inaccessible in game and are treated as blank.

`[F]` In 2-1, 322 of the 900 cells on those four floors are text-covered; the
remaining 578 still hash to a known type.

---

## 4. Provenance

`EXTRACTION.md`, which this document supersedes, recorded its measurements
against app version **v0.7-455**, verified on `tower_map_loot.png` (2-1),
`tower_map_tiny.png` (1-5) and `tower_map_exam.png` (1-6). Every `[F]` above
carried over from it inherits that provenance; everything sourced from the Lua
dump is marked with its file and line.
