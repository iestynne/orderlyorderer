# SPEC-002 — `res/maps/*` to tower JSON

**Status:** ready to implement
**Docs to load:** `STATUS.md`, `DECISIONS.md`. Load `GAME_MECHANICS.md` only for
§3.5. Do **not** load `EXTRACTION.md` or `SPRITES.json` — the image pipeline is
superseded and is not an input here.
**Scope:** `tools/maps/**`, `test/tools/maps/**`, and the generated output
`data/towers/v0.7-455/**`. Touching anything else is a contract violation and
must be reported.

---

## 1. Why

`res/maps/*` is the complete, authoritative definition of all 16 towers as plain
line-based text: metadata, per-floor 15x15 wall grids, entity lists with values,
and tutorial textboxes as explicit records. It supersedes the map-image
extraction track entirely (`STATUS.md`), and it is the last input the simulator
is waiting on.

This is a **build-time** parser. It runs once against the game archive and
commits derived JSON; the app never reads the archive at runtime (D14e). The
archive is never copied into this repository and never staged (D14b).

## 2. Goal

```
parse-maps  <archive-dir>  <out-dir>   ->  one JSON file per tower, plus index
```

Given `local/game/v0.7-455/`, emit `data/towers/v0.7-455/<tower_id>.json` for
each of the 16 map files, and an `index.json`.

The parser is a pure function over file bytes plus a thin IO shell. No UI
imports (D7).

## 3. Settled questions

Every question below was settled by **reading the game source**, not inferred.
Re-deriving them is out of scope; implement what is written here.

### 3.1 Wall grid encoding — confirmed

Confirmed against the draw code in `leveldata.lua`, which branches on
`walls[x][y]` and selects a sprite:

| Value | Sprite | Name |
|---|---|---|
| 0 | *(no sprite; black fill)* | Empty floor |
| 1 | `wall.png` | Weak Wall |
| 2 | `reinforced_wall.png` | Regular Wall |
| 3 | `iron_wall.png` | Strong Wall |

The observed domain across all 325 floors is exactly `{0,1,2,3}` — no other
value occurs. Treat any other value as a hard parse error, not a warning.

**Storage order is a trap.** The game stores `walls[x][y]`, but reads the file
row by row: each of the 15 lines is one **row** (constant `y`), and the 15
tokens within it run across **x**. A parser that reads lines into `walls[x]`
transposes every floor. This is consistent with D1: `(x, y)`, 1-based, origin
top-left.

### 3.2 Entity vocabulary — 41 defined, 36 used

The authoritative set is the top-level keys of `entitydef.lua`, **not** sprite
filenames (`res/sprite/` holds 72 files, many of them UI and tier variants).
There are exactly 41, which is why `SPRITES.json` has 41 entries.

Five are defined but appear in no shipped map and must still be accepted by the
parser:

```
stairs_up_ex_4   stairs_down_ex_4   rapier   royal_boon1   royal_boon2
```

`stairs_up_ex_4` / `stairs_down_ex_4` pair with the `non_persistent_items_ex_4`
tower flag; no `EX-4` map ships in v0.7-455.

The 36 that do occur:

```
barrier_d barrier_l barrier_r barrier_u battle_gate crown dark_crown dark_door
dark_key dark_rod door elixir enemy enemy_neg feather gate gem_door
golden_claymore golden_dagger hyper_pickaxe key keysmasher light_rod master_key
money money_door orb_change orb_force orb_warp pickaxe popup shield spikes
stairs_down stairs_up vorpal
```

An unknown type is a hard parse error. Silently passing one through would put an
uninterpretable entity into tower JSON and, later, into the simulator.

### 3.3 `util.convert_value_str` — exact port, and there is no rounding

The brief asked for the rounding to be preserved. **There is none.**
`convert_value_str` is exact integer arithmetic; the only lossy step in the game
is in the *display* direction (`power_to_string`, and the `math.floor(pwr/1e9)`
abbreviation in the draw code). Do not import rounding into the parse path.

The algorithm walks the string one character at a time, left to right, over a
running accumulator:

- `G` multiplies the accumulator by 1e9
- `M` multiplies by 1e6
- `k` multiplies by 1e3
- any other character `c` performs `num = num * 10 + Number(c)`

**The actual input domain is much narrower than the algorithm allows.** All
24,468 values in shipped data match `^\d+[kMG]?$`: a mantissa of at most three
digits, followed by at most one suffix, always terminal. There is no `5k5`, no
`2M500k`, no suffix in a non-final position. Every value is therefore
mantissa × 10^{0,3,6,9} with mantissa in 1..999.

| Shape | Count |
|---|---|
| `D` | 15508 |
| `Dk` | 8532 |
| `DM` | 359 |
| `DG` | 69 |

On that domain the accumulator above and an ordinary "parse the digits, apply
the suffix multiplier" implementation agree exactly, so the choice between them
is not load-bearing. Write the accumulator anyway: it is the game's own
function and it is the smaller of the two (D11). What actually protects us is
the shape invariant in §8.5.5, which fires if the developer ever ships a form
outside this domain — at which point the exotic semantics would start to matter
and this section would need revisiting.

The maximum value in shipped data is `999000000000` (`999G`), comfortably inside
IEEE-754 exact integer range. Use `number`, not `BigInt`.

### 3.4 Enemy tier is derived, never stored

The map stores only `type` and `value`. `entitydef.enemy.get_spr` selects the
tier by decade of `value`, and `entitydef.enemy_neg.get_spr` uses **identical**
thresholds:

| Tier | Condition | Sprite |
|---|---|---|
| 1 | `value < 10` | slime |
| 2 | `>= 10` | bat |
| 3 | `>= 100` | snake |
| 4 | `>= 1e3` | scorpion |
| 5 | `>= 1e4` | skeleton |
| 6 | `>= 1e5` | zombie |
| 7 | `>= 1e6` | skeleton_warrior |
| 8 | `>= 1e7` | armor |
| 9 | `>= 1e8` | warlock |
| 10 | `>= 1e9` | demon |

So `tier = clamp(1 + floor(log10(value)), 1, 10)`, with `value = 0` giving 1.

**A negative enemy's value is stored positive**; the sign lives in the type
(`enemy_neg`). This is why the character domain in §3.3 contains no `-`: a
leading `-` would in fact crash `convert_value_str`.

**Do not write tier into tower JSON.** It is a pure function of `value` and
belongs in the simulator and the renderer. Storing it would create a second
source of truth that can drift.

### 3.5 Textbox coordinates are pixels, not cells

Entities use 1-based **cell** coordinates. Textboxes do **not** — the draw code
passes `x, y, w, h` straight to `love.graphics.rectangle` with no cell
transform, so they are pixels in the 248x248 map draw space.

The game also never converts them to numbers; it stores the regex captures as
strings. Our JSON stores them as numbers.

`||` in the text encodes a newline. Decode it on parse.

Note this is the mechanism SPEC-001 tried and failed to recover from pixels, and
it is why D12 ("hidden cells are Strong Wall") is now a statement about the
*image* pipeline only. Cells under a textbox are fully specified here.

## 4. File format

All 16 files are LF-terminated UTF-8, no BOM, with a single trailing newline.
Tokenisation is whitespace splitting (the game's `get_tokens` matches runs of
printable non-space characters), which incidentally makes it CR-tolerant — but
lines read whole, such as floor names and textbox lines, are **not** tokenised
and would retain a `\r`. Reject CRLF input rather than trying to cope.

```
name                       "1-1: Training Tower"
crowns_needed              integer
challenge                  raw string, e.g. "*"
size                       raw string, e.g. "**"
flags                      bit 1 negative_keys
                           bit 2 uncapped_elixirs
                           bit 4 non_persistent_items_ex_4
start_power                integer
start_floor start_x start_y    one line, three tokens
grades                     6 lines: C, B, A, S, star, overscore
floor_count
  per floor:
    name                   "B5F: Dark Crown"
    bgm
    15 lines of 15 tokens  one row per line; token k is x=k
    entity_count
      "x y type value_str"     x,y 1-based cells
    textbox_count
      "x y w h text"           pixels; "||" is a newline
```

**Floor order is bottom-to-top**, so file index == floor number from the bottom
(D1) and no conversion is needed. The floor *name* is a display label and is
**not** the index: tower 2-1 opens with `B2F` and `B1F`, so its `1F: Economics
101` is floor **3**. Index floors by position; treat the label as opaque text.

## 5. Output

Keep the JSON close to the source structure. Do not invent abstractions — the
schema is deliberately open until a simulator exists and shows what it needs.

```ts
export interface TowerJSON {
  tower_id: string;       // map filename, e.g. "2-1"
  game_version: string;   // from the archive's .version file, e.g. "v0.7-455"
  content_hash: string;   // see 5.1
  generator: string;      // "orderlyorderer/tools/maps@<version>"

  metadata: {
    name: string; crowns_needed: number;
    challenge: string; size: string;
    flags: number;
    computed_flags: {          // decoded from flags, omitted when false
      negative_keys?: true; uncapped_elixirs?: true;
      non_persistent_items_ex_4?: true;
    };
    start_power: number;
    start_floor: number; start_x: number; start_y: number;
    grades: [number, number, number, number, number, number];  // C B A S star overscore
  };

  floors: Array<{
    name: string; bgm: string;
    walls: number[][];        // walls[y][x], 0-based arrays, 15x15, values 0..3
    entities: Array<{ x: number; y: number; type: string;
                      value_str: string; value: number }>;
    textboxes: Array<{ x: number; y: number; w: number; h: number; str: string }>;
  }>;
}
```

Retain `value_str` alongside `value`. It is the source of truth for round-trip
(§8.1) and it is what the game prints on the tile.

`walls` is stored `[y][x]` — the file's own row-major order — with the `[x][y]`
transpose done at the boundary if the simulator wants it. Document the order at
the type. Getting this backwards is the single most likely defect in this spec,
and a 15x15 grid is not self-evidently transposed by inspection.

### 5.1 `content_hash`

`content_hash` is the lowercase hex **SHA-256 of the source map file's exact
bytes**.

D9 identifies a tower by its ID plus a content hash of its grid. Hashing the
source bytes rather than our own JSON is a deliberate refinement: the JSON shape
is explicitly unstable (§5), so a hash over it would change on every schema edit
and would report a tower-content change that did not happen. Hashing the input
makes the hash track the *game's* data, which is what version detection needs.

**This refines D9 and requires a `DECISIONS.md` amendment in the same commit**
(D2). The expected values for v0.7-455 are pinned in §8.2 and are themselves the
diagnostic test D18 asks for.

## 6. Implementation notes

**Less code is better** (D11). This is a line-oriented reader over a sequential
cursor; it wants a small `readLine()` closure and a loop, not a class hierarchy
or a streaming parser. Where two implementations satisfy this contract, take the
smaller one, and refactor toward it as part of the task.

That is a constraint on the solution, not a licence to drop cases. Every named
value in §8 must still pass.

**Fail loudly.** Any of the following is a hard error naming tower, floor index
and line number — never a warning, never a default:

- a wall value outside `0..3`, or a row that is not 15 tokens;
- an entity type not among the 41 in §3.2;
- an entity line without exactly 4 tokens;
- a `value_str` not matching `^\d+[kMG]?$` (§3.3) — including any form the
  accumulator would happily consume, such as `1k5`. Stopping is correct here:
  such a value means the input domain has changed, and a human needs to decide
  whether the game's accumulator semantics were what the author intended before
  we silently encode them into tower data;
- a textbox line that does not match `(%d+) (%d+) (%d+) (%d+) (.+)`;
- trailing non-whitespace content after the last declared floor;
- CRLF line endings.

The parser runs once at build time against 16 known-good files. There is no
scenario where guessing beats stopping.

## 7. Non-goals

- The simulator, reachability, or any rules evaluation.
- Enemy tier, threshold analysis, or any derived field (§3.4).
- Sprite lookup, image decoding, `SPRITES.json`.
- A stable public schema. §5 is provisional by design.
- Reading `game.lua` mechanics — that is the simulator's spec, not this one.
- Any tower outside `res/maps/`, and any EX-4 content.

---

## 8. Verification Contract

```
Run: npm test -- maps

Report:
  - test summary (passed/failed/total)
  - PASS/FAIL + actual value for every named case in 8.1 - 8.5
  - the round-trip result per tower (16 lines), and first divergence if any
  - diff stat (files changed, +/- lines)
  - any file touched outside tools/maps/, test/tools/maps/, data/towers/
```

### 8.1 Byte-exact round trip — the primary oracle

An emitter mirroring `LevelData:save()` must reproduce **all 16 source files
byte for byte**. This has been verified to hold: 16/16.

This works because the shipped files were themselves written by that function.
Note its exact quirks: every wall token is followed by a space, **including the
last on each row**, so rows end `"... 0 \n"`; entity and textbox lines are
space-joined with no trailing space; the start-position line is `"f x y"`.

Round-trip is the strongest available check and subsumes most field-level
assertions: it proves nothing was dropped, reordered, or coerced. It is the same
oracle that validated the savegame codec.

**Expected: 16/16 byte-identical.**

### 8.2 Tower inventory (exact)

16 towers, **325 floors total**, **24468 entities**, **88 textboxes**.

| Tower | Floors | Name | `content_hash` (first 12) |
|---|---|---|---|
| 1-1 | 13 | Training Tower | `44efdab5d508` |
| 1-2 | 14 | Tower of Might | `3dd685d21a6d` |
| 1-3 | 15 | Tower of Traps | `8ec84c75d114` |
| 1-4 | 17 | Miner's Obelisk | `a73652236866` |
| 1-5 | 3 | Tiny Tower | `10c106b8d5a6` |
| 1-6 | 25 | Adventurer's Exam | `ff6703ea4d39` |
| 2-1 | 14 | Tower of Loot | `b2258eb1c0d0` |
| 2-2 | 19 | Artificer's Task | `c1b025dcbc65` |
| 2-3 | 18 | Thieves' Guild | `7f826d06afe1` |
| 2-4 | 30 | Descent into Abyss | `f7b528c226c7` |
| 2-5 | 32 | The Orderly Order | `00b4be2592a4` |
| 2-6 | 75 | Golden Dojo | `52c0bdc9016f` |
| 3-1 | 15 | Mystic Academy | `26250e59bef0` |
| EX-1 | 10 | Jam Tower | `c275bdfa1fd7` |
| EX-2 | 10 | Sorcerer's Tribute | `273ef79cde25` |
| EX-3 | 15 | Lockpick Battle | `79179048a140` |

`game_version` is `v0.7-455` for every tower, read from the archive's `.version`
file (D14c-1) and never hardcoded.

### 8.3 Named cells (exact, 1-based)

| Tower | Floor | Floor name | Cell | Expected |
|---|---|---|---|---|
| 2-1 | 3 | `1F: Economics 101` | (12,7) | `stairs_up` |
| 2-1 | 3 | `1F: Economics 101` | (10,10) | `stairs_down` |
| 1-3 | 3 | `1F: Entrapment` | (4,11) | `popup`, value 0 |
| 1-3 | 3 | `1F: Entrapment` | (6,8) | `popup`, value 0 |
| 1-3 | 3 | `1F: Entrapment` | (7,8) | `key`, value 0 |
| 1-5 | 1 | `A small step` | (3,13) | `spikes`, value 10 |

> **The 2-1 pair is corrected from the brief.** It gave `stairs_up (11,6)` and
> `stairs_down (9,9)`; the file has `(12,7)` and `(10,10)` — each exactly +1/+1,
> i.e. the brief's values are 0-based, almost certainly transcribed from the
> map-image pipeline. The 1-3 and 1-5 values in the brief were 1-based and
> correct as given. Values above are as verified against `res/maps/`.

### 8.4 `convert_value_str` (exact)

Every case below is a form that actually occurs in shipped data (§3.3).

| Input | Expected | Why it is here |
|---|---|---|
| `"0"` | `0` | the value the draw code suppresses |
| `"5"` | `5` | bare mantissa, the commonest shape |
| `"999"` | `999` | largest bare mantissa |
| `"10k"` | `10000` | `k` suffix |
| `"255k"` | `255000` | three-digit mantissa with suffix |
| `"1M"` | `1000000` | `M` suffix |
| `"999G"` | `999000000000` | largest value in shipped data |

### 8.5 Invariants

1. **Wall domain.** Every wall value across all 325 floors is in `{0,1,2,3}`,
   and every row has exactly 15 tokens.
2. **Closed vocabulary.** Every entity type used is one of the 41 in §3.2.
   Report the used set; expected size **36**, with exactly the five in §3.2
   absent.
3. **Start cells are open.** For every tower, `walls[start_y][start_x]` on
   `start_floor` is `0`. Verified to hold for all 16. A failure means either the
   transpose in §3.1 is wrong or the floor indexing in §4 is. This is the
   cheapest available detector for both, and both are the defects most likely to
   pass unnoticed.
4. **No trailing content.** After the last declared floor, exactly one empty
   line remains in every file.
5. **Value shape.** All **24468** `value_str` values match `^\d+[kMG]?$`, with
   the shape census `D` 15508, `Dk` 8532, `DM` 359, `DG` 69, and no mantissa
   longer than three digits. This is the invariant that makes the narrow
   implementation in §3.3 safe; if it ever fails on new game data, §3.3 must be
   revisited before the parser is trusted.

### 8.6 Acceptance

8.1 is 16/16 byte-identical; 8.2, 8.3 and 8.4 exact; 8.5 invariants 1-5 pass.
No files touched outside scope.
