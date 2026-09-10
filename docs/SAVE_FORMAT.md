# SAVE_FORMAT.md

Towers of Scale `.sav` files. Canonical. Code is derived from this document.

**Data source:** app version **v0.7-455**. Reverse-engineered from `2-1.sav`
(Tower of Loot) and `1-5.sav` (Tiny Tower). Verified across both.

---

## 1. Coordinate and index conventions

| Concept | Convention |
|---|---|
| Cell coordinates | `(x, y)`, **1-based**, origin **top-left** |
| Floor index | **1-based from the bottom** of the tower (1 = lowest floor) |
| Stored triple | `(floor, x, y)` |

For Tower of Loot (2-1), floor 1 = B2F, floor 2 = B1F, floor 3 = 1F.

This matches the map export panel order: panel 0 (top-left of the export
image) is always the **lowest** floor, and `save_floor = panel_index + 1`.

---

## 2. Container

**The format is the LuaJIT `string.buffer` serializer**, confirmed by the
developer. It is fully documented:
<https://luajit.org/ext_buffer.html> — "Serialization Format Specification".

**Read the spec rather than trusting this section.** What follows is the subset
Towers of Scale uses, recorded here so a reader knows which parts matter. The
whole of it was independently reverse-engineered before the source was
identified, and the derivation matched the spec exactly — but the spec is
authoritative and covers cases we have not yet seen.

### Prefix-encoded unsigned (`.U`)

Used for every count: string length, array length, table size.

```
n <= 0xDF             -> one byte
0xE0 <= n <= 0x1FDF   -> (0xE0 | ((n-0xE0)>>8 & 0x1F)), ((n-0xE0) & 0xFF)
n >= 0x1FE0           -> 0xFF, then n as 32-bit little-endian
```

The third form matters: `0xFF` is a reserved lead byte, so the two-byte form
tops out at **8159**, not 8415. An encoder that emits `0xFF` as the first byte
of a two-byte count produces data that decodes as a 32-bit length. This was a
real bug in our first implementation.

### Tags used by Towers of Scale

| Tag | Meaning |
|---|---|
| `0x07 <8 bytes LE>` | double |
| `0x08` | empty table |
| `0x09 <h.U>` | hash table, `h` key/value pairs |
| `0x0C <a.U>` | **1-based** array, `a-1` elements |
| `(0x20+len).U` | string, then `len` bytes |

`0x0C` storing `a-1` elements is not an inconsistency: it is the *1-based array*
encoding, where `a` is Lua's array length plus one. `0x0A` is the 0-based form
and stores exactly `a`.

### Tags not yet seen, which a parser must still reject loudly

`0x00` nil, `0x01` false, `0x02` true, `0x06` int32, `0x0A`/`0x0B`/`0x0D` other
table forms, `0x0E` metatable dict entry, `0x0F` **string dict entry**,
`0x10`/`0x11` int64/uint64, `0x12` complex.

`0x0F` is the one to watch: if the game ever passes a `dict` option to
`buffer.new`, common string keys become one-byte indexes and a naive parser
silently misreads them.

### File layout

```
0x09 <n_pairs>                     top-level table
  <string key> <value> ...         repeated
```

### File layout

The top level is a table mapping **save name -> value**, one pair per save. The
count in the header is therefore exactly the number of saves.

A value takes **one of two shapes**, and both occur in the same file:

```
A)  <string: blob>                        bare blob, no timestamp
B)  0x09 0x02
      <string: "time"> <string: "YYYY-MM-DD HH:MM">
      <string: "data"> <string: blob>
```

Shape B was introduced by a later game version and older saves were never
migrated. Confirmed by the developer.

**Verified:** a full parse/emit round trip reproduces all seven available `.sav`
files byte-for-byte.

A writer must **match the shape of the record it replaces**. Key order within
shape B is not fixed; `time` before `data` and `data` before `time` both occur,
so parse by key, not position.

`blob` = literal ASCII `TOSSAVE\0` (8 bytes) followed by a raw **zlib** stream
(`78 9C`).

Save names observed: user-chosen strings, plus reserved `AUTOSAVE1`…`AUTOSAVE5`,
`AUTOSAVE_HISCORE`, `AUTOSAVE_RESTART`, `AUTOSAVE_EXIT`.

---

## 3. Payload

Decompressing the blob yields:

```
0x0C <n>                           outer array, n-1 entries
  0x0C 0x04 0x07<f64> 0x07<f64> 0x07<f64>     repeated: (floor, x, y)
```

All values are float64 holding integers.

### The 2S+1 rule

The entry list is **not a movement path**. It is:

> **S pairs of `(from, to)` — one pair per move the auto-pather cannot
> reproduce — followed by the current position.**

**Authoritative rule, from `entitydef.lua`:**

> "if undo_store function is missing then it is considered to be a neutral
> entity, with no need to record the interaction into the undo queue"

An interaction is recorded **iff the entity defines `undo_store`**. That is the
whole rule. Player position, inventory and power are saved by default; the
`undo_store` return value carries any *extra* state the undo needs.

This settles every case we tested empirically, and explains the asymmetry that
defeated two of our hypotheses:

| Entity | `undo_store`? | Recorded |
|---|---|---|
| `popup` | yes | on the step **onto** it |
| `spikes` | yes | on **every** entry — hence the same pair appearing twice in one route |
| `barrier_u/r/d/l` (one-way) | **no** | never |
| `stairs_up` / `stairs_down` | **no** | never |

The one-way walls additionally carry `ignore_illegal_on_save = true`, which is
why a replay tolerates a route that crosses one.

This framing was arrived at by testing two competing encodings of the same route
against the game; see §5.1.

Therefore `len(entries)` is **always odd**, equal to `2S + 1`.

Verified: all 16 records in `1-5.sav` have odd length (579, 549, 263, 569, 467,
415, 563, 579, 469, 473, 3, 15, 15, 265, 483, 579).

### What is NOT stored

- **The tower's starting position.** Implicit; the first entry is already the
  result of the first recorded transition.
- **The tower's initial state.** Nothing about map contents is in the file. Map
  content must come from the map export (see `NOTES_map_extraction_deferred.md`).
- **Non-state-changing movement.** Reconstructed on load by the auto-pather.
- **Redo history.** Only undo history is persisted.
- **Which state changed.** Derivable by replay; see §5.

### Worked example — `2-1.sav`, save `5-move-test`

```
(3,5,9) (3,5,8) (3,5,8) (3,6,8) (3,7,8) (3,8,8) (3,8,8)
```

| pair | from → to | event |
|---|---|---|
| 1 | (5,9) → (5,8) | 5-gold bag collected |
| 2 | (5,8) → (6,8) | 5-gold gate opened |
| 3 | (7,8) → (8,8) | 10-gold bag collected |
| — | current (8,8) | |

The move from (6,8) to (7,8) is absent: nothing changed.

---

## 4. The auto-pather

Movement between consecutive recorded transitions is reconstructed by the
game's pather on load. Established behaviour:

- **It never routes through a state-changing tile.** Confirmed by the game's own
  design and by the fact that state-changing tiles are always recorded. This is
  what makes route reconstruction unambiguous: any state-neutral path produces
  an identical outcome, so the pather's tie-breaking is unobservable and does
  **not** need to be replicated.
- **It is multi-floor.** It routes across stair connections, including one-way
  ones (a Stairs Up with no matching Stairs Down).
- **One-way walls are gated behind a user setting.** A checkbox controls whether
  the pather may route through them. Believed to be a fallback: a regular path
  is attempted first, one-ways used only if none exists. **Unverified.**

### Our pather

A flood fill from the current position over state-neutral tiles; the target is
reachable iff the fill reaches it. When one-way pathing is enabled, include
one-way tiles in the fill but do not propagate *into* a one-way tile from a
direction its arrows forbid.

---

## 5. Replay semantics

State is a pure function:

```
state(k) = f(initial_tower_state, transitions[0..k])
```

There is **no RNG** and no order-dependent float arithmetic, so replay is
deterministic. Undo does not require inverting a state change — the game can
recompute (and in practice caches states in memory). Consequently mechanics are
**not** constrained to be locally invertible.

### A transition may change more than one tile

`applyTransition` must return a **set** of changed cells, not one cell.

- **Battle Gate** — defeating an enemy decrements every Battle Gate on that
  floor; one may reach zero and open, at arbitrary distance from the move.
- **Pop-Up Wall + pickup** — stepping off a pop-up wall onto a gold bag changes
  two tiles in a single move (wall converts on exit, bag consumed on entry).

### 5.1 Pop-Up Walls — verified

An earlier hypothesis here was **wrong**: that the recorded pair is the move
*off* the tile. Both encodings of the same route were generated and loaded:

| Encoding | Result |
|---|---|
| A — record the exit move | Loads, produces a valid final state, but undo/redo differs from play |
| B — record the entry move | Loads, and undo/redo is identical to playing the route |

Playing the route by hand and diffing the triples settled it. The game's own
save is **identical** to encoding B:

```
(3,3,11) (3,4,11) (3,5,8) (3,6,8) (3,6,8) (3,7,8) (3,7,8) (3,7,7) (3,7,7)
```

Two lessons worth keeping:

1. **A successful load does not mean the encoding is canonical.** Encoding A was
   accepted and reached a correct final state. The game tolerates more than one
   encoding of the same route. Only a diff against a hand-played save proves
   equivalence.
2. The wall's conversion on exit is **implicit** — derived by replay, never
   recorded.

---

### 5.2 One-way walls — verified, and they are NOT recorded

From a hand-played route on 1-5 (`1-5_ONE-WAY-ENCODING-2.sav`), the player
crossed the north-facing one-way at `(1,4,11)` twice.

**First crossing** — transition 17, `(4,11) -> (4,10)`, recorded. But `(4,10)`
held a Negative Bat, so the transition was state-changing anyway. Confounded.

**Second crossing** — decisive. Transition 25 ends at `(3,12)`; transition 26
begins at `(4,10)`. The floor map shows `(3,11)` and `(5,11)` are Regular Walls,
so the **only** route between row 12 and row 10 in that column is through the
one-way at `(4,11)`, and every alternative round the left edge is blocked by
live enemies the pather will not touch. By then `(4,12)` and `(4,10)` had both
been cleared, so the crossing changed nothing.

**No pair was recorded for it.** Neither the entry nor the exit.

Conclusion: **one-way traversal is never recorded.** Transitions 11 and 17 in
the earlier run were recorded solely because their destination cells held
Negative Bats.

Two consequences:

1. **The pather routes through one-way walls during replay**, and must, or this
   save could not replay at all.
2. **The one-way pathing setting is therefore route metadata.** A player with it
   disabled may be unable to replay a route that depends on a one-way crossing.
   It must travel with any shared route. Confirmation pending — see
   `TODO.md` B5b.

A third, non-correctness consequence worth designing around: because the
crossing is not recorded, replay is free to take a *different* route from the
one the player walked, if the map has since opened up. The final state is
identical, but the player sees their route replayed differently from how they
played it. Our own editor should not inherit that surprise.

## 6. Writing save files

Verified working: a record was constructed from scratch and re-parsed
byte-correctly (`INVALID-TEST` in `1-5.sav`).

### Procedure

1. Build the payload: `0x0C, len(entries)+1`, then each triple as
   `0x0C 0x04` + three `0x07`+float64-LE.
2. `blob = b"TOSSAVE\0" + zlib.compress(payload)`.
3. Encode `blob` as a string using the count encoding above. **No length limit
   applies** — the 2-byte count form reaches 8383 bytes, which covers any real
   route.
4. Wrap in the shape matching the record being replaced (A or B above).
5. Parse the whole file, substitute the record in the top-level table, and
   re-emit. Do **not** splice bytes: structural editing is what guarantees every
   count stays consistent.
6. Replacing keeps the save count unchanged. Appending has not been tested and
   would require the header count to be correct — prefer replacement.

### Implementation hazards

- **Never round-trip binary through `str`.** UTF-8 re-encoding silently expands
  bytes > 0x7F and corrupts the blob and its length prefix. This bug was hit and
  caught only by the round-trip re-parse.
- Always re-parse the whole file after writing and compare every untouched
  record against the original.

### Validation invariants for anything we generate

```
len(entries) is odd
every to[i] is orthogonally adjacent to from[i]
a state-neutral path exists from to[i] to from[i+1]
a state-neutral path exists from the tower start to from[0]
```

---

## 6a. Reference saves

The strongest available check on the writer. Each reference case is stored as a
triple:

```
<tower>.<CASE>.manual.sav      played by hand in game
<tower>.<CASE>.expected.json   the triples, extracted
<tower>.<CASE>.md              route description, mechanics exercised
```

Two levels of comparison, both required:

1. **Triples** — generate the route from its description and assert an exact
   match against `expected.json`. Tests assert against the JSON, never against
   the `.sav`, so a parser regression cannot hide by breaking both sides
   identically.
2. **Bytes** — compare the generated and manual saves **byte-for-byte at the
   serialized key/value level**. This validates the serializer itself, not just
   the payload, and builds up incrementally as cases are added.

Coverage to build toward, one mechanic per case: pop-up entry (have it), one-way
wall traversal, a Battle Gate opening at a distance, a held item that changes an
outcome without changing power, a multi-floor route across a one-way stair
connection, and one full tower completion as an end-to-end check.

## 7. Open questions

1. **Orb entries (5-tuples).** What do the two extra values mean? Needs a save
   from tower 3-1. Now answerable directly from the game source.
2. **There is no tower versioning in the save data.** Confirmed by the
   developer, and not currently planned. Our own tower content hash (D9) is
   therefore required, not merely prudent — nothing in a save identifies which
   version of a tower it was recorded against.
3. Behaviour on loading an invalid transition (non-adjacent, or unreachable
   `from`): loud error or silent divergence? Test save `INVALID-TEST` built.
4. Does traversing a one-way wall produce a recorded pair? The §3 framing
   predicts **yes**, by the same argument as the Pop-Up Wall. If no pair is
   recorded, the checkbox setting is route metadata and must travel with shared
   routes.
6. Is there a definitive list of state-changing tiles?

## 8. Writing into the player's own file

`[D]` Export **injects**: the player's `.sav` gains one record and keeps every
other byte. `src/sav/inject.ts` works on the top-level table and never decodes a
record it did not author — the alternative, `parseSaveFile` then `emitSaveFile`,
rewrote **9 823 of EX-1's 10 031 bytes** because Node's zlib reproduces only 82
of the game's 326 streams (§6).

`[F]` Measured over all 14 corpus saves: byte 0 unchanged, byte 1 (the record
count) changed, bytes 2..EOF present verbatim at their own offsets, the new
record appended. `test/sav/inject.test.ts`.

### The game's name rules

`[F]` `save_manager.lua:327-352`. At most **24** characters, from exactly:

```
A-Z a-z 0-9 space ! # $ % & ' ( ) + - @ [ ] ^ _ ` { } ~ .
```

`[F]` **No colon**, so `ORD:` is a namespace the game's own keyboard cannot
enter. Verified in game (`data/saves/tests/EX-1.ORD-COLON.md`, 2026-09-09): a
colon displays, sorts, loads and deletes normally, and because `:` is 0x3A —
above `9`, below `A` — injected rows gather at the bottom of the save menu.

`[F]` **Timestamps are local.** `save_manager.lua:575` is `os.date` with no `!`.

`[F]` **No record cap exists.** 1-6 holds 48, which is how many that file has.

### The game keeps its own backup, and we must not touch it

`[F]` Before every write the game copies `<tower>.sav` to `<tower>.sav.bak`
(`save_manager.lua:457`); on load, if the main file will not decode, it falls
back to that copy and sets the corrupt one aside as `.err` (`:131-155`). So the
player already has one generation of recovery, and **anything that writes
`.bak` destroys it**. Nothing here writes into that folder at all, so the rule
costs us nothing — but it is the reason a backup must never be named for the
file it protects.

### The browser cannot reach the save folder

`[F]` **Chromium refuses `%APPDATA%`**: "can't open this folder because it
contains system files". Verified by iestyn, 2026-09-09. There is no browser
route to `%APPDATA%/LOVE/towers_of_scale/savestates/`, so the app never opens
the file the game reads.

`[D]` Export therefore writes only into folders it created, inside a
`tos_backups` folder the player makes and picks:

```
tos_backups/
  savestates_2026-09-10/              the player's own copy, made in Explorer
  savestates_ORD_EXPORT_2026-09-10/   ours, named for the copy it came from
```

`[D]` **The export folder is named for the snapshot it was built from**, so a
new snapshot starts a new export folder rather than quietly joining an old one,
and which came from what survives being looked at a week later. `[D]` **Only
the towers actually exported are copied in**, so copying the folder across
cannot roll back a tower that was merely played. `[D]` A second route **joins**
the file already there rather than rebuilding from the snapshot — sound exactly
as long as the game has not run since the snapshot was taken, which is why a
snapshot that is not the most recent in `tos_backups` is flagged.

`[D]` **No staleness detection.** The app cannot see the master folder, so any
check it ran would prove less than it implied, and an over-promised safety
property is worse than an absent one. `[I]` iestyn, 2026-09-10: the protocol is
offered, the player is in charge of backups and of deploying, and anticipating
how others will want to use this is a fool's errand short of handing it out and
asking them.

`[D]` The export folder is a **sibling** of the copy, never inside it — the API
cannot reach a picked folder's parent, which is why the player picks the
container; and a directory inside `savestates` becomes a 1-byte `.sav` once
Steam Cloud sees it, so a nested one would plant a junk save on the next
restore. `[D]` A copy whose folder name holds no date is **refused**: it is the
only thing that tells a backup from a second copy of what is about to change.
`[I]` iestyn: the filesystem is more reliable than any code either of us would
write for this, and a copy he performs is one he can see.

### Steam Cloud

`[F]` iestyn's experiments, 2026-09-09, on `%APPDATA%/LOVE/towers_of_scale/`:

| Test | Result |
|---|---|
| Delete a `.sav.bak` with the game off, relaunch | not restored |
| Add `test.txt` while running, exit, delete it, relaunch | not restored |
| Rename a `.txt` to `.sav`, exit, delete it, relaunch | **restored** |
| Delete a `.sav`, relaunch | restored, byte-identical |
| Add a folder | converted to a 1-byte `.sav` of the same name |

`[D]` So the sync is by `*.sav` pattern, not by folder. **A backup must not end
in `.sav`** or it becomes cloud collateral and propagates to the player's other
devices. `[O]` Confirmation with the developer is pending; the behaviour above
is observed, not documented.

`[I]` iestyn plays on two devices, so the export screen carries the protocol
(`src/ui/ExportDialog.tsx`): sync, main menu, own backup, inject, verify in
game, exit, let the cloud take it.
