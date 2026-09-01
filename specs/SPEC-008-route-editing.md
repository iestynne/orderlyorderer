# SPEC: Route Editing

Status: **draft 1**, 2026-09-01.
Depends on: SPEC-002 (tower JSON), SPEC-004 (simulation), SPEC-006 (`.sav`
codec), SPEC-007 (`Cursor`, the scrubber).
Load with this spec: `docs/DESIGN_ROUTE_EDITING.md`, `DECISIONS.md` D7, D11,
D22, D30, D31, D34, D35, D36.

The second interactive slice: the player edits a route and sees where it breaks.
Three features, one machinery — add and remove actions, skippable segments,
parallel segments.

`[D]` **This spec holds only what is numerically testable** — structures,
interfaces, invariants, the Verification Contract. Rationale and behaviour are
`docs/DESIGN_ROUTE_EDITING.md` and `docs/UI.md`, which are mutable (D30). The
test for which one a statement belongs in: *would it change because you looked
at the screen and disliked it?*

`[F]` fact · `[I]` iestyn said it · `[D]` decision · `[P]` proposal · `[O]` open

`[D]` **A take, not a variant.** `src/mapdiff/verify.ts` already exports a
`Variant` for sprite hash bands, and D34 forbids two concepts sharing a word.
The user-facing feature is still "parallel segments"; the thing a segment holds
*n* of is a **take**.

---

## 1. Scope and module layout

**Out of scope, deliberately**

| Not in this slice | Why |
|---|---|
| Automatic repair of a broken tail | The tool never solves a route — DESIGN §1 |
| The power graph, margin, threshold *numbers* | A later spec; §4.1 of DESIGN shrinks it |
| Enumerating take combinations | A feedback loop, not a search — DESIGN §5 |
| Re-import reconciliation against a played-on `.sav` | DESIGN §8.1, unresolved |
| Orb towers (3-1) | `[F]` SPEC-004 §1 does not model orbs |

```
src/sim/route/document.ts   segments, takes, actions; flatten()
src/sim/route/ordfile.ts    .ord parse and emit, canonical JSON, document hash
src/sim/route/evaluate.ts   the forward pass: mainline plus per-take forks
src/sim/route/edit.ts       insert, disable, split, merge, switch, rename, reorder
src/sim/route/export.ts     document -> .sav record
src/store/working.ts        IndexedDB working store
src/ui/...                  modes, selection, badges — behaviour in docs/UI.md
```

`[D]` Route editing lives **inside `src/sim/`**, so D7's no-UI-import rule and
D34's no-`ScrollUnit` test already cover it. `[F]` D34's own table places route
segments in `src/sim/`; a sibling `src/route/` would have sat outside both
guards. `src/store/` is the one module that touches a browser API, and it holds
no logic.

---

## 2. The route document

### 2.1 An action is a waypoint

`[D]` **The document stores the waypoint list verbatim.** `[F]` SPEC-006 §4
reads a `.sav` record's `2S+1` entries as a flat `Waypoint[]` with nothing
distinguishing them: `from` entries resolve to passive walks or no-ops, `to`
entries are the state-changing ones. Storing that list unchanged makes import
lossless and export trivial, and requires no inference at the boundary.

`[D]` **Which waypoints are *actions* is derived from the simulation**, not
stored. The `Timeline` already knows which steps changed state, so the editing
and display unit is computed rather than guessed.

`[F]` This makes one piece of `docs/UI.md` free rather than special-cased.
Disabling an action means disabling its `to` waypoint; the preceding `from`
waypoint survives and still walks the player to the action's start location —
which is exactly the described behaviour, "leave the player where the pathfinder
says the last step before the action was."

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
  segments: Segment[]
}

interface SaveSource {
  file: string                  // filename as opened, for the player's benefit
  record: string                // save name within it
  hash: string                  // SHA-256 of the record's decompressed payload
}

interface Segment {
  name: string
  skippable: boolean
  active: number                // index into takes
  takes: Take[]                 // length >= 1
}

interface Take {
  name?: string
  actions: Action[]
}

interface Action {
  z: number; x: number; y: number    // a SPEC-004 Waypoint, 1-based
  disabled?: boolean                 // absent means enabled
}
```

`[D]` `inserted` is **not** in the schema. It is session state meaning "new
since the last save", cleared on save, so every `.ord` on disk has it false by
construction (DESIGN §3). It lives in the working store only.

`[D]` `hash` is over the **decompressed payload**, not the file or the
compressed blob. `[F]` SPEC-006 §6: Node's zlib reproduces only 82 of 326 of the
game's compressed streams while the payload underneath is exact in all 326, so a
hash over compressed bytes would report spurious mismatches.

### 2.3 Flattening

```ts
function flatten(route: Route): Waypoint[]
```

`[D]` Concatenates the **active take** of each segment in order, dropping
`disabled` actions. This is the only thing the simulator ever sees (D7); it
never receives a segment.

### 2.4 Canonical serialization

`[D]` `.ord` is JSON with **sorted object keys, no insignificant whitespace,
and integers emitted without exponent**, so that serializing an unchanged
document is byte-stable. The unsaved-changes marker is a SHA-256 over that
serialization, compared against the hash taken at the last save (DESIGN §2.3).

`[D]` Absent optional fields are omitted rather than written null, so that
enabling a disabled action restores the byte-identical document — this is what
invariant 4 asserts.

---

## 3. The segment model

`[D]` One construct, three behaviours. The player sees three features; the code
has one.

| The player sees | Takes | Active take chosen |
|---|---|---|
| A plain segment | 1 | always |
| A skippable segment | its actions, plus an **implicit empty take** | automatically: the empty one iff the actions fail |
| Parallel segments | *n*, authored | by hand, persisted in `active` |

`[D]` The implicit empty take is **not stored**. `skippable: true` denotes
it, and evaluation selects it. Storing it would let `active` and `skippable`
disagree.

`[D]` **A failing non-skippable segment stops the whole route.** Skippable is
the exception, not the default.

`[D]` **Splitting is UI-only and must not change `flatten()`.** A split divides
one segment's active take at an action boundary into two segments, each with
one take. `[D]` A segment with more than one take **cannot** be split —
there is no meaning for where the other takes divide. Invariant 2.

---

## 4. Evaluation

```ts
interface Evaluation {
  mainline: Timeline                       // over the flattened active route
  segments: SegmentResult[]                // one per segment, in order
}

interface SegmentResult {
  skipped: boolean                         // a skippable segment that failed
  error?: SimError                         // SPEC-004 §7, first failure in this segment
  forks: (SimError | null)[]               // one per inactive take
  startStep: number                        // index into mainline.steps
}
```

`[D]` **A single forward pass.** Each segment is evaluated against the state its
predecessors produced. A skippable segment that fails is rewound to its start and
its successor continues from there. Earlier segments are already committed, so
nothing cascades backwards.

`[D]` **Rewind is `Cursor.seekTo`**, not a re-simulation from zero. `[F]`
SPEC-004 invariant "undo(do(s)) == s" and SPEC-007 invariant 2 (seek symmetry)
are what make this sound; this spec adds no new undo machinery.

`[D]` **An inactive take is forked from the mainline's prefix**, not
simulated in isolation: its outcome depends on the state reached at that point.
`[D]` **A fork runs to its own end and no further** — it answers *would this pass
from here*. Total work is the sum of take lengths, not the product.

`[D]` **A route is therefore several runs**, and the app legitimately holds
several errors at once: one per skipped segment and one per failing fork, each
well-defined within its own run. This is the SPEC-004 §7 amendment named above.

`[D]` **Forks must not mutate mainline state.** Invariant 8.

---

## 5. Editing operations

```ts
type Edit =
  | { op: 'insert';  segment: number; index: number; at: Waypoint }
  | { op: 'setDisabled'; segment: number; take: number; index: number; value: boolean }
  | { op: 'split';   segment: number; index: number }
  | { op: 'merge';   segment: number }        // with its successor
  | { op: 'setActive'; segment: number; take: number }
  | { op: 'rename';  segment: number; name: string }
  | { op: 'reorder'; from: number; to: number }
  | { op: 'setSkippable'; segment: number; value: boolean }
```

`[D]` **Every `Edit` is document-tier**, and every one sets the unsaved-changes
marker and pushes an app-level undo entry. Nothing else does — scrubbing,
selection, mode and option toggles are view-tier (DESIGN §2.3). `[D]` This is
one rule with no exceptions, which is why it needs no list to maintain.

`[D]` **Re-evaluation resumes at the edited segment's start**, not from zero.
Invariant 6 is what licenses this: segments before the edit are unaffected, so
`Cursor.seekTo` reaches that state and only the tail is re-simulated.

`[D]` This is **not** a fast path that skips work. `[F]` SPEC-004 §7's
"validation is always on, with no fast path for additive edits" governs *what is
checked*, and every step in the tail is still checked identically; this governs
only *where replay starts*, from a state the journal already proves correct.
An insert at the head degenerates to the whole route, which is why oracle 4
benchmarks exactly that.

`[D]` `insert` names a segment explicitly, so there is no ambiguous position
between two segments. `[F]` This is why `docs/UI.md` requires a selected segment
before editing.

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
function toSaveRecord(route: Route): Uint8Array    // decompressed payload
```

`[D]` Emits `flatten(route)` as a `2S+1` entry list through the SPEC-006 writer.
`[D]` **Export refuses when `evaluation.mainline.error` is set**, before writing
anything. `[F]` The game's loader would refuse it anyway by re-simulation
(`RESULTS.md`); this only makes the refusal ours, and legible.

`[D]` **A disabled action is absent from the export**, being absent from
`flatten()`. `[D]` Export never overwrites: every write is a fresh, uniquely
named file.

---

## 8. What moves into `docs/UI.md`

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
| §5 | Choosing between takes by clicking, and what the inactive ones show |

`[O]` Three of these resolve only by building — whether the outline around
actions reads well, whether it should apply to live actions too, and whether an
ignored click in add mode should still move the player icon.

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
| `ErrorCode` values surfaced by a segment result | **16** (SPEC-004 §7) |
| Takes in a segment, minimum | 1 |
| Segments in a freshly imported route | 1 |

**Invariants**

1. **Import identity.** For every corpus record: import to a one-segment,
   one-take document with nothing disabled; `flatten()` equals the
   `Waypoint[]` SPEC-006 reads, and `simulate(flatten())` equals simulating the
   record directly. `[D]` This is the "segments are UI only" claim, asserted
   rather than assumed.
2. **Split neutrality.** Splitting a segment at any action boundary leaves
   `flatten()` identical. Splitting a multi-take segment is refused.
3. **Merge inverts split.** `merge(split(d, i))` restores `flatten()` exactly.
   `[D]` The *document* may differ, because the split's second name is lost;
   only the flattened route is asserted equal.
4. **Toggle identity.** Disabling an action and re-enabling it restores the
   byte-identical canonical serialization, hence the same document hash. `[D]`
   This is the unsaved-changes marker's correctness, not a nicety.
5. **Skip equals empty take.** A failing skippable segment leaves the
   mainline in exactly the state an explicitly-selected empty take would.
   `[D]` The diagnostic for §3's unification (D18): if the two ever diverge, the
   one-construct claim is false.
6. **Forward-pass locality.** Changing `active` on segment *k* leaves the
   evaluated state at the start of segment *k* unchanged. Nothing cascades
   backwards.
7. **Document round trip.** `parse(emit(d))` equals `d`, and `emit` is
   byte-stable across repeated calls.
8. **Fork isolation.** Evaluating inactive takes leaves `mainline` bit-identical
   to an evaluation with forks disabled.
9. **No UI import in `src/sim/route/`.** A grep, asserted in test. D7.

**Oracles**

1. **Every corpus record imports, evaluates and exports.** All 326 across 14
   towers: import, evaluate, export the payload, re-import, compare flattened
   routes. **Expected 326 / 326.**
2. **Unedited export is byte-exact at the payload level.** For a route imported
   and not edited, `toSaveRecord` reproduces the original decompressed payload
   byte-for-byte. `[F]` SPEC-006 §5.1 already proves the codec does this
   326 / 326, so any failure here is ours, not the codec's. **Expected 326 / 326.**
3. **Segmentation sweep.** For each corpus record, split the route into *n*
   segments at even boundaries for several *n*, and assert invariants 1, 2 and 6
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

   `[P]` Plausible but unmeasured. `[F]` The corpus sweep simulates ~470 000
   moves over 326 records inside `npm test`, and `[P]` the largest single route
   is on the order of 1 % of that — ~5 900 steps, from SPEC-007's measured 3.3
   steps per slider stop across 1 773 stops. `[O]` The first run settles it. If
   the ceiling is missed, the next move is to narrow what a head insert
   re-simulates, **not** to relax the budget.

   `[F]` **Measure this only after `TODO.md` §A5 is fixed.** Two scrubber
   performance faults are open — a canvas demoted to software by repeated
   readbacks, and leaked `window` listeners — and both degrade the app over
   time. They are rendering faults and this oracle measures simulation, so they
   do not invalidate it, but a run taken while they are live measures the leak
   as well and would set a baseline nobody can reproduce. Same reasoning as
   `STATUS.md`'s ordering of SPEC-007 oracle 2.

**Not verified here.** Everything §8 moves into `docs/UI.md` — modes, badges,
green/red regions, selection, the bracket, the failure overlay. `[D]` Judged by
looking, not by test. Stated so that a green suite is never mistaken for a
working editor.
