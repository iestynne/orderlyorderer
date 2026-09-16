# SPEC: Segment Editing — authoring the units of analysis

Status: **draft 1, partial**, 2026-09-09. Not started.
Depends on: SPEC-008 (the document, epochs, segments, evaluation, the nine
edit operations), SPEC-006 (`.sav` import).
Read by: SPEC-012 (gold analysis), which prices what this spec lets the player
author.

`[D]` **Partial on purpose, and the two halves are at different readiness.**
§2 — `.ord` durability — is specified and buildable now, and is deliberately
**first**. §3, the editing surface, is a stub: it resolves by looking at it
(D24a), not by argument, and writing it out ahead of a screen would be writing
fiction.

`[F]` `[I]` iestyn, 2026-09-09, and it is why §2 leads: testing SPEC-012 means
importing his best 2-1 route, cutting it into trade segments, arranging the
epochs, and building alternatives to toggle. **That is hours of manual work, and
it has to survive a session boundary**, or the analysis can never be exercised
on anything real.

`[F]` fact · `[I]` iestyn said it · `[D]` decision · `[P]` proposal · `[O]` open

---

## 1. The seam

`[D]` **Definitions live once.** SPEC-008 is implemented with four passing
oracles and nine invariants asserting the structure; this spec does not restate
any of it and does not move it.

| Owned by | What |
|---|---|
| **SPEC-008** | `OrdFile`, `Route`, `Epoch`, `Segment`, `Action` (§2.2); canonical serialization and the document hash (§2.4); `flatten()` (§2.3); epoch selection policy (§3); the forward pass and forks (§4); the nine `Edit` operations (§5); the working store (§6); export (§7) |
| **SPEC-011** — here | Making seven of those nine operations reachable; how a segment is created, named, badged and toggled on a floor; `.ord` durability under real authoring load (§2) |
| **SPEC-012** | Pricing what is authored. Reads §4's surface; adds no structure |

`[F]` SPEC-008 §5: `insert` and `setDisabled` are surfaced today; `addSegment`,
`split`, `merge`, `setActive`, `rename`, `reorder` and `setSkippable` are built,
tested and behind a flag. `[D]` **This spec turns them on.** It adds no
operation, because the nine were designed together and the seventh was never
missing — only unreachable.

---

## 2. `.ord` durability — build and test this first

`[I]` The document is the artefact worth fifty hours (DESIGN §2). Segmenting a
2-1 route is a large, slow, entirely manual act of judgement, and the player
must never be asked to do it twice.

### 2.1 Forward compatibility is the load-bearing requirement

`[D]` **An unknown field is preserved, never dropped.** Parse keeps what it does
not understand and emit writes it back in canonical order.

`[F]` This is not hypothetical: SPEC-012 §8 will add per-segment analysis
metadata — badge position, badge icon, the player's note — and SPEC-011 §3 will
add more. Without preservation, opening a segmented route in an older build and
saving it **silently destroys** exactly the hand-authored work §2 exists to
protect, and nothing would report it.

`[D]` **`version` gates refusal, not silent coercion.** A file whose `version`
exceeds the build's is **refused with its version named**, not partially read.
`[D]` A file at or below it loads, and anything unrecognised rides through.

`[O]` Whether a load that carried unknown fields should say so — a quiet "saved
by a newer version; unfamiliar settings kept" — or stay silent. `[I]` Leaning
towards saying it once.

### 2.2 The store is not the document

`[F]` DESIGN §2.2: the working store is crash recovery in one browser on one
machine, and clearing site data, private browsing or quota eviction each discard
it. `[D]` So a long authoring session needs the `.ord` written to disk, and the
app must make that obvious rather than assume it.

`[P]` A **staleness cue** on the unsaved-changes marker — how long since the
last `.ord` was written, not merely that something is unsaved. `[I]` A marker
that has read "unsaved" for two hours has stopped carrying information.

`[O]` Whether to request `navigator.storage.persist()`. Carried over from
`TODO.md` §A6, still unanswered.

### 2.3 The stress case is a real route, not a fixture

`[D]` **Import iestyn's best 2-1 record, segment it heavily, and round-trip
it.** `[F]` The corpus has 326 records over 14 towers and the app already
imports every one (SPEC-008 oracle 1), but every one of those is a *one-epoch*
document. Nothing yet exercises a document with many epochs, many parallel
segments, names on both, and disabled actions scattered through — which is the
only shape this analysis will ever meet.

`[D]` Generated segmentations are the sweep; **one real hand-authored document
is the fixture that is allowed to be ugly**, and it is kept in the repository
once it exists.

---

## 3. The editing surface — stub

`[D]` Recorded so the decisions are not lost, and deliberately not resolved.
All of it is `[I]` from iestyn and all of it is judged by eye (D24a).

**Creating and naming.** A segment is cut from the timeline (SPEC-008 `split`)
or added as an alternative to an epoch (`addSegment`). `[I]` A **name is a
note to self** — the mnemonic structure by which a strategy is conceived
(DESIGN §6) — and is editable on hover.

**Badges on the floor.** `[I]` A segment shows as a clickable badge on the map.
The obvious placement — the segment's first tile — **fails immediately**: the
B1F Item Vault chain (SPEC-012 §2.1) is six cumulative segments that all begin
on the same tile. `[D]` So placement is **player-chosen**, collisions are
disallowed, and the icon is player-chosen too.

**Toggling.** `[I]` Click a badge to include or exclude the segment.
`[O]` Whether every segment shows at once is unresolved and is a clutter
question. `[P]` Show badges only, and reveal a **ghost of the segment's path**
on hover, kept on for enabled ones.

**Epoch boundary hints.** `[P]` Half Gate, Elixir and held-item icons on the
timeline slider, each with a click-to-split affordance. `[I]` The natural
divisions are usually obvious and mostly agreed on — but they are the player's
to draw, so this hints and never decides.

`[O]` Everything above resolves by use. `[I]` iestyn will drive it from real
route planning rather than from a mock.

---

## 4. What SPEC-012 reads

`[D]` The dependency surface, stated here so the two specs cannot drift. All of
it already exists in SPEC-008 except where marked.

| SPEC-012 needs | Comes from |
|---|---|
| The segments of an epoch, and which is active | `Epoch.segments`, `Epoch.active` (SPEC-008 §2.2) |
| Whether an epoch may resolve to nothing | `Epoch.skippable` — becomes `= 1` vs `<= 1` (SPEC-012 §5.2) |
| A segment's resource cost and gain | Differencing the fork's start and end `Player` (SPEC-008 §4) |
| A segment's power delta | The same difference, times its epoch's fate |
| Whether a segment takes a held item | `Player.held` across the fork — the capacity-1 row |
| A short label for the ranked list | `Segment.name`, and the floor name. **New:** an abbreviation rule (SPEC-012 §8, `[O]`) |
| Badge position and icon | **New here**, §3 — and the reason §2.1 matters |

`[D]` **SPEC-012 adds no field to the document and no structure of its own.**
Everything it computes is derived from a fork, so a `.ord` never stores a price
— which is right for the same reason SPEC-008 §3 refuses to cache a segment's
end state: a cached price is valid for exactly one selection and silently wrong
after any toggle.

---

## 5. Verification Contract — partial

`[D]` §2 carries a contract because it is buildable now. §3 carries none: it is
judged by looking (D24a), and saying so is the point.

```
Run: npm test && npm run typecheck
Report: test summary; PASS/FAIL + actual value per named case;
        invariant results; any file touched outside src/sim/route/, src/store/, src/ui/
```

**Invariants**

1. **Unknown fields survive a round trip.** Parse a document carrying fields no
   build knows, emit it, and compare byte-for-byte. `[D]` The D18 diagnostic
   for §2.1: it fails if a future field is ever dropped, and no other test in
   the suite would notice.
2. **Version refusal.** A `version` above the build's is refused, and the error
   names the version. A version at or below it loads.
3. **Heavy-document round trip.** For a document with many epochs, several
   parallel segments per epoch, names on both, and disabled actions throughout:
   `parse(emit(d))` equals `d`, and `emit` is byte-stable. `[D]` SPEC-008
   invariant 7 asserts this for one-epoch documents; this extends it to the
   shape SPEC-012 actually produces.
4. **Segmentation preserves the route.** Cutting a corpus record into epochs and
   segments in any arrangement leaves `flatten()` identical while every segment
   is active and nothing is disabled. `[F]` SPEC-008 invariants 1 and 2 already
   assert this; named here because it is what makes heavy authoring safe, and
   the sweep in oracle 1 is new.

**Oracle**

1. **The real document.** Import iestyn's best 2-1 record, apply a heavy
   authored segmentation, save, reload, and assert invariants 1, 3 and 4 plus an
   evaluation identical to the pre-save one. `[O]` Expected values are named
   once the document exists — it does not yet, and inventing them ahead of it
   would be inventing the route.

**Not verified here.** Everything in §3. `[D]` Stated so a green suite is never
mistaken for a usable editor.
