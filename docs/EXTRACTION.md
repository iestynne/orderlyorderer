# EXTRACTION.md

Turning the game's map-export PNGs into tower state. Canonical.

**Data source:** app version **v0.7-455**. Verified against
`tower_map_loot.png` (2-1), `tower_map_tiny.png` (1-5),
`tower_map_exam.png` (1-6).

Map exports are the **only** source of a tower's initial state — the savegame
contains none (see `SAVE_FORMAT.md` §3).

---

## 1. File handling — read this first

Map exports are **lossless PNG, palette mode, 15 colours**. They must stay that
way.

**Uploading a bare `.png` to Claude transcoded it to JPEG** despite the
extension. This is not a visible-quality problem; it destroys exact hashing.
JPEG's 8×8 blocks happen to align with the cell grid such that a cell's rows
4–11 form one self-contained block band, which makes hashing *look* like it
works while the badge digits in row 11 perturb the whole block.

**Always transfer map images inside a ZIP.** Verify on arrival:

```python
im = Image.open(path)
assert im.format == "PNG"
assert len(im.convert("RGB").getcolors(65536)) <= 16
```

---

## 1a. HAZARD: an export is a snapshot, not a starting state

**A map PNG can be exported at any moment during a run.** A mid-run export shows
enemies already defeated, gates already opened, walls already broken and Pop-Up
Walls already converted. Nothing in the image marks it as mid-run.

Extracting one and treating it as the tower's initial state produces a tower
JSON that is silently, subtly wrong — and every route validated against it would
be wrong in the same direction, so our own tests would not catch it.

**Rule: a map export used as initial tower state must be taken immediately after
restarting the tower**, and the tower JSON must record that provenance.

**The player marker is always present** and occupies a cell, hiding whatever is
beneath it. At the start of a run there is nothing beneath it, which is the
second reason the export must be taken at the start: mid-run the player may be
standing anywhere, and that cell becomes unrecoverable.

Weak detection heuristics, worth emitting as warnings rather than trusting: the
player marker not at the tower's known start cell, or a floor with an
implausibly high count of Empty cells. Neither is reliable, so provenance
discipline is the real defence.

### Turning the hazard into an oracle

The same property is useful in the other direction. Export at the start, play a
route, export again: the diff between the two images is **exactly the set of
cells the route changed**. Our simulator must predict that second image cell for
cell.

That is a golden-file test entirely independent of the savegame round trip — it
checks tower state rather than move legality, which is the half the savegame
cannot verify. Worth building once the extractor works.

## 2. Export geometry

The export concatenates every floor as a grid of panels in Western reading
order (left→right, top→bottom). **Panel 0 is the lowest floor**, so
`save_floor = panel_index + 1`.

Panel grid is derived from the image size: `cols = width // 256`,
`rows = height // 256`. All 14 available exports (v0.7-455):

| Tower | Export size | Panel grid | Colours |
|---|---|---|---|
| 1-1 Training Tower | 1024×1024 | 4×4 | 16 |
| 1-2 Tower of Might | 1024×1024 | 4×4 | 15 |
| 1-3 Tower of Traps | 1024×1024 | 4×4 | 15 |
| 1-4 Miner's Obelisk | 1280×1024 | 5×4 | 16 |
| 1-5 Tiny Tower | 512×512 | 2×2 | 12 (3 floors) |
| 1-6 Adventurer's Exam | 1280×1280 | 5×5 | 15 (25 floors) |
| 2-1 Tower of Loot | 1024×1024 | 4×4 | 15 (14 floors) |
| 2-2 Artificer's Task | 1280×1024 | 5×4 | 15 |
| 2-3 Thieves' Guild | 1280×1024 | 5×4 | 15 |
| 2-4 Descent Into Abyss | 1536×1280 | 6×5 | 15 |
| 2-5 The Orderly Order | 1536×1536 | 6×6 | 12 |
| EX-1 Jam Tower | 1024×768 | 4×3 | 15 |
| EX-2 Sorcerer's Tribute | 1024×768 | 4×3 | 15 |
| EX-3 Lockpick Battle | 1024×1024 | 4×4 | 15 |

Only towers the player has beaten will export a map image.

**Unused panel slots are always at the end of the reading order.** Confirmed.
So `floor_count` alone determines which panels are live.

### Within the image

```
panel_origin = (panel_col * 256, panel_row * 256)
```

Panel pitch is **256** with no gutter. Any leftover width/height is padding.

### Within a panel (256×256)

```
rows   0.. 7   title strip ("B2F: Golden Vault")
rows   8..11   frame border (4px)
grid origin    panel_origin + (8, 12)
cell size      16 x 16
grid           15 x 15
```

So cell `(x, y)` — 1-based, top-left origin — occupies:

```
image_x = panel_col*256 + 8 + (x-1)*16
image_y = panel_row*256 + 12 + (y-1)*16
```

Verified pixel-exact on all three exports.

---

## 3. Number badges and the clean hash band

Cells carrying a value (enemy power, gate cost, gold amount) have a numeric
badge rendered bottom-right. The font is 5px tall plus a 1px outline, offset
2px downward, so the badge occupies:

- the **bottom 5 rows** of its own cell (rows 11–15), and
- the **top 2 rows of the cell below** (rows 0–1).

Positive enemies use a black outline, negative enemies a white one.

Above 999 the badge abbreviates (`1k`, `5k`, `100M`), and **the abbreviation is
exact**: `5k` means exactly 5000. The game uses integer arithmetic throughout,
and the notation is designed so a player can read a whole floor at a glance with
zero ambiguity. Badge OCR therefore recovers the true value — no second source
is needed.

The one genuinely ambiguous abbreviation in the UI is **the player's own power**,
which is shown exactly in the sidebar rather than as a badge. That is a sidebar
concern, not a map-extraction one.

### Identification rule

Hash **rows 2..10 inclusive** of the 16×16 cell.

```python
h = hashlib.md5(cell[2:11, :].tobytes()).hexdigest()
```

**Measured, not assumed.** Taking one cluster of 132 cells whose badges all
differ and counting distinct row bitmaps per row gives:

```
row      0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
distinct 12  4  1  1  1  1  1  1  1  1  1  2  4  7  6  7
```

Rows 2..10 are invariant across every badge value. The badge occupies rows 11–15
of its own cell and rows 0–1 of the cell below — exactly as documented in §3, for
positive and negative enemies alike.

**Result for 2-1:** 36 distinct cell types across the ten floors without
tutorial overlays. Tiles are **not** autotiled — two equivalent tiles are
byte-identical — and there is no terrain/occupant compositing. Earlier counts of
267 and 588 were artifacts of tutorial text and JPEG damage respectively.

---

## 4. Tutorial overlays

Some floors carry tutorial text drawn over the grid. In 2-1 these are **1F, 2F,
4F and 10F**. Of their 900 cells, 578 still hash to a known type; the remaining
**322 are text-covered**.

Covered cells are **inaccessible in game** and are to be treated as **blank**.

### Detection: the white border

Overlay boxes are black rectangles with a **1px pure-white border**. Detecting
that border is reliable and does not require any reference corpus.

Within the grid area (`y` 12..251, `x` 8..247), find rows where at least 200 of
the 240 columns are pure white (255). These are box top/bottom borders; take
their `x` extent for the box's horizontal bounds.

Verified on 2-1: panels 2 (1F), 3 (2F), 5 (4F) and 11 (10F) all produce hits;
overlay-free panels 0 and 6 produce none above `y=250`. The rows at 252–255 are
the panel frame and must be excluded.

**Boxes are not cell-aligned.** 1-1 panel 6 has borders at `y=14` and `y=65`,
covering grid row 1 through part of row 4. **Mark every cell that intersects the
rectangle as blank**, not just fully-covered ones.

Where detection is ambiguous, fall back to manual marking — a per-tower list of
blanked cells in the tower JSON is acceptable and auditable.

An unrecognised cell hash may mean *either* an overlay *or* a genuinely new
entity. Never conflate the two: flag unknowns for review rather than silently
blanking them.

---

## 5. Distinct-type counts per floor (2-1, rows 2..10 hash)

```
1F 119   10F 61    2F 61    4F 43     <- the four overlay floors
11F 18    9F 18    7F 17    6F 17
 5F 15    8F 13    3F 12   B1F 10
12F  8   B2F  7
```

Inflation is confined exactly to the overlay floors — a useful sanity check when
extracting a new tower.

---

## 6. Extractor design

1. Verify the file per §1.
2. Slice cells per §2.
3. Hash rows 2..10 per §3.
4. Look up each hash in the sprite table (`SPRITES.json`) to get the entity.
5. For entities carrying a value, OCR the badge from the bottom rows using the
   bitmap font glyph table.
6. Mark text-covered cells blank per §4.
7. Emit tower JSON stamped with the tower ID, app version, and a content hash of
   the grid for later patch detection.

Steps 4 and 5 are blocked on the sprite→entity table and the font glyph table.

### The enemy tier reference row

**2-1 Tower of Loot, floor 2F (panel 3), grid row 14** contains a canonical
left-to-right reference of **all ten enemy tiers**, including tiers absent from
that tower. It is drawn inside a tutorial overlay but is exactly cell-aligned,
and its cells hash identically to the same enemies on ordinary floors — verified
for tiers 1–6 against 2-1's clean-floor clusters.

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

This row alone supplies the positive sprite for every tier — no extra
screenshots are needed for enemy identification.

### Deriving negative enemy variants

Negative variants are synthesised from the positive sprite:

1. Background = pure black (0); everything else is foreground.
2. Invert every foreground pixel: `v -> 255 - v`.
3. Set every background pixel **orthogonally adjacent** to a foreground pixel to
   white (255) — the added outline.

**Validated** against the full 14-tower corpus using the corrected band:
synthesising from the tier row produces exact hash matches for **Slime, Bat,
Serpent, Skeleton, Zombie and Warlock** — six independent confirmations.

Negative Scorpion is known to exist in 2-1 but does not match under the
corrected band; it does match under rows 2..8, which suggests its badge outline
intrudes one row further still. **Unresolved** — do not treat the rule as
settled for Scorpion until its cell is located and diffed directly.

S. Warrior, Armor and Demon negatives produce no match, consistent with those
variants not occurring in any exported tower.

Any future map containing one of the unmatched negatives is an immediate test: a
mismatch falsifies the rule.

An 8-neighbour outline variant matches nothing — the 4-neighbour rule is
correct. A flood-filled-exterior variant gives identical results, so the simple
"all black is background" form is sufficient.

## 7. Open questions

1. **Sprite→entity table incomplete.** 36 types identified in 2-1; naming pending
   the in-game compendium pages. Requested from the developer: the sprite atlas
   and font PNG, which would replace steps 4–5 with a direct lookup.
2. **Badge OCR not built.** Needs the bitmap font glyph table.
3. **Overlay detection** needs a reference hash corpus (see §4); no single-tower
   solution exists.
