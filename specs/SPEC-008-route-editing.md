# SPEC: Route Editing

Status: **draft 2**, 2026-09-01. Implemented; tests exist against it.
Depends on: SPEC-002 (tower JSON), SPEC-004 (simulation), SPEC-006 (`.sav`
codec), SPEC-007 (`Cursor`, the scrubber).
Load with this spec: `docs/DESIGN_ROUTE_EDITING.md`, `DECISIONS.md` D7, D11,
D22, D30, D31, D34, D35, D36, D37.

The second interactive slice: the player edits a route and sees where it breaks.
Three features, one machinery — add and remove actions, skippable segments,
parallel segments.

`[D]` **This spec holds only what is numerically testable** — structures,
interfaces, invariants, the Verification Contract. Rationale and behaviour are
`docs/DESIGN_ROUTE_EDITING.md` and `docs/UI.md`, which are mutable (D30). The
test for which one a statement belongs in: *would it change because you looked
at the screen and disliked it?*

`[F]` fact · `[I]` iestyn said it · `[D]` decision · `[P]` proposal · `[O]` open

`[D]` **Three levels, split by how stable they are.** `[I]` A **Segment** is a
named list of actions plus metadata, and is expected to outlive every structure
above it; **Epoch** and the route as a whole will be restructured repeatedly as
the analysis gets richer. Keeping the durable concept in its own type is what
makes that churn cheap.

`[D]` **The root is `Route`, not `Timeline`.** `[F]` `Timeline` is already
`src/sim/types.ts`'s result of `simulate()` — consumed by `Cursor` and three
`mapdiff` modules — so reusing it here would collide with an implemented,
tested type (D34). `Route` was already the document's per-route object, so the
structure needs no new word: **`Route` → `Epoch` → `Segment` → `Action`.**
"Timeline" stays what it has always been in prose: the strip the player scrubs.

---

## 1. Scope and module layout

**Out of scope, deliberately**

| Not in this slice | Why |
|---|---|
| Automatic repair of a broken tail | The tool never solves a route — DESIGN §1 |
| The power graph, margin, threshold *numbers* | A later spec; §4.1 of DESIGN shrinks it |
| Enumerating segment combinations | A feedback loop, not a search — DESIGN §5 |
| Re-import reconciliation against a played-on `.sav` | DESIGN §8.1, unresolved |
| Orb towers (3-1) | `[F]` SPEC-004 §1 does not model orbs |

```
src/sim/route/document.ts   epochs, segments, actions; flatten()
src/sim/route/ordfile.ts    .ord parse and emit, canonical JSON, document hash
src/sim/route/sha256.ts     the synchronous digest both hashes use
src/sim/route/evaluate.ts   the forward pass: mainline plus per-segment forks
src/sim/route/edit.ts       insert, disable, split, merge, switch, rename, reorder
src/sim/route/export.ts     document -> .sav record
src/store/working.ts        IndexedDB working store
src/ui/session.ts           document, evaluation, undo, selection, the marker
src/ui/render/edit.ts       modes, badges, bracket, failure overlay
src/ui/...                  behaviour in docs/UI.md
```

`[D]` Route editing lives **inside `src/sim/`**, so D7's no-UI-import rule and
D34's no-`ScrollUnit` test already cover it. `[F]` D34's own table places route
segments in `src/sim/`; a sibling `src/route/` would have sat outside both
guards. `src/store/` is the one module that touches a browser API, and it holds
no logic.

---

## 2. The route document

### 2.1 An action is a pair of waypoints

`[D]` **The document stores the recorded pairs verbatim.** `[F]` SPEC-006 §4
reads a `.sav` record's `2S+1` entries as a flat `Waypoint[]`: S pairs of
`(from, to)` — one per move the auto-pather cannot reproduce — then the
player's live position (SAVE_FORMAT §3). Splitting that list into S pairs plus
a final position is positional, needs no inference, and is lossless both ways.

`[D]` **The editing unit is the pair, not the entry.** `[F]` The `2S+1` rule is
positional, so adding or removing a single entry mis-pairs every entry after it
and the game reads a different route; an insert would break it and so would
disabling one half of a pair. Pairing them makes `2S+1` an **invariant of the
structure**, which is why `insert` and `setDisabled` are one operation each with
no parity arithmetic anywhere.

`[D]` **Both halves are data.** `[F]` SAVE_FORMAT §3's worked example has a pair
whose `from` is not where the previous pair left the player: it is the tile they
approached from, which decides adjacency and which side of a one-way wall they
stand on, and the auto-pather reproduces neither. So a disabled action drops
*both* of its waypoints, and the "leave the player at the action's start
location" behaviour of DESIGN §3.1 is served by the badge on the disabled
action's own cells, which the document still holds.

`[D]` **Which actions are *live* is still derived from the simulation**, not
stored: the evaluation says which epochs were skipped, and `disabled` says the
rest.

### 2.2 Structure

```ts
interface OrdFile {
  format: 'orderlyorderer-route'
  version: 1
  routes: Route[]
}

interface Route {
  name: string
  tower: string                 // tower id, e.g. '2-5'
  gemsOwned: number             // SPEC-004 §10.1
  source?: SaveSource           // absent for a route not imported from a .sav
  epochs: Epoch[]
  final: Waypoint               // the player's live position; see below
}

interface SaveSource {
  file: string                  // filename as opened, for the player's benefit
  record: string                // save name within it
  hash: string                  // SHA-256 of the record's decompressed payload
}

interface Epoch {
  name?: string                 // the span, e.g. '5F'
  skippable: boolean            // may resolve to nothing; see §3
  active: number                // index into segments
  segments: Segment[]           // length >= 1
}

interface Segment {
  name: string                  // the player's own, e.g. 'take the Light Key'
  actions: Action[]
}

interface Action {
  from: Waypoint                     // where the move was made from
  to: Waypoint                       // the cell acted on
  disabled?: boolean                 // absent means enabled
}
```

`[D]` `final` is **route-level, not the tail of the last segment**. It is the
one entry belonging to no action, so a segment holding it would be a segment of
odd length and every operation in §5 would need an "except the last one" clause.

`[D]` `inserted` is **not** in the schema. It is session state meaning "new
since the last save", cleared on save, so every `.ord` on disk has it false by
construction (DESIGN §3). It lives in the working store only.

`[D]` `hash` is over the **decompressed payload**, not the file or the
compressed blob. `[F]` SPEC-006 §6: Node's zlib reproduces only 82 of 326 of the
game's compressed streams while the payload underneath is exact in all 326, so a
hash over compressed bytes would report spurious mismatches.

`[D]` The digest is a **synchronous** SHA-256 of our own, because the marker is
computed on the edit path (DESIGN §2.3) and the browser's only built-in digest,
`crypto.subtle`, is async — awaiting it would leave the marker one edit behind
the document it describes. It is checked against `node:crypto` at every length
across the block boundaries.

### 2.3 Flattening

```ts
function flatten(route: Route): Waypoint[]
```

`[D]` The **active segment** of each epoch in order, each enabled action
contributing `from` then `to`, and `route.final` last. Always odd, so it is
always a legal `2S+1` entry list. This is the only thing the simulator ever
sees (D7); it never receives a segment.

`[F]` `flatten()` is a function of the document alone, so it cannot know which
epochs a *skip* removed. The route that actually ran is `Evaluation.waypoints`,
and that is what §7 exports.


### 2.4 Canonical serialization

`[D]` `.ord` is JSON with **sorted object keys, no insignificant whitespace,
and integers emitted without exponent**, so that serializing an unchanged
document is byte-stable. The unsaved-changes marker is a SHA-256 over that
serialization, compared against the hash taken at the last save (DESIGN §2.3).

`[D]` Absent optional fields are omitted rather than written null, so that
enabling a disabled action restores the byte-identical document — this is what
invariant 4 asserts.

`[D]` `gemsOwned` is a **finite** integer, and "unlimited" is the sentinel
`Number.MAX_SAFE_INTEGER`. `[F]` JSON has no infinity: it would serialize as
`null` and parse back as a broken route. Any value above every gem cost in the
game behaves identically, and the sentinel is the largest integer JSON round
trips exactly. `[F]` The app has no real number to put here yet — the total is
grade gems plus the sum of per-tower crown tiers, and only the `crown` file
supplies it (TODO §B2).

---

## 3. Epochs and segments

`[D]` **A Segment is inert.** It is a named list of actions and nothing else:
no selection, no fallback, no opinion about what happens when it fails. All
three features are **selection policies on the Epoch that holds it**, which is
why the player sees three features and the code has one.

| The player sees | Segments in the epoch | Active segment chosen |
|---|---|---|
| A plain segment | 1 | always |
| A skippable segment | 1, plus an **implicit empty segment** | automatically: the empty one iff the authored one fails |
| Parallel segments | *n*, authored | by hand, persisted in `active` |

`[D]` **`skippable` is Epoch state, not Segment metadata.** It describes how the
epoch *chooses* — "this span may resolve to nothing" — and that is not a
property of any one segment's contents. `[F]` With one segment the two
placements are equivalent; with three, "segment 2 is skippable" does not say
whether the epoch skips that segment or the whole span, and there is no answer
that is not arbitrary. On the epoch it is exact.

`[D]` The implicit empty segment is **not stored**. `skippable: true` denotes
it, and evaluation selects it. Storing it would let `active` and `skippable`
disagree, and would put a segment in the document that the player never wrote.

`[D]` **A failing non-skippable epoch stops the whole route.** Skippable is the
exception, not the default.

`[D]` **Splitting is UI-only and must not change `flatten()`.** A split divides
one epoch's active segment at an action boundary into two epochs, each holding
one segment. `[D]` An epoch with more than one segment **cannot** be split —
there is no meaning for where the other segments divide. Invariant 2.

`[O]` **Cached end state is derived, not document metadata.** `[I]` iestyn
raised caching a segment's ending state on the segment. `[P]` It cannot live in
the `.ord` as written: a segment's end state is a function of the state it
*began* with, which depends on every upstream choice, so a cached value is valid
for exactly one prefix and silently wrong after any edit above it. If it is
built, key it by the incoming state and keep it in the working store, where a
stale entry costs a recomputation rather than a wrong answer.

---

## 4. Evaluation

```ts
interface Evaluation {
  mainline: Timeline                       // over the realised route
  epochs: EpochResult[]                    // one per epoch, in order
  waypoints: Waypoint[]                    // the realised route: 2S+1 shaped
}

interface EpochResult {
  skipped: boolean                         // a skippable epoch whose segment failed
  error?: SimError                         // SPEC-004 §7, first failure in the active segment
  forks: (SimError | null)[]               // indexed BY SEGMENT; see below
  startStep: number                        // index into mainline.steps
  startWaypoint: number                    // index into waypoints
}
```

`[D]` **A single forward pass over epochs.** Each epoch is evaluated against the
state its predecessors produced. A skippable epoch whose active segment fails is
rewound to its start and its successor continues from there. Earlier epochs are
already committed, so nothing cascades backwards.

`[D]` **Rewind is `Cursor.seekTo`**, not a re-simulation from zero. `[F]`
SPEC-004 invariant "undo(do(s)) == s" and SPEC-007 invariant 2 (seek symmetry)
are what make this sound; this spec adds no new undo machinery.

`[D]` **An inactive segment is forked from the mainline's prefix**, not
simulated in isolation: its outcome depends on the state reached at that point.
`[D]` **A fork runs to its own end and no further** — it answers *would this pass
from here*. Total work is the sum of segment lengths, not the product.

`[D]` **A route is therefore several runs**, and the app legitimately holds
several errors at once: one per skipped epoch and one per failing fork, each
well-defined within its own run. This is the SPEC-004 §7 amendment.

`[D]` `forks` is indexed **by segment**, not packed to the inactive ones, so
the UI can colour each alternative where it sits. The active segment's slot is
always `null` and its outcome is `error`.

`[D]` **Forks must not mutate mainline state.** Invariant 8. `[F]` The engine
takes one optional argument saying where to resume from, and **copies** the
cells and kills it is handed, which is what makes that structural rather than a
rule to remember.

`[D]` **An epoch after a stopped route still contributes its waypoints**, and
its `EpochResult` carries no error because it never ran. `[F]` That is what
keeps the whole red tail on the timeline instead of truncating the route at the
break, which is the thing the player is looking at.

---

## 5. Editing operations

```ts
type Edit =
  | { op: 'insert';       epoch: number; segment: number; index: number; action: Action }
  | { op: 'setDisabled';  epoch: number; segment: number; index: number; value: boolean }
  | { op: 'addSegment';   epoch: number; name?: string } // a new parallel segment
  | { op: 'split';        epoch: number; index: number }
  | { op: 'merge';        epoch: number }               // with its successor
  | { op: 'setActive';    epoch: number; segment: number }
  | { op: 'rename';       epoch: number; segment?: number; name: string }
  | { op: 'reorder';      from: number; to: number }    // epochs
  | { op: 'setSkippable'; epoch: number; value: boolean }
```

`[D]` Every op names an **epoch** first, because that is the addressable unit;
`segment` selects within it and is omitted only by `rename`, which names an
epoch when absent. `[D]` `reorder` moves epochs, never segments: `[F]` segments
within an epoch are alternatives, so their order carries no meaning.

`[D]` **Every `Edit` is document-tier**, and every one sets the unsaved-changes
marker and pushes an app-level undo entry. Nothing else does — scrubbing,
selection, mode and option toggles are view-tier (DESIGN §2.3). `[D]` This is
one rule with no exceptions, which is why it needs no list to maintain.

`[D]` **Re-evaluation resumes at the edited epoch's start**, not from zero.
Invariant 6 is what licenses this: epochs before the edit are unaffected, so
`Cursor.seekTo` reaches that state and only the tail is re-simulated.

`[D]` This is **not** a fast path that skips work. `[F]` SPEC-004 §7's
"validation is always on, with no fast path for additive edits" governs *what is
checked*, and every step in the tail is still checked identically; this governs
only *where replay starts*, from a state the journal already proves correct.
An insert at the head degenerates to the whole route, which is why oracle 4
benchmarks exactly that.

`[D]` `insert` names an epoch and segment explicitly, so there is no ambiguous position
between two epochs. `[F]` This is why `docs/UI.md` requires a selected segment
before editing.

`[D]` `insert` carries the whole `Action`, both halves, rather than the target
alone: the `from` is where the player stands when they click, which is
evaluation state and not something `edit.ts` can see (D7). `index` is an
**action** index, and every op is immutable — `apply` returns a new document,
so the undo stack is the sequence of its results and needs no inverse
operations.

`[D]` **Re-evaluation is the whole route, and measured rather than assumed.**
Oracle 4 puts a head insert on the corpus's largest record inside the one-frame
target, so resuming at the edited epoch's start buys nothing that can be seen
and is not built (D11).

---

## 6. The working store

`[D]` **IndexedDB**, one record per session: the document, plus view state
(open route, scrub position, mode, selection, toggles, scroll), plus the
`inserted` flags. `[D]` Nothing derived is stored — the simulation, journal,
cell grids, floor bitmaps and atlas are recomputed on load, being a pure
function of the tower and the flattened route.

`[D]` **A `loadCompleted` flag** is written after a successful load and cleared
at the start of the next one. If a launch finds it clear, the previous load
crashed and the app offers to start clean, so a document that crashes during
load cannot trap the player in a loop.

`[D]` The store is **not cleared on exit**, and there is no clean-exit flag:
`beforeunload` and `visibilitychange` do not reliably fire, so its absence would
mean "probably crashed", which is a guess. The unsaved-changes marker is not a
guess and names the thing that matters (DESIGN §2.2).

---

## 7. Export

```ts
function toSaveRecord(route: Route, tower: TowerJSON, evaluation?: Evaluation): Uint8Array
```

`[D]` The tower is a parameter because a `Route` carries a tower **id**, and
the refusal below is a simulation. The evaluation is optional and passed when
the caller already has one, which the app always does.

`[D]` Emits `Evaluation.waypoints` as a `2S+1` entry list through the SPEC-006
writer — the route that ran, so a skipped epoch contributes nothing to the file
just as it contributed nothing to the run.
`[D]` **Export refuses when `evaluation.mainline.error` is set**, before writing
anything. `[F]` The game's loader would refuse it anyway by re-simulation
(`RESULTS.md`); this only makes the refusal ours, and legible.

`[D]` **A disabled action is absent from the export**, both its waypoints,
being absent from `flatten()`. `[D]` Export never overwrites: every write is a
fresh, uniquely named file.

---

## 8. What moves into `docs/UI.md`

`[F]` **Done: all of it is in `docs/UI.md` §7**, written in the same commit as
the behaviour it describes.

`[D]` **Implementing this spec includes writing these into `docs/UI.md`**, in
the same commit as the behaviour they describe. They are not in `UI.md` now
because it is *current state only* (D31) and none of this is built; recording
them here rather than in a scratch file is what makes the migration part of the
work instead of a thing to remember.

`[F]` `UI.md` is at its 150-line budget already, so this lands with a
compression pass, not as an append. `[D]` All of it is `[I]` from iestyn and
judged by eye (D24a, D30) — none of it is verified by §9.

From `docs/DESIGN_ROUTE_EDITING.md`:

| Source | What moves |
|---|---|
| §3.1 | The green/red timeline; the `+` badge on added actions; the *no entry* badge and start-location behaviour for disabled ones; three mutually-exclusive mode buttons; Z and Y single-stepping; click semantics in add and delete mode |
| §4.3 | Segment selection; the bracket over the current segment; scrubbing a failed segment and clamping at its failing action; the failure overlay built from `SimError`'s code plus `have`/`need` |
| §5 | Choosing between parallel segments by clicking, and what the inactive ones show |

`[O]` Three of these resolve only by building, and are built but not yet
looked at (D24a) — whether the outline around actions reads well, whether it
should apply to live actions too, and whether an ignored click in add mode
should still move the player icon.

---

## 9. Verification Contract

```
Run: npm test && npm run typecheck
Report: test summary; PASS/FAIL + actual value per named case;
        invariant results; oracle counts; re-evaluation median/max;
        any file touched outside src/sim/route/, src/store/, src/ui/
```

**Named cases with exact expected values**

| Case | Expected |
|---|---|
| Corpus records importable | **326**, over 14 towers |
| Records in a file, corpus range | 10 to 48 |
| Entry count odd, every record (`2S+1`) | **326 / 326** |
| Largest route, slider stops / cell edits | **1 773 / 1 849** (`2-5`, `F 211g 98.3M win H [A]`) |
| `ErrorCode` values surfaced by an epoch result | **15** (SPEC-004 §7) |
| Segments in an epoch, minimum | 1 |
| Epochs in a freshly imported route | 1 |

`[F]` Fifteen is SPEC-004 §7's own list, and the test enumerates the type, so a
code added or removed breaks this rather than passing quietly.

**Invariants**

1. **Import identity.** For every corpus record: import to a one-epoch,
   one-segment document with nothing disabled; `flatten()` equals the
   `Waypoint[]` SPEC-006 reads, and `simulate(flatten())` equals simulating the
   record directly. `[D]` This is the "segments are UI only" claim, asserted
   rather than assumed.
2. **Split neutrality.** Splitting an epoch at any action boundary leaves
   `flatten()` identical. Splitting a multi-segment epoch is refused.
3. **Merge inverts split.** `merge(split(d, i))` restores `flatten()` exactly.
   `[D]` The *document* may differ, because the split's second name is lost;
   only the flattened route is asserted equal.
4. **Toggle identity.** Disabling an action and re-enabling it restores the
   byte-identical canonical serialization, hence the same document hash. `[D]`
   This is the unsaved-changes marker's correctness, not a nicety.
5. **Skip equals empty segment.** A failing skippable epoch leaves the
   mainline in exactly the state an explicitly-selected empty segment would.
   `[D]` The diagnostic for §3's unification (D18): if the two ever diverge, the
   one-construct claim is false.
6. **Forward-pass locality.** Changing `active` on epoch *k* leaves the
   evaluated state at the start of epoch *k* unchanged. Nothing cascades
   backwards.
7. **Document round trip.** `parse(emit(d))` equals `d`, and `emit` is
   byte-stable across repeated calls.
8. **Fork isolation.** Evaluating inactive segments leaves `mainline` bit-identical
   to an evaluation with forks disabled.
9. **No UI import in `src/sim/route/`.** A grep, asserted in test. D7. `[F]`
   SPEC-007 invariant 5 is the same claim about the same tree, so there is one
   grep and not two — and it now walks subdirectories, which is what it failed
   to do the moment `src/sim/route/` existed.

**Oracles**

1. **Every corpus record imports, evaluates and exports.** All 326 across 14
   towers: import, evaluate, export the payload, re-import, compare flattened
   routes. **Expected 326 / 326.**
2. **Unedited export is byte-exact at the payload level.** For a route imported
   and not edited, `toSaveRecord` reproduces the original decompressed payload
   byte-for-byte. `[F]` SPEC-006 §5.1 already proves the codec does this
   326 / 326, so any failure here is ours, not the codec's. **Expected 326 / 326.**
3. **Segmentation sweep.** For each corpus record, split the route into *n*
   epochs at even boundaries for several *n*, and assert invariants 1, 2 and 6
   hold at every split. `[D]` Cheap, and it exercises the structure against real
   routes rather than fixtures.
4. **Re-evaluation against the ceiling.** The 1 849-edit record: insert an
   action at the head — the worst case under §5 — re-evaluate, and report median
   and max.

   `[D]` **The budget is set by the click stream, not by a perception
   threshold.** `[I]` The game trains fast clicking, and a fast player sustains
   on the order of 8 clicks a second, ~125 ms apart. A per-edit cost near 100 ms
   would therefore *queue behind the input* rather than merely feel slow — the
   error is treating an edit as a single event to be answered promptly, when it
   is a stream to be kept up with. **Target one frame, 16 ms; ceiling 33 ms.**
   At one frame an edit is indistinguishable from a scrub and no click rate can
   outrun it.

   `[F]` **Measured: 9.0 ms median, 11.2 ms max**, comfortably inside the
   one-frame target. `[F]` It is the cost of re-simulating the route **in
   full**: 1 773 actions, **3 547** entries and **6 071** steps. A head insert
   and a whole-route re-simulation are therefore the same measurement, which is
   why this is the case the oracle picks.

   `[F]` Reaching it took the move this oracle names — narrowing the work rather
   than relaxing the budget — three times, and **the search was never the cost**.
   The first reading was 27.7 ms. Measured over this route:

   | Where | Was | Fix |
   |---|---|---|
   | `pathfind` allocated and cleared three tower-sized arrays per call, and copied the `Player` per neighbour | 34 million writes, ~150 MB of garbage | one reused working set, `seen` a generation stamp |
   | A kill rescanned all 225 cells of its floor for Battle Gates; the route makes **1 389** kills | 312 000 cell reads — six times the pathfinder's whole neighbour count | the gates indexed once per tower, D39 |
   | `pathfind` allocated a `{z, x, y}` per node dequeued and per neighbour examined | ~40 000 objects | arithmetic, and a floor number rather than a position |

   `[F]` **The BFS itself is small**: 2 354 calls, 13 413 nodes dequeued and
   49 964 neighbours examined over the whole route, and **2 007 of the 2 354
   calls find the goal from the start node** — the recorded `from` is adjacent
   to the cell acted on, so most pathfinds are one step. What cost time was
   allocation around the search, not the search.

   `[F]` Taken after `TODO.md` §A5 was fixed, as this oracle requires: a run
   with the readback demotion and the leaked listeners live would have measured
   those as well.

**Not verified here.** Everything §8 moves into `docs/UI.md` — modes, badges,
green/red regions, selection, the bracket, the failure overlay. `[D]` Judged by
looking, not by test. Stated so that a green suite is never mistaken for a
working editor.
