> **SUPERSEDED — DO NOT IMPLEMENT.**
>
> Tutorial overlays are declared explicitly in the game's own map files as
> `textboxes` records (`x y w h text`), read by `leveldata.lua`. Detecting them
> from pixels solves a problem that no longer exists.
>
> Retained only as a record of the analysis. See `STATUS.md`.

# SPEC-001 — Tutorial overlay rectangle detector

**Status:** ready to implement
**Docs to load:** `EXTRACTION.md` only. Do not load `SAVE_FORMAT.md` or `SPRITES.json`
except as test fixtures (§7).
**Scope:** `src/extract/overlay/**` and `test/extract/overlay/**`. Touching
anything else is a contract violation and must be reported.

---

## 1. Why

Map exports are the only source of a tower's initial state. Some floors carry
tutorial text drawn in black rectangles with a white border, which hides the
tiles beneath. Hidden tiles are inaccessible in game and must be recorded as
**Strong Wall** — not Empty. Strong Walls cannot be interacted with, broken or
bypassed by any mechanic, so treating hidden cells as Strong Wall guarantees no
phantom pathway is introduced into a floor. Empty would be the unsafe default.
Everything downstream — cell classification, tower JSON, the simulator —
depends on knowing exactly which cells are hidden.

A naive detector was prototyped and rejected: it found 6 of 10 known rectangles
in tower 1-1, missed 4, and reported 3 false positives. Both failure modes are
understood and this spec is written to eliminate them.

## 2. Goal

Given one 256×256 panel of a map export, return the set of tutorial overlay
rectangles and the grid cells they cover.

## 3. Interface

```ts
/** 256x256 greyscale panel, row-major, panel-local coordinates. */
export type Panel = { data: Uint8Array; width: 256; height: 256 };

/** Panel-local pixel coordinates, inclusive on all sides. */
export interface OverlayRect { x0: number; y0: number; x1: number; y1: number }

/** 1-based grid cell range, inclusive. */
export interface CellRange { x0: number; x1: number; y0: number; y1: number }

export interface OverlayResult {
  rects: OverlayRect[];
  covered: CellRange[];      // one per rect, same order
  coveredCellCount: number;  // total distinct cells covered
  warnings: string[];        // see §6
}

export function detectOverlays(panel: Panel): OverlayResult;
```

Pure function. No file IO, no PNG decoding, no UI imports. PNG decoding and
panel slicing live in the caller.

## 4. Geometry (from EXTRACTION.md, do not re-derive)

```
grid origin inside a panel   (8, 12)
cell size                    16 x 16
grid                         15 x 15, so pixels x 8..247, y 12..251
frame interior               x 4..251, y 8..255
```

Cell `(cx, cy)` (1-based) covers pixels `x = 8 + (cx-1)*16 .. +15`,
`y = 12 + (cy-1)*16 .. +15`.

## 5. Algorithm

### 5.1 Edge detection

An **edge** is a 2px-wide run of pure white (255) at least 16px long, horizontal
or vertical, within the frame interior.

### 5.2 Inside/outside classification

For each edge, take the 4px-deep band of pixels on each side and compute the
mean brightness. The **inside** is the significantly darker side.

Overlay interiors are black with white lettering; map content is full of
mid-grey bevelled tiles. The delta should be large.

If `|meanA - meanB|` is below `AMBIGUITY_THRESHOLD`, do **not** guess. Emit a
warning naming the edge and its two means, and exclude the edge.

`AMBIGUITY_THRESHOLD` is a named exported constant. Start at 40 (of 255).
Floor 8 of tower 1-1 is the known worst case — the pixels below its rectangle
are the dark bevelled bottoms of a row of Regular Walls — so **report the actual
delta measured for every edge on 1-1 floor 8** so the threshold can be pinned
against real data rather than guessed.

### 5.3 Rectangle assembly

Walk counter-clockwise from an edge with the inside on the left. Follow the
edge to a corner, turn, continue, and close after the fourth corner.

While walking, these must hold:

- along an edge: 2 pure-white pixels on the outside;
- at a corner: 4 pure-white pixels outside the corner;
- immediately inside an edge: never pure white. Note the inside dark border is
  sometimes only 1px before lettering begins, so test exactly 1px in, not more.

### 5.4 Rectangles closed by the grid boundary

**This is failure mode 1 and the main reason the prototype missed 4 of 10.**

An overlay flush against the edge of the grid merges into the white area outside
the 15×15 grid, so it may present as few as **one** edge inside the grid.

Treat the grid boundary as an implicit edge on all four sides. A rectangle may
therefore be closed by any mix of detected edges and boundary edges. A
rectangle with zero detected edges is not a rectangle — reject it, that's the
whole grid.

Known cases: 1-1 floors 4, 5, 6 (top strips) and floor 13 (top half).

### 5.5 What is not a rectangle

**This is failure mode 2 and the source of all 3 false positives.**

A region of *map* trapped between two overlays is bounded above by one
rectangle's bottom edge, below by another's top edge, and left/right by the grid
boundary — geometrically a valid white-bordered rectangle. The inside/outside
classification in §5.2 is what rejects it: both horizontal edges have their
inside facing *away* from the trapped region.

Assemble rectangles only from edges whose inside faces the candidate interior.

### 5.6 Cell coverage

A cell is covered if it **intersects** the rectangle by at least one pixel.
Rectangles are not grid-aligned; partial coverage counts as covered.

## 6. Warnings

`warnings` is for anything the caller must not silently trust:

- an edge whose inside/outside delta is below threshold (§5.2);
- an edge that could not be assembled into a closed rectangle;
- a rectangle whose walk violated an invariant in §5.3;
- overlapping rectangles.

Never drop a warning to make output cleaner. An unrecognised region may be an
overlay *or* a genuinely new entity, and conflating those corrupts tower data
in a way that is very hard to notice later.

## 6a. Implementation style

**Less code is better.** Where two implementations satisfy this contract, prefer
the significantly smaller one. Refactor toward it as part of the task, not as
follow-up work. A smaller codebase is easier for both a human and an agent to
reason about correctly, and this project has no incentive to accumulate debt.

This is a constraint on the solution, not a licence to drop cases: every named
case and invariant in the contract must still pass.

## 7. Non-goals

- Cell classification, hashing, `SPRITES.json` lookup.
- PNG decoding, file IO, panel slicing.
- Reading overlay text.
- Any tower other than the two fixtures.

---

## 8. Verification Contract

```
Run: npm test -- overlay

Report:
  - test summary (passed/failed/total)
  - PASS/FAIL + actual value for every named case in 8.1 and 8.2
  - the four invariant results in 8.3
  - the measured inside/outside deltas for all edges on 1-1 floor 8 (§5.2)
  - every entry in `warnings`, per floor
  - diff stat (files changed, +/- lines)
  - any file touched outside src/extract/overlay/ or test/extract/overlay/
```

Fixtures: `map_1-1_training_tower.png`, `map_2-1_tower_of_loot.png`.
Floor ordinal = panel index + 1 in reading order; floor 1 is the top-left panel.

### 8.1 Named cases — tower 1-1 (exact expected values)

These five were produced by the prototype and independently confirmed against
the game. They are regression anchors and must pass exactly.

| Floor | Rects | Covered cells |
|---|---|---|
| 1 | 1 | x8-15 y1-15 |
| 7 | 2 | x1-15 y1-4 **and** x1-15 y12-15 |
| 8 | 1 | x1-15 y1-3 |
| 9 | 1 | x1-15 y13-15 |
| 10 | 1 | x5-11 y6-10 |

### 8.2 Named cases — rectangle counts (values to be pinned)

Counts are known; exact cell ranges are not yet verified by hand. **Report the
actual ranges**; they will be pinned into this contract afterwards and become
regression anchors.

Tower 1-1:

| Floor | Rects | Description |
|---|---|---|
| 4 | 2 | thin strip at top, thin strip at bottom |
| 5 | 2 | thin strip at top, thin strip at bottom |
| 6 | 3 | thick strip at top; lower-left; lower-right, with a one-column gap between the two lower rectangles |
| 13 | 1 | top half of the floor |
| 2, 3, 11, 12, 14, 15, 16 | 0 | no overlay |

Tower 2-1:

| Floor | Rects | Description |
|---|---|---|
| 3 | 2 | top band, bottom band |
| 4 | 2 | top band, bottom band |
| 6 | 1 | top band |
| 12 | 1 | top band |
| all others | 0 | no overlay |

Note floor 4 of 2-1 contains the enemy tier reference row *inside* the bottom
overlay, so that overlay's interior legitimately contains grey sprite pixels.
It is a good stress case for §5.2.

### 8.3 Invariants

1. **No overlaps.** No two rectangles on the same floor share a pixel.
2. **Border integrity.** For every returned rectangle, every pixel immediately
   outside its border is pure white along the full perimeter.
3. **Clean floors are clean.** Every floor not listed in 8.1/8.2 returns zero
   rectangles and zero warnings, across both fixtures. This is the strongest
   false-positive check available — 21 of 32 floors must come back empty.
4. **Cross-check against hashing.** On 2-1, total covered cells across floors
   3, 4, 6 and 12 should be near **322**, the count of cells on those floors
   whose rows-2..10 hash appears on no overlay-free floor. Report the actual
   number. This is a **cross-check, not an assertion** — the two methods measure
   slightly different things and small divergence is expected. A large
   divergence means one of them is wrong, and that is worth knowing before
   either is trusted.

### 8.4 Acceptance

8.1 exact, 8.2 counts exact, 8.3 invariants 1–3 pass, invariant 4 reported.
No files touched outside scope.
