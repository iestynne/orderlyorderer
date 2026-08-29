# SPEC-006 — `.sav` codec in TypeScript

Status: **implemented**, 2026-08-28.

**Docs to load:** `SAVE_FORMAT.md`. That document is canonical and carries the
format; this spec carries only the port's contract and its oracles. Do not load
`GAME_MECHANICS.md` or the map specs.

---

## 1. Why

SPEC-004's two primary oracles — the replay sweep and the hi-score check — both
need to read `.sav` files from TypeScript. The only codec was
`tools/luajit_buffer.py`, so `npm test` could not run the simulator's primary
regression net at all.

Three options were weighed (SPEC-004 §11). This is the port, chosen because it
is the only one that leaves the primary oracle runnable by the ordinary test
command, and because the Python codec then becomes a differential reference
rather than a dependency.

## 2. Scope

Pure modules, no filesystem access (D7):

| Module | Holds |
|---|---|
| `src/sav/buffer.ts` | The LuaJIT `string.buffer` serializer: `.U` prefix ints, tags, parse and emit |
| `src/sav/savefile.ts` | The `.sav` container: name → record, `TOSSAVE\0` + zlib, both record shapes |
| `src/sav/route.ts` | A record's undo history read as a SPEC-004 `Waypoint[]` |
| `src/sav/score.ts` | The player's `score` / `crown` files |

**Out of scope:** writing saves the game will load. See §6.

## 3. What the port must preserve

`[F]` All from `SAVE_FORMAT.md`, restated here only where the port can get them
wrong:

- **`0xFF` is a reserved lead byte**, so the two-byte `.U` form tops out at
  8159 (`0x1FDF`), not 8415. Emitting `0xFF` as a two-byte lead produces data
  that decodes as a 32-bit length. This was a real bug in the first
  implementation and is the single most likely defect to reintroduce.
- **Tag `0x0C` is the 1-based array form** and stores Lua's length *plus one*,
  so it holds `n - 1` elements. `0x0A` is the 0-based form and stores exactly
  `n`.
- **Every documented-but-unseen tag must be rejected loudly**, not skipped.
  `0x0F` (string dict entry) is the one to watch: if the game ever passes a
  `dict` option to `buffer.new`, common string keys become one-byte indexes and
  a permissive parser silently misreads them.
- **Both record shapes occur in one file.** A bare blob (older saves, never
  migrated) and a `{time, data}` table. Key order within the table is not
  fixed — both orders occur — so parse by key and record the order seen.
- **Strings are bytes, not text.** Save names are user-chosen and blobs are
  binary; the port uses latin-1 so every byte round-trips.

`[D]` Numbers are read as `number`, not `bigint`. Every value in every shipped
save is an integer well inside float64's exact range, and the parser asserts
integrality rather than assuming it.

## 4. The route reading

`[F]` `SAVE_FORMAT.md` §3: a record's entry list is `2S+1` long — S pairs of
`(from, to)`, then the player's live position.

`[D]` **Every entry becomes a waypoint, and nothing distinguishes them.** The
`from` entries resolve to passive walks, or to no-ops when the player is already
standing there; the `to` entries are the actions. SPEC-004 §4 already treats a
waypoint equal to the current position as a no-op, so the pairing needs no
special handling and the reader stays four lines long.

`[F]` Entry arity is usually 3 but **not always**: orb moves in tower 3-1 add
two more values. The reader exposes `hasOrbMoves()` so a caller can skip what
SPEC-004 §1 deliberately does not model, rather than the reader guessing.

## 5. Verification Contract

```
Run: npm test
Report: test summary; PASS/FAIL per named case; the payload round-trip count;
        the replay sweep and hi-score results; diff stat
```

### 5.1 Payload round trip — the primary oracle

For every record in every `.sav` in the corpus: decompress the blob, parse the
payload, re-emit it, and assert the bytes are identical.

**This is the right subject.** It isolates *our* codec from zlib, which is a
library parameter question and not part of this format.

**Expected: 326/326 exact**, over 14 towers.

### 5.2 The 2S+1 rule

Every record's entry count is odd. **Expected: 326/326.**

### 5.3 Cross-check against the Python codec

`tools/luajit_buffer.py` is the verified reference. For a sample of records,
assert both implementations produce identical entry lists. `[D]` Kept as a
tool-level check rather than a test, so `npm test` needs no Python.

### 5.4 Downstream oracles

The port's real proof is that SPEC-004's oracles run on it and pass:
**326/326 records replay with zero errors**, and **14/14 hi-scores match
exactly**. A codec that misread a coordinate would not produce a legal route,
let alone the right final power.

## 6. Known limitation — writing is not byte-exact

`[F]` **Node's zlib reproduces only 82 of 326 of the game's compressed
streams**, at any level 1-9. The payload underneath is byte-identical in all
326 cases, so this is entirely the deflate implementation: Love2D's zlib and
Node's make different choices, while Python's `zlib.compress` matched (which is
why the Python codec's round trip was byte-exact and this one's is not).

Consequences:

- **Reading is unaffected.** Every oracle in §5 passes.
- **Writing a save the game will load is unaffected in principle** — the game
  inflates the stream, and any valid deflate stream inflates correctly. What is
  lost is the ability to prove a write correct by byte-comparison with an
  original, which is how D17 and the pop-up encoding question were settled.
- `[D]` **Therefore save *writing* stays on the Python codec for now.** When it
  moves, this spec needs a matching-deflate story first — most likely a
  different deflate implementation, tested against the corpus the same way.

`[D]` This limitation is recorded rather than worked around, because the thing
it would silently cost us — byte-exact comparison against a hand-played save —
is the technique that settled the only encoding question we have had.
