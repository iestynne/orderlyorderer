# DESIGN DRAFT: Route Segmentation, Editing, and the Power Graph

Status: draft 2, 2026-08-28. Exploratory — not yet a spec, no Verification
Contract. Depends on `specs/SPEC-004-simulation.md`.

Provenance legend:
- `[F]` fact — empirically validated (save files, map PNGs, screenshots, Lua).
- `[I]` iestyn said it — from play experience, not re-verified.
- `[D]` decision — agreed design choice.
- `[P]` proposal — my suggestion, not yet validated.
- `[O]` open question.

---

## 1. The problem

A route is a long list of moves recorded by the game. The player wants to
*edit the middle of it* and see immediately whether the rest still works —
and if it doesn't, exactly where and why it breaks.

`[I]` Segments are a **UI convenience** for making bulk edits. They carry no
validation semantics. Reachability and resource checks apply at every step in
every segment, identically. Errors are reported per step (SPEC-004 §7),
because failures routinely land mid-segment — most often "player power is now
slightly too low for this attack".

---

## 2. Why absolute coordinates

`[D]` Moves are stored as `coordA -> coordB` pairs, matching the .sav format,
not as directions.

`[I]` Teleport semantics are exactly what's wanted. Segments are **not**
starting-position-relative. When a segment replays, it should reproduce its
original absolute positions verbatim; the sim then re-validates every step
against the new resource and power state. A direction-relative replay would
translate the whole segment sideways after any inserted detour, which is never
the intent.

---

## 3. Worked examples

### 3.1 Additive, at the head `[I]`

The player earns more gems by improving a score on another tower, and wants to
spend them.

- Insert moves at the start of the run: open some Gem Gates and collect the
  items or power behind them.
- Every subsequent move replays verbatim.

### 3.2 Additive, mid-route `[I]`

- Split the run into segments A, B, C.
- A replays verbatim.
- Insert moves on a Gem-Gate floor to acquire a Light Key.
- B replays verbatim.
- Insert moves that spend the Light Key on a Light Gate and defeat the enemies
  behind it, gaining power.
- C replays verbatim.

Both are deliberately *additive* — resources and power only increase — which
makes them the simple cases to implement first.

`[D]` **Do not special-case them in the code.** Validation stays always-on for
safety, and the performance answer is to make full re-simulation fast enough
for the hard cases rather than to add a fast path for the easy ones.

### 3.3 Non-additive substitution `[I]` — the hard case

Trade a Light Key for a Dark Key: some moves must be *removed* and others
*added*. Consequences:

- The sequence of player power values changes at every step after the edit.
- An attack move downstream may become invalid because power is now slightly
  too low.
- Repairing that may require further edits, which shift power again.

Explicitly deferred. This is the interesting design problem.

---

## 4. The power graph

`[I]` This is where route optimisation actually happens, and it is probably the
highest-value analysis feature in the app.

Plot `player.power` against step index for the whole route. Overlay markers,
chosen by the player, for the events that constrain the shape of the curve.

### 4.1 Thresholds

`[I]` Routes are demarcated by **power thresholds** — a guard enemy blocking
entry to a floor (e.g. a −50k) that you simply cannot pass below a certain
power. With the curve drawn and thresholds marked, the player can see directly:

- whether an edit lifted or dropped the curve at each threshold,
- how much more power a failing threshold still needs,
- which thresholds have slack and which are tight.

`[I]` **Orderly Order is essentially all about per-floor entry thresholds**, so
it is the natural test tower for this whole feature set.

### 4.2 Half Gates

`[I]` Half Gates invert the usual "more power is better" intuition:

- Power gained *before* a Half Gate is halved by it — half-wasted, and worse
  with several gates in sequence.
- So the ideal is to hit each Half Gate at **minimum** power and defer power
  gain until after it.

On the graph, a Half Gate is a visible cliff. Marking them lets the player see
how much of a given gain was thrown away, and whether reordering a
power-gathering detour to after the gate is worth it.

### 4.3 Margin

`[P]` For every step that *passes* a constraint, record how close it came —
the slack between the player's power and what the step required. Surfacing
margin turns blind iteration into informed editing:

- A step that succeeded with 1 power to spare is the thing that will break next.
- `[I]` Conversely, cutting margins deliberately is a strategy: realising you
  can get by with 4k less power at some point may free the Light Key you spent
  to earn that 4k, which is then available elsewhere.

`[I]` Render the per-step **requirement** as points or columns beneath the
power curve — a floor the curve must always stay above. The vertical gap is the
headroom, readable at a glance, and a column touching the curve is the next
thing that will break. This makes "how much power can I give up before the
route fails" a visual question rather than an arithmetic one.

The threshold markers of §4.1 are the special case of this the player cares
about most.

### 4.4 The Keysmasher

`[I]` This is the case where the tool earns its keep most sharply. The
Keysmasher's kill bonus is `lightKeys × darkKeys` (or `lightKeys²` on
`negative_keys` towers), so **spending a key changes your damage output, not
just your access** — and planning around it is currently non-viable for
players, who just try it and see what they get.

That makes it a genuinely two-sided optimisation: a key spent on a Light Gate
is a key not multiplying every subsequent Keysmasher kill, and the trade is
invisible without a tool. On the power graph it shows up as the whole curve
after the Keysmasher pivoting when a single upstream key purchase changes.

### 4.5 Implementation note

The graph needs `power` per step as a cheap contiguous read. SPEC-004 §8 allows
an extra per-step typed array of power alongside the journal.

**It must be a `Float64Array`, not an `Int32Array`.** Power routinely reaches
1e12 and `MAX_POWER` is 999 999 999 999; Int32 caps at ~2.1e9, so the draft's
original suggestion would have silently wrapped on almost every real run.
Float64 holds every value in range exactly — see SPEC-004 §3 on why plain
`number` suffices throughout.

Margin per step requires the *requirement* of each step as well. That is now
retained as `Step.requirement` (SPEC-004 §8), so this note is satisfied rather
than pending.

---

## 5. Data model sketch `[P]`

```ts
interface Route {
  waypoints: Waypoint[]                          // flat, canonical
  segments: { name: string; start: number; end: number }[]   // UI only, index ranges
}
```

`[D]` The canonical route is a list of **state-changing actions** (waypoints),
not moves — the same representation the game's save format uses. Passive
walking between them is reconstructed by the pathfinder (SPEC-004 §5), which
also validates reachability. This radically shortens the history and makes the
editing operations below manipulate exactly the units the player thinks in.

Segments are index ranges over the flat list, not containers. Reordering or
inserting rewrites `waypoints` and adjusts ranges; the sim never sees segments.

`[I]` **Segments are persisted.** They are part of the mnemonic structure by
which the player conceives their strategy, so their names and boundaries
survive across sessions, not just across edits.

`[I]` Segments are **order-portable but not spatially portable**: swapping
A-B-C to B-A-C is meaningful and should be supported; relocating a segment to a
different position or floor never is. That settles the coordinate question —
absolute coordinates cost nothing here, because the one form of portability
that matters is reordering, and reordering preserves absolute positions.

Editing at index *i*: truncate the timeline to *i* and replay forward. The
prefix stays valid because the sim is deterministic and the state at *i* is
exactly reconstructible from the journal. Cost is proportional to the length of
the tail.

---

## 6. Open questions

1. `[O]` When an edit invalidates the tail, should the app attempt automatic
   repair (e.g. suggest which additional enemies to defeat to recover the
   missing power), or only diagnose? iestyn has ideas; deferred. Diagnosis
   first regardless.
2. `[O]` Undo/redo granularity — per move, or per edit operation? UI design,
   deferred; iestyn has ideas.
3. `[O]` What gets auto-marked on the power graph, and against which metrics.
   Power is not the only threshold resource — keys, pickaxes and gold gate
   progress too, as do resource-limited modifiers like the Vorpal Blade. This
   needs experimentation and will resolve into several features; deliberately
   left unelaborated here rather than cluttering the doc with speculation.
