# SPEC: Map PNG Diff (final-state extraction)

Status: **draft 2 — implemented**, 2026-08-29.
Game source verified against: `v0.7-455` Lua dump.

Draft 2 adds §5.2, the single-image path, which is what actually ran first
because a final-state export arrived before a `before` export existed. It
turned out to be the stronger check and it is now the primary one; the
two-image diff of §5 remains implemented and tested.

> **Scope guard.** This spec covers **only** diffing two map exports of the
> same tower to find which cells changed. Full cell categorisation — turning a
> PNG into a tower's initial state — is **deferred and must not be
> implemented**: see `NOTES_map_extraction_deferred.md` for why and for the
> research already done. Tower initial state comes from the game's level data
> files, not from images.

Provenance legend:
- `[F]` **fact — empirically validated**: measured from exports, or read from
  Lua source. Evidence cited inline.
- `[I]` iestyn said it — from play experience, not re-verified.
- `[D]` decision — agreed design choice.
- `[P]` proposal — not yet validated.
- `[O]` open — unresolved; implement the stated default and flag it.

---

## 1. Purpose

Given two map exports of the same tower — one taken at the start of a run, one
at the end — produce the set of cells the run changed. This is the simulator's
golden oracle (`SPEC_SIM.md` §11 oracle 3): the sim must predict that set
exactly, cell for cell.

`[D]` **This needs no entity recognition.** The simulator's rules constrain
every cell to exactly three possible outcomes:

| Outcome | Cause |
|---|---|
| unchanged | nothing happened to it |
| empty | entity removed, gate opened, wall destroyed |
| Reinforced Wall | a Pop-Up Wall was stepped off |

So the job is "does this cell still look like it did?", plus one sprite
comparison to disambiguate the single non-empty outcome. That is the whole
spec.

---

## 2. Inputs and preconditions

```ts
function diffExports(before: PNG, after: PNG): CellChange[] | DiffError
```

`[D]` Both exports **must** be taken:

1. from the same tower,
2. by the same player,
3. under the **same palette and brightness/contrast settings** (§6),
4. with `before` taken immediately after restarting the tower (§7).

Violations are errors, not warnings. The extractor asserts what it can and
refuses the pair otherwise.

### File handling

`[F]` Exports are lossless palette-mode PNG. **Uploading a bare `.png` to
Claude transcoded it to JPEG once**, which destroys exact comparison in a way
that looks like it works: JPEG's 8×8 blocks align with the cell grid such that
rows 4–11 form one self-contained band, while badge digits in row 11 perturb
it.

`[D]` **Always transfer map images inside a ZIP.** Assert on arrival:

```python
im = Image.open(path)
assert im.format == "PNG"
assert len(im.convert("RGB").getcolors(65536)) <= 16
```

`[D]` Also assert both images have identical dimensions and identical distinct
colour counts. A differing colour count means the palette settings changed
between exports — refuse the pair.

`[F]` Reference table, measured across all 14 available exports at v0.7-455
under the **default** palette. Use it to sanity-check dimensions, and as the
baseline for the colour-count guard (a tinted export may legitimately differ —
see §6 — but both images of a pair must agree with each other):

| Tower | Export size | Panel grid | Colours |
|---|---|---|---|
| 1-1 Training Tower | 1024×1024 | 4×4 | 16 |
| 1-2 Tower of Might | 1024×1024 | 4×4 | 15 |
| 1-3 Tower of Traps | 1024×1024 | 4×4 | 15 |
| 1-4 Miner's Obelisk | 1280×1024 | 5×4 | 16 |
| 1-5 Tiny Tower (3 floors) | 512×512 | 2×2 | 12 |
| 1-6 Adventurer's Exam (25 floors) | 1280×1280 | 5×5 | 15 |
| 2-1 Tower of Loot (14 floors) | 1024×1024 | 4×4 | 15 |
| 2-2 Artificer's Task | 1280×1024 | 5×4 | 15 |
| 2-3 Thieves' Guild | 1280×1024 | 5×4 | 15 |
| 2-4 Descent Into Abyss | 1536×1280 | 6×5 | 15 |
| 2-5 The Orderly Order | 1536×1536 | 6×6 | 12 |
| EX-1 Jam Tower | 1024×768 | 4×3 | 15 |
| EX-2 Sorcerer's Tribute | 1024×768 | 4×3 | 15 |
| EX-3 Lockpick Battle | 1024×1024 | 4×4 | 15 |

`[I]` Only towers the player has beaten will export a map image at all.

---

## 3. Geometry

`[F]` Derived from `leveldata.lua:302-399` and confirmed pixel-exact on three
exports. The export concatenates floors as 256×256 panels in reading order,
no gutter:

```
cols = width // 256          rows = height // 256
panel_origin = (panel_col * 256, panel_row * 256)

image_x = panel_col*256 + 8 + (x-1)*16      # x, y are 1-based
image_y = panel_row*256 + 12 + (y-1)*16     # cells are 16x16, grid is 15x15
```

`[F]` Within a panel: rows 1–7 are the floor-name box, row 8 is the full-width
frame, the grid starts at row 12. Unused panel slots are always at the end of
the reading order — this follows from the code, which advances `x,y` in reading
order.

`[F]` The canvas is cleared to `(0,0,0,1)` before drawing, so the background is
`palette[0]` — pure black only under the default palette (§6).

---

## 4. Pairing panels

`[F]` The export includes only floors whose map the player has unlocked
(`game.unlocks.maps[tower]`, populated by `unlock_floor_map` on every floor
ever stood on, in any run). This is **persistent progress, not run state**, so
two exports by the same player have the same panel layout unless a new floor
was unlocked between them.

`[D]` **Pair panels by comparing title strips for byte equality**, not by
index. Panel *i* of `before` pairs with the panel of `after` whose title strip
matches. This needs no name decoding at all.

`[D]` If any panel in either image has no match in the other, refuse the pair
and report it: the player unlocked a floor between exports, and the `before`
image is no longer a valid baseline.

`[F]` For reference, the title box is
`rectangle("fill", 122 - 3.5*len, -7, 5 + 7*len, 10)` inside a panel translated
by `(+4, +8)`, so `box_width = 5 + 7*len(name)` and
`box_left = floor(126 - 3.5*len(name))`. Verified on a 1-5 export: widths
89 / 124 / 82 px and left edges 84 / 66 / 87 for names of 12 / 17 / 11
characters. `[P]` This yields the name's exact character count if a future
feature ever needs to identify a floor rather than merely pair it.

---

## 5. The diff

For each paired panel, for each of the 225 cells:

1. **Compare rows 2..10** of the 16×16 cell, byte for byte, between the two
   images.

   `[F]` Rows 2..10 are the only band invariant to badge content. A value badge
   occupies rows 11–15 of its own cell **and rows 0–1 of the cell below**, so
   this band is immune both to its own digits and to bleed from above.
   Measured, not assumed. Across a cluster of 132 cells whose badges all
   differ, counting distinct row bitmaps per row gives:

   ```
   row      0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
   distinct 12  4  1  1  1  1  1  1  1  1  1  2  4  7  6  7
   ```

   Rows 2..10 are the maximal invariant band, and the pattern matches the badge
   geometry exactly — rows 11–15 of the cell plus rows 0–1 of the one below,
   for positive and negative enemies alike. Positive enemies use a black badge
   outline, negative a white one.

   `[F]` Earlier distinct-type counts of 267 and 588 for 2-1 were artifacts of
   tutorial text and JPEG damage respectively; the true figure is 36 across its
   non-overlay floors. If a diff produces implausibly many changes, suspect the
   file transfer before the simulator.

   `[F]` Tiles are not autotiled and there is no terrain/occupant compositing,
   so two equivalent cells are byte-identical.

2. **Classify each differing cell:**
   - band is entirely the background colour → **empty**
   - band matches the Reinforced Wall reference (§5.1) → **Reinforced Wall**
   - anything else → **`UNEXPECTED_CHANGE`**, reported with coordinates

   `[D]` The sim's rules permit no third outcome, so `UNEXPECTED_CHANGE` means
   a sim bug, an unmodelled mechanic, or a mid-run `before` image. It must be
   loud, never silently absorbed.

3. **Mask the player's cell** (§8) and emit it as `unknown`.

4. Emit results in the **same JSON schema as the tower initial-state files**,
   fully populated. `[D]` One structural differ then serves initial state, sim
   output and diff output, and the UI can load any of the three
   interchangeably.

### 5.2 One image is enough, and it says more

`[F]` **Implemented and run; both available exports pass with zero
differences.** The two-image diff above answers "which cells changed". A single
final-state export answers the stronger question — "is every cell what the
simulator says it is" — and it does so without a `before` image at all.

It rests on a fact §5 already establishes: *tiles are not autotiled and there is
no terrain/occupant compositing, so two equivalent cells are byte-identical.*
Therefore:

**The partition check.** Group every cell of the image by what the simulator
says it should be, and assert each group is internally byte-identical. If the
sim is right, the image's own byte-equality structure partitions exactly along
predicted-content lines. If the sim is wrong about one cell, that cell lands in
the wrong group and surfaces as a second variant.

`[D]` This is not circular. A wrong prediction is *detected* precisely because
the image disagrees with the group it was assigned to; it would only be missed
if every instance of a kind were wrong in the same way.

**Emitting both sides as tower JSON.** Better still, and what SPEC-004 §11
oracle 3 actually asked for:

```
(a) simulator     -> tower JSON      towerJsonFromSim
(b) PNG extractor -> tower JSON      towerJsonFromPng
(c) structural diff of the two       diffTowerJson
```

`[D]` **(b) consults the simulator for nothing.** Its sprite dictionary is
learned from the image, keyed by the *initial* tower JSON. That is what makes
the comparison evidence rather than tautology — if the extractor were handed the
sim's predictions it would agree by construction.

`[D]` **The dictionary anchor is exact, not a majority vote.** A first attempt
took the most common band per kind and was wrong exactly where it mattered: a
route consumes *most* keys, pickaxes and low-tier enemies, so for those kinds
the majority band is the empty one and every survivor reads as changed. The
exact anchor uses the three-outcome rule instead:

1. A `wall:0` cell can never become anything else, so any one of them yields the
   background band outright — ground truth, no vote.
2. Every other kind ends as its own sprite, the background, or (pop-ups only) a
   Reinforced Wall. So that kind's sprite is **the band that is neither of the
   other two**. If no such band exists, every instance was consumed, which needs
   no sprite to say so.

A kind exhibiting two unexplained bands is a finding, raised rather than
averaged away.

`[F]` **Textbox coordinates carry the panel translation** of `(+4, +8)` that §4
records for the title box, so a box declared at `(4, 4)` lands at panel pixel
`(8, 12)` — the grid's own origin. Measured: without it, 1-6's floors 1, 16 and
25 report spurious inconsistencies in the cell row immediately below each box;
with it they are clean. 2-5 has no textboxes and is unaffected either way. Cells
a textbox covers carry no information about the tile beneath and are masked.

`[D]` **This does not breach the scope guard.** Full cell categorisation — a PNG
to a tower's *initial* state, with no prior knowledge — remains unimplemented
and deferred. What §5.2 does is narrower and licensed by the same three-outcome
rule as §5: it reads a *final* state given the initial state, which the level
data already provides.

### 5.1 The Reinforced Wall reference

`[D]` Take the reference band from **within the same image** — any Reinforced
Wall already present in the tower's initial state, located via the tower JSON.
This avoids any comparison against untinted sprite files and so removes all
palette handling from the hot path.

`[O]` If a tower contains no Reinforced Wall at the start, fall back to a
palette-normalised comparison against the unpacked sprite
(`NOTES_map_extraction_deferred.md` §3). Check which towers this affects before
building the fallback — it may be none.

---

## 6. Palette settings

`[F]` **Map exports are tinted.** Measured: a 1-5 export under the red palette
is red throughout, including the floor-name text. Tinting is a shader
(`the_shader.lua`) — a 5-entry palette remap plus brightness and contrast —
and a LÖVE shader is global state that persists between frames, so it is still
bound when `dump_image` runs from a menu action. `renderTo` does not escape it.

`[F]` `settings.lua:13` holds ten palettes as literal constants. **Palette 7 is
exactly inverted**, so luminance ordering is not merely unreliable but exactly
reversed for that setting — no ordering-based normalisation is valid.

`[F]` Tinting can also *lose* information: the red 1-5 export has 11 distinct
colours where the same tower has 12 untinted. One source colour merged, and no
normalisation can recover it.

`[D]` Hence the same-settings precondition in §2. With it, the diff is a raw
byte comparison and none of the above matters. The colour-count assertion in §2
is what enforces it.

`[F]` `leveldata.lua:279` reads `player_tint` inside the export path, so the
player marker carries a second, independent recolouring even under the default
palette.

---

## 7. HAZARD: an export is a snapshot, not a starting state

`[F]` A map PNG can be exported at any moment during a run. A mid-run export
shows enemies already defeated, gates opened, walls broken, pop-ups converted.
**Nothing in the image marks it as mid-run.**

`[D]` The `before` export **must** be taken immediately after restarting the
tower, and the diff result must record provenance: tower ID, app version,
both export timestamps, and a content hash of each grid.

`[P]` One reliable warning is available: the tower metadata gives
`start_floor / start_x / start_y` exactly, so if the player marker in `before`
is not at the tower's start cell, the image is mid-run. Emit that as an error,
not a warning — it is cheap and decisive.

---

## 8. The player marker

`[F]` `dump_image` passes the player to `LevelData:draw` **only for the floor
the player is standing on**; every other panel is drawn with `player = nil`.
So each export contains exactly one player marker, on one floor.

`[F]` The marker composites **over** the cell's contents — stairs and spike
pixels survive around the sprite's edges, and a win-state export hid the Crown
beneath it. That cell's true contents are unrecoverable from the image.

`[D]` Mask the player's cell in **both** images and mark it `unknown`. The sim
predicts where the player ends, so the mask position for `after` comes from the
sim; the differ should independently detect the marker and warn if the two
disagree, since a disagreement is a real finding and the check is nearly free.

`[D]` Detect the marker by **foreground/background mask**, not by colour, since
`player_tint` varies independently. `[F]` "Background" is **two** colours, not
one: transparent sprite pixels leave the cleared canvas showing as `(0,0,0)`,
while opaque black art is shader-mapped to `palette[0]` (§9). Treat both as
background, or the mask fragments across every transparent pixel. Never assume
literal black alone — under palette 7 `palette[0]` is white.

`[P]` **Opportunistic shortcut.** When the player tint differs from the main
palette, the marker is the only thing in the image carrying colours off the
palette ramp, so it can be located by finding off-ramp pixels — 52 of them
identified the marker exactly in the red 1-5 export. Cheap and decisive when it
applies, but it degrades to nothing when the two tints coincide (notably the
default greyscale with player tint off), so it is a fast path, never the only
detector.

`[F]` A player standing on a Pop-Up Wall renders as background, because
stepping onto a pop-up genuinely empties the cell before the conversion commits
(`SPEC_SIM.md` §4.2). That is the cell's true state, not occlusion — but it is
indistinguishable from occlusion in the image, so the mask covers it either
way.

---

## 9. Open items

1. **RESOLVED — why exports contain more colours than expected.** `[I]` By eye
   there should be about 4; measured counts are 12–16 untinted (§2 table) and
   11 for the red 1-5 export. The full accounting, for the red export:

   > **5 palette levels + transparent-black showing through + the player's own
   > separate tint.**

   `[F]` **A tinted export shows two palettes at once.** The main shader
   palette recolours everything, and `player_tint` (`leveldata.lua:279`)
   recolours the player marker independently — so the marker's pixels sit off
   the main ramp entirely. The 52 stray pixels below are exactly the player
   sprite, and no mystery remains.

   Retained below as the evidence, since it bears on §8.

   Data from the red 1-5 export, ordered by pixel count:

   ```
   (30,0,0)      78848      (255,190,190)  7293
   (0,0,0)       75567      (66,0,0)       6455
   (255,255,255) 43609      (68,0,0)       1450
   (255,0,0)     24910      (174,190,190)    24
   (255,188,188) 23960      (48,0,0)         18
                            (67,0,0)         10
   ```

   Three observations that should shorten the investigation:

   - **Five of them are the palette.** With palette 2 and `contrast ≈ 1.195`,
     levels 0–4 land on `(30,0,0)`, `(66,0,0)`, `(255,0,0)`, `(255,188,188)`,
     `(255,255,255)` — the five largest counts besides pure black. So the
     shader is behaving as designed.
   - `[F]` **Pure black is sprite transparency, not an unshaded clear.**
     Measured: of 75,567 pure-black pixels, 68,320 lie inside the grid area and
     10,031 lie outside the one unused panel slot — so black is *everywhere*,
     not just in padding. `[P]` The explanation that fits: the shader runs on
     drawn fragments, so a transparent sprite pixel is never written and the
     cleared canvas shows through as `(0,0,0)`, while an *opaque* black pixel
     in the art is shader-mapped to `palette[0]` = `(30,0,0)`. Under the
     default greyscale palette the two are indistinguishable; a tint separates
     them.
     `[D]` **Consequence for §8:** "background" is two different colours in a
     tinted export. The player-marker mask must treat both `(0,0,0)` and
     `palette[0]` as background, or it will fragment on transparent pixels.
   - `[F]` **Not font antialiasing.** `[I]` A reasonable hunch, given the font
     silhouettes previously seen not scaling as nearest-neighbour — but tested
     and ruled out: all five minority colours lie in the **grid**, none in the
     title strip, and the title text is pure `(255,255,255)` against the box
     colour with no intermediate values anywhere in rows 1–7. The LÖVE font
     renderer is not introducing intermediates here.
   - `[F]` **The trace colours are the player marker.** `(174,190,190)`,
     `(48,0,0)` and `(67,0,0)` — 52 pixels between them — all fall within
     `x` 122–130, `y` 221–228 of panel 0: a **single cell**, grid (8, 14).
     `[I]` That is the player sprite, which carries its own tint. `(174,190,190)`
     has `G = B > R`, off the red ramp entirely, exactly as a second,
     independent recolouring predicts.

   `[D]` None of this blocks the diff, which compares bytes between two
   identically-configured exports.

---

## 10. Verification Contract

```
Run: npm test
Report: test summary; PASS/FAIL + actual value per named case;
        invariant results; diff stat; any file touched outside src/mapdiff/
```

**Named cases with exact expected values**

| Case | Expected |
|---|---|
| Panel grid, 1-5 Tiny Tower (3 floors) | 512×512, 2×2 |
| Panel grid, 1-6 Adventurer's Exam (25 floors) | 1280×1280, 5×5 |
| Cell (1,1) of panel (0,0) | image pixel (8, 12) |
| Cell (15,15) of panel (1,0) | image pixel (488, 236) |
| Comparison band | rows 2..10 inclusive |
| Title box rows | 1..7; row 8 is the full-width frame |
| Title box width, names of 12 / 17 / 11 chars | 89 / 124 / 82 px |
| Diff of an export against itself | **zero** changed cells |
| Cell that became empty | classified **empty** |
| Cell that became a Reinforced Wall | classified **Reinforced Wall** |
| Player's cell, both images | **unknown**, marker detected there |
| Pair with differing colour counts | **refused** |
| Pair where one image has an extra panel | **refused**, floor named |
| JPEG-transcoded input | rejected by the §2 assertion |
| `before` with the player away from the start cell | **rejected** as mid-run |

**Oracles**

1. **Identity.** Diffing an export against itself yields zero changes. Trivial,
   but it catches geometry and band-slicing errors immediately. `[F]` Passes.
2. **Start/end diff against the simulator.** Export at the start, replay the
   route in the sim, export at the end; assert the sim's predicted final cell
   states equal the diff, with the player's cell masked. `[O]` Implemented and
   tested against synthetic exports; **not yet run against the game**, because
   it needs a `before` export and none exists. Superseded in practice by
   oracle 4.
3. **Cross-tower geometry.** For each available export, assert the panel grid
   and cell origins match §3. `[F]` Passes on both real exports.
4. **Single-image final-state golden (§5.2).** `[F]` **The result this spec was
   built for.** Against two real exports:

   | Tower | Route | Cells compared | Differences |
   |---|---|---|---|
   | 2-5 The Orderly Order, 32 floors | `F 211g 98.0M win H[A]`, 6 327 steps | **7 199** | **0** |
   | 1-6 Adventurer's Exam, 25 floors | `747M C2 win`, 10 632 steps | **5 423** | **0** |

   12 622 cells, zero disagreements, across 47 and 40 distinct predicted kinds
   respectively. Masking: one cell (the player) in 2-5, 202 in 1-6 (the player
   plus five tutorial textboxes).

   `[F]` The only band collision in either tower is `empty == wall:0` — a cell
   the route emptied renders identically to floor that was always empty. That is
   a confirmation of the model, not a defect.
