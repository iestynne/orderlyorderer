# SPEC: The Tower Scrubber

> **Amendment, 2026-09-15 — the tower JSON path moved.** The two
> `data/towers/v0.7-455/` references below (§4's `index.json` check, §8's
> measurement) now read `build/towers/v0.7-455/`, written by
> `npm run parse-towers`. `[F]` Tower JSON is derived, so it is built and
> gitignored rather than committed; `tools/paths.ts` names the location once and
> the code reads it. See SPEC-002's amendment for the reasoning.
>
> `[D]` **Amended, not rewritten** — this spec is frozen and no behaviour
> changed. `TODO.md` §A.3ga is the record.

Status: **draft 2 — ready for implementation**, 2026-08-31.
Game source verified against: `v0.7-455` Lua dump.
Depends on: SPEC-002 (tower JSON), SPEC-004 (simulation), SPEC-006 (`.sav` codec).
Load with this spec: `docs/UI.md`, `DECISIONS.md` D7, D11, D14b-1, D30.

The first interactive slice. Load a `.sav`, pick a record, scrub its undo
history by waypoint. **No editing, no analysis, no route construction.**

`[D]` **This spec holds only what is numerically testable** — constants,
measured facts, interfaces and invariants. How the app behaves and looks is
`docs/UI.md`, which is mutable and written in natural language (D30). Draft 2
moved roughly half of draft 1 there. The two must not overlap: if a statement
would change because you looked at the screen and disliked it, it is not in
here.

Provenance legend used throughout:
- `[F]` **fact — empirically validated**: Lua source, save corpus, or a
  measurement over it. Evidence cited inline.
- `[I]` iestyn said it — recalled from play, not re-verified.
- `[D]` decision — agreed design choice for this app.
- `[P]` proposal — my suggestion, not yet validated.
- `[O]` open — unresolved; implement the stated default and flag it.

**Suggested implementation order:** §3 `Cursor` (pure, testable alone) → §6
assets and fonts → §4 render core → §5 geometry → §2 loading → §7 perf harness.
The panels themselves are built against `docs/UI.md`.

---

## 1. Scope and module layout

Pure modules already exist for everything below the UI. This slice adds one
missing piece of the simulator (§3) and a React app over it.

**Out of scope, deliberately**

| Not in slice 1 | Why |
|---|---|
| Any editing of a route | The point of a small first slice |
| Floor entry thresholds, beatable/unbeatable tint | Needs the visualiser first |
| Smart layout | `docs/UI.md` §6 — wants tuning against real use |
| Click-to-zoom, floor lock | Same |
| Writing saves | `[F]` Not byte-exact from TypeScript. B1, SPEC-006 §6 |
| Orb towers (3-1) | `[F]` SPEC-004 §1 does not model orbs |

```
index.html                 Vite entry
vite.config.ts
src/sim/cursor.ts          [new] SPEC-004 §8 Cursor — pure
src/ui/main.tsx            React root
src/ui/App.tsx             shell: empty state, file load, record pick, panels
src/ui/imagefont.ts        Love2D newImageFont reader (§6.2)
src/ui/render/screen.ts    logical canvas + integer upscale (§4.1)
src/ui/render/atlas.ts     per-tower permutation atlas (§4.3)
src/ui/render/floor.ts     floor bitmap cache, edit-driven invalidation (§4.4)
src/ui/render/left.ts      timeline strip
src/ui/render/trail.ts     route overlay
src/ui/render/right.ts     slider, stack, status, toggles
src/ui/perf.ts             frame-time harness (§7)
tools/atlas/build.ts       build-time sprite + font pack (§6.1)
```

`[D]` The simulation engine stays pure with no UI imports (D7). `Cursor` is
therefore **`src/sim/`, not `src/ui/`** — it is timeline mechanics, not
presentation.

`[D]` One canvas. React owns the chrome — empty state, file input, record list
— and nothing inside the canvas. React must not re-render on scrub.

---

## 2. Loading a save

### 2.1 Tower resolution

`[F]` **The `.sav` payload carries no tower identity.** `SaveFile` is
`{ records: { name, time, keyOrder, entries }[] }` and nothing more
(`src/sav/savefile.ts:35`). `[F]` The corpus is one file per tower, named
`<tower-id>.sav`.

`[D]` Derive the tower id from the filename stem against
`data/towers/v0.7-455/index.json`; if it does not match, ask.

`[P]` A stem-free fallback is cheap: simulate the first record against all 16
towers and take the one that replays without error. Build only if renamed files
prove common.

`[F]` Save location, for the empty state's hint:
`%APPDATA%\LOVE\towers_of_scale\`. `conf.lua` sets
`t.identity = "towers_of_scale"`.

### 2.2 Records

`[F]` Records per file range **10 to 48**; 326 total across 14 towers.

`[D]` A record with orb moves (`hasOrbMoves`) is listed but not selectable.
`[F]` Tower 3-1 only.

### 2.3 Gems

`[D]` Simulate with `gemsOwned: Infinity`; display gems **spent**.

`[I]` Spent is the correct number, not a degraded one: it is what a route is
planned against, since the denominator moves as gems are acquired in other
towers. `[F]` This removes the `crown` file from slice 1's dependencies — B2
still needs it, but for scoring, which is a different quantity. Every corpus
record replays clean under `Infinity`.

---

## 3. `Cursor`

`[D]` Implement SPEC-004 §8 in `src/sim/cursor.ts`:

```ts
class Cursor {
  constructor(t: Timeline)
  readonly index: number
  seekTo(k: number): readonly Addr[]   // cells changed; O(|k - index|)
  readonly cells: Uint8Array
  readonly kills: Int32Array
  readonly player: Player
}
```

It walks `Timeline.steps`, applying `CellEdit.after` forward and
`CellEdit.before` backward. `[D]` It returns the `Addr`s touched, because the
renderer needs exactly that set and recomputing it would be the same walk
twice.

`[F]` **Worst case over all 326 records:** `2-5 / "F 211g 98.3M win H [A]"` at
**1 849 cell edits** and **1 773 waypoint stops**. A full-length seek is bounded
by the first number.

`[F]` **Waypoint parity.** Entries alternate `from, to, from, to, …, current`;
odd indices below the last are actions (`test/sim/oracles.test.ts:57`). Slider
stops are the odd indices plus the final entry — `S + 1` for `2S+1` entries.

`[F]` Collapsing each `(from, to)` pair into one stop is safe. 2 751 of 198 822
position waypoints do carry a cell edit — all pop-up walls reinforcing behind
the departing player (`simulate.ts:126-130`) — but those edits fold into the
following action's state, so displayed state stays correct.

---

## 4. Render core

### 4.1 Logical canvas and integer scale

`[F]` The game renders to `426 × 248`, sets
`setDefaultFilter("nearest","nearest")` globally, and scales by
`s = min(w/426, h/248)` — floored to an integer only under the `pixel_perfect`
setting; `linear_filter` selects the upscale filter (`main.lua:17, 203-232`).

`[D]` Draw at **1×** into an offscreen canvas at the logical layout size, then
blit to the visible canvas at an integer factor with
`imageSmoothingEnabled = false`. `[D]` Mirror both game settings —
`pixelPerfect`, `linearFilter`.

`[D]` Consequence: the visible floor count jumps in steps rather than sliding.
The layout rule is **the largest integer scale at which the §5 minimum still
fits.**

### 4.2 Tint override

`[F]` The game is monochrome apart from the player (D26,
`data/reference/ui/`). `[D]` The renderer takes a **per-cell tint override**
from the start — unused in slice 1, so the threshold analysis drops in without
restructuring.

### 4.3 The permutation atlas

`[D]` At tower load, bake one bitmap per distinct **(entity, value label)**
pair, so a scrub update is a flat `drawImage` with no text rendering.

`[F]` Measured over `data/towers/v0.7-455/`:

| | |
|---|---|
| Distinct tiles, worst tower (2-6) | **160** |
| Distinct tiles, median tower | ~90 |
| Distinct tiles, smallest (EX-2) | 32 |
| Union across all 16 towers | 325 |
| Longest value label | `100k`, 4 characters |

`[D]` Bake per tower, not per union. 160 tiles at 16×16 is a 256×160 atlas.

`[F]` **The tower's own tiles are enough; a seek never needs a key that is not
already baked.** A `CellEdit` only ever produces empty or Reinforced, and every
one of the 16 towers contains at least one cell of each — only Iron is
sometimes absent (10 of 16 towers), and no edit creates Iron. Recorded because
the bake depended on it silently: measured 2026-08-31, and asserted in test.

`[D]` **The player is not in the atlas** — its value changes every waypoint and
it carries an independent tint. Drawn directly.

### 4.4 Floor bitmaps and invalidation

`[D]` One offscreen 240×240 canvas per floor, built once from the atlas.
`[F]` All 325 floors in all 16 towers are 15×15.

`[D]` On a seek, repaint only the cells in the `Addr[]` from `Cursor.seekTo`.
Do not rebuild floors and do not diff grids.

`[D]` No wholesale-rebuild fallback. A cell admits at most **three** edits —
the legal transitions are SPEC-004 §9 invariant 3, and the game rule behind
them is `GAME_MECHANICS.md` §3. So a floor's edit count over an entire route is
bounded at 675 and the fallback would be unreachable. `[F]` The measured
maximum over the corpus is **140** edits on a floor, so the bound is not close
to tight. D11.

`[F]` **Corrected 2026-08-31 (D33).** Draft 2 said two edits and restated the
pop-up chain backwards. It should never have restated it at all: this section
needs a *bound*, not a rule, so it now cites one.

---

## 5. Geometry constants

All logical pixels at 1×. Behaviour that uses these is in `docs/UI.md`.

| | |
|---|---|
| Cell | 16 × 16; an **atlas tile is 16 × 18**, the extra two rows the label overhang |
| Floor bitmap | 240 × 240 (15 × 15 cells) |
| Caption bar | 240 × 18 |
| Tile block, captions on / off | 240 × 258 / 240 × 240 |
| Gap between tiles | 4 |
| Same-row pitch | 244 |
| Row pitch | 262. The caption is not optional (`screen.ts`, `tileHeight`) |
| Tile border | 1 |
| Minimum tiles visible | **3**. `[F]` At 4 the minimum viewport is 1178 wide, so a 1080p window cannot reach 2× and renders everything at 1× |
| Scrub slider width | 16 |
| Action list width | **104** (SPEC-008 §8) |
| Tower stack width | **232** — floors 196 × 64, sheared 2:1, every floor alike (`right.ts`) |
| Control panel total | **348** = 16 + 104 + 232, fixed. The 186 px status column is gone: D27a |

`[F]` **186 is not a taste.** The game's base canvas is 426 wide and a floor is
240, so the game's own status panel is exactly 186, and its layout coordinates
read out of `game.lua:1995-2031`. Reusing both makes the block pixel-identical
to the one the player already reads.

`[F]` Visit `i` is drawn at `x = i × 122 − scroll`, `y = ROW[i mod 2]`.

`[F]` **Ortho projection.** Top and bottom edges horizontal, sides at 45°. The
shear is **pixel-exact** — one pixel of horizontal offset per row of vertical
drop, no resampling. Only the squash resamples.

`[F]` **The squash is a box filter, not a row pick — corrected 2026-08-31.**
Draft 2 proposed an integer ratio "keeping every tenth row". Built that way the
stack was unreadable: dropping nine rows in ten is point sampling, and a 15×15
grid of 16 px tiles is exactly the high-frequency content that aliases worst
under it. `[D]` Each destination pixel is instead the **mean of the source
pixels it covers**, computed once per floor into a cached miniature
(`FloorCache.mini`) and invalidated per floor on edit. That is what a mip chain
converges to for an axis-aligned minification, and Canvas 2D offers neither mip
levels nor anisotropy to ask for it directly — its `imageSmoothingQuality` is
bilinear, which at 10:1 samples a tenth of the rows and aliases just as badly.
`[F]` Because the filter weights fractional coverage, non-integer ratios are
correct, so the stack's dimensions are free to be tuned by eye. The shear then
draws 1:1 rows out of the pre-filtered image and still resamples nothing.

`[O]` The stack's size is being iterated on and is not settled.

`[F]` **Conditional status rows**, matching the game: dark keys are hidden
under `negative_keys` (the counter is meaningless on EX-3); gold appears only
under the `money_system` flag; held item only when holding.

`[F]` **Power is printed precisely, with `.` every three digits.**
`util.power_to_string` is not an abbreviation — it inserts dot separators and
pads to 16 characters (`util.lua:3-22`). `1.284.900`, not `1.28M`. The
`k`/`M`/`G` forms belong to tile labels, a different font and a different job.

`[F]` **2-6 is not loadable in slice 1** — no saves (B3) — so the largest
tower the scrubber can open is 2-5 at 32 floors.

---

## 6. Assets and fonts

### 6.1 The build step

`[F]` 65 sprites at 16×16, 351 KB as loose PNGs, ~20 KB packed as one atlas.

`[D]` `tools/atlas/build.ts` reads `../local/game/v0.7-455/res/sprite/` and
`res/font/`, emits one atlas PNG plus a name→rect JSON into a **gitignored**
build directory, and Vite inlines them into the bundle.

`[D]` Per D14b-1: assets ship **inside** the app, never in the public repo, and
the app offers **no feature that hands them out** — no download, no asset pack,
no documented atlas endpoint. Inlining rather than emitting `/assets/atlas.png`
removes the casual path and avoids the appearance of an endpoint; it is **not**
protection and must not be described as such. `[F]` Extraction from a web app
is easier than unzipping the `.love`, and the exposure delta is nil because
anyone who wants the art already owns the game.

`[D]` No placeholder tileset in slice 1 (D29): the repo does not build
standalone without the game archive.

### 6.2 The bitmap fonts

`[F]` Four PNGs via `love.graphics.newImageFont(path, charset, -1)`
(`main.lua:82-96`). Love2D delimits glyphs by columns of the colour found in
the first pixel column, so a browser reimplementation is direct.

| Font | PNG | Size | Charset | Distinct |
|---|---|---|---|---|
| `FONT_STANDARD` | `VictoriaBold.png` | 883 × 9 | 97 | 97 |
| `FONT_DIGITS` | `digits.png` | 141 × 7 | 24 | **23** |
| `NEG_FONT_DIGITS` | `digits_neg.png` | 92 × 7 | 14 | 14 |
| `FONT_CHALLENGE` | `challenge.png` | 36 × 9 | 4 | 4 |

`[F]` `digits.png`'s charset is `" 0123456789x[].kMG+-vd:x"` — **`x` appears
twice**, so the PNG holds 24 glyph cells for 23 distinct characters. A reader
assuming uniqueness misaligns every glyph after the first `x`.

`[F]` `FONT_DIGITS` has no alphabet, which is why it labels a tile but not a
status row. Only `FONT_STANDARD` renders words.

`[F]` `VictoriaBold.png` is **CC-0** (`res/font/CREDITS.md`, from opengameart),
so it ships with no reliance on the narrow permission.

### 6.3 The unofficial notice

`[D]` Required by D14b-1, shipped from the first version: footer, About panel,
and present in the empty state before anything is loaded. Wording from D14b-1.

---

## 7. Performance harness

`[D]` A `perf test` toggle alternating the scrub position between **history
start and history end on successive frames** — a full-length `Cursor` seek plus
the resulting tile repaints.

`[D]` **Measure `requestAnimationFrame` timestamp deltas, not the draw calls.**
Canvas 2D defers work, so timing around the blits under-reports and shows a
false pass. Report **median and rolling max**, never mean.

`[D]` Report `seek`, `blit` and `frame` separately, so a regression says which
side it came from.

`[D]` **Budget: 5 ms.** `[I]` Target is 60 Hz on machines slower than the
development one, so 5 ms here leaves roughly 3×.

`[F]` Calibration ceiling: 1 849 cell edits, the largest route in the corpus.

`[D]` The harness exists so a renderer swap can be judged rather than argued
about. If Canvas 2D misses the budget, WebGL goes behind the same interface and
this test decides it.

`[D]` **A capture control** writes the logical canvas at 1× to a PNG. Manual
review is the only judge of the parts this spec deliberately does not cover, so
it should be cheap to produce an exact frame.

---

## 8. Verification Contract

```
Run: npm test && npm run typecheck
Report: test summary; PASS/FAIL + actual value per named case;
        invariant results; perf harness median/max; any file touched
        outside src/sim/cursor.ts, src/ui/, tools/atlas/
```

**Named cases with exact expected values**

| Case | Expected |
|---|---|
| Floor grid, every floor of every tower | 15 × 15 |
| Floor bitmap | 240 × 240 px |
| Same-row pitch | 244 |
| Tile block | 240 × 258 |
| Atlas tile count, tower 2-6 | **160** |
| Atlas tile count, tower EX-2 | **32** |
| Distinct tiles, union of 16 towers | **325** |
| Longest value label in any tower | 4 characters — `100k`, `500k`, `250k`, `999G` all occur |
| Glyph count, `VictoriaBold.png` | **97** |
| Glyph cells, `digits.png` | **24** for 23 distinct chars |
| Glyph count, `digits_neg.png` / `challenge.png` | 14 / 4 |
| Slider stops, `1-3 / "C wip 4F"` (353 entries) | **177** |
| Steps in that record | 591 |
| Cell edits in that record | 161 |
| Slider stops, corpus maximum | **1 773** (`2-5 / "F 211g 98.3M win H [A]"`) |
| Cell edits, corpus maximum | **1 849** (same record) |
| Cell-edit chains over the whole corpus | `Original → Gone` **187 069**; `→ Reinforced` **4 662**; `→ Gone` **14** |
| Cell edits on one floor, corpus maximum | **140** |
| Records in a file, corpus range | 10 to 48 |
| Largest tower with a save | 2-5, 32 floors |
| Ortho shear, horizontal offset per row of drop | exactly 1 px |
| Power format, 1284900 | `1.284.900` |
| `SaveFile` fields carrying a tower id | **none** |

**Invariants**

1. **Journal fidelity.** For ~20 sampled `k` per record, `Cursor.seekTo(k).cells`
   equals a fresh `simulate` truncated at `k`. `[F]` SPEC-004 invariant 8; this
   spec is the first thing to run it.
2. **Seek symmetry.** `seekTo(end)` then `seekTo(0)` reproduces the initial
   cells, kills and player exactly. Catches an edit applied but not reversible.
3. **Touched-set exactness.** The `Addr[]` returned by a seek equals the set of
   indices where `cells` differs before and after. A superset is merely
   wasteful; a subset leaves stale tiles on screen, which is the bug this
   catches.
4. **Edit bound.** No cell receives more than 3 edits over any single route,
   and every chain is one of the three below, confirming §4.4's reasoning for
   having no rebuild fallback.
5. **No UI import in `src/sim/`.** A grep, asserted in test. D7.
6. **No game asset in the repo.** No file under `data/`, `src/` or `docs/`
   matches a hash in the game archive's `res/`. D14b.

**Oracles**

1. **Every corpus record loads and scrubs.** For all 326 records across 14
   towers: resolve the tower from the filename, simulate, build the timeline,
   seek to every stop. Zero errors, zero stale tiles.
2. **Perf harness against the ceiling.** The 1 849-edit record, alternating
   start/end: median frame time against the 5 ms budget, rolling max reported.
   `[O]` No expected value yet — the first run sets the baseline, and it is the
   number that decides Canvas 2D versus WebGL.
3. **Font parity.** Each of the four bitmap fonts parses to its expected glyph
   count and its advance widths match the game's `-1` spacing.

**Not verified here.** Everything in `docs/UI.md` — layout, readability,
scrolling feel, colour. `[D]` Judged by manual review against a captured frame
(§7), not by test. This is stated so that a green suite is never mistaken for a
working UI.
