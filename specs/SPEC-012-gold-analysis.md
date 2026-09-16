# SPEC: Gold Analysis — what each trade is worth

Status: **draft 2**, 2026-09-12. Not started.
Depends on: SPEC-004 (simulation), SPEC-008 (epochs, segments, evaluation),
SPEC-011 (segment editing, and the `.ord` durability this spec's testing rests
on).
Load with this spec: `docs/NOTATION.md`, `docs/GAME_MECHANICS.md` §2, §4, §5;
`DECISIONS.md` D7, D11, D18, D30, D33, D46.

The player cannot have everything. Tower 2-1 *Tower of Loot* holds **76 Gold
Gates costing 6 794 gold**, and every bag and every enemy in it together yield
**3 166** — a shortfall of **3 628**. The tower *is* the choice of which trades
to make, and this spec says what each one is worth.

`[D]` **It prices trades. It never picks them.** DESIGN_ROUTE_EDITING §1: the
tool makes the player's own search faster and does not solve the route.

`[F]` **Draft 2 is a rewrite, not an edit.** Draft 1 was written in
linear-programming vocabulary and was not communicable: it took most of a
session to get its central idea across, and two of its recommendations were
wrong. Gone: the "plan" output, the "fixed pivot rule", and the words *shadow
price* and *reduced cost*. The primary display is now a **bar chart per
resource** (§8), which is the same information as draft 1's price table and can
be read without any of its vocabulary.

`[F]` fact · `[I]` iestyn said it · `[D]` decision · `[P]` proposal · `[O]` open

---

## 1. Terms

`[D]` These words, and not their textbook equivalents. The jargon is recorded
once, here, so the literature is findable and then never used again.

| Term | Meaning |
|---|---|
| **Resource** | A countable thing held: `G`, `W`, `B`, `P`, `g`, … (`NOTATION.md`) |
| **Score** | Power at the Crown. The one thing maximised. |
| **Trade** | One segment. Consumes resources, produces resources, may add Score. |
| **Stock** | How much of a resource is held at the point being analysed. |
| **Resource value** | *How much more Score you could finish with, given one more unit.* In **power per unit**. (Textbook: shadow price.) |
| **Trade profit** | *Score a trade adds, minus the value of what it consumes, plus the value of what it produces.* In **power**. (Textbook: reduced cost.) |

`[D]` **Both outputs are in power**, so nothing has to be converted in the
player's head. §5.4 offers gold as an alternative unit; power is the default
because every tower has it and it is the score itself.

---

## 2. A trade is a segment

`[D]` **The unit of analysis is a Segment (SPEC-008 §3), and nothing else.** No
separate trade object to author, no cost/revenue labelling pass, no dependency
language.

`[I]` This is the player's own working method: chunk the route into rooms, and
each chunk is a bargain to accept or decline. `[D]` It also settles what a
"room" is — exactly the actions put in the segment, a question the player
answered by authoring it.

A trade's vectors are **derived, never stored**:

```ts
interface TradeVec {
  cost: ResourceVec      // resources the segment consumes
  gain: ResourceVec      // resources it produces
  score: number          // direct power contribution, after §4's multiplier
}
```

`[D]` **Not `Bundle`** — D34. The Vite *bundle* owns that word (`assets.ts`,
`tools/atlas/build.ts`, D14b-1).

`[D]` **Computed by forking the segment from its epoch's start** — SPEC-008 §4
already does this for inactive segments, copies the cells and kills it is
handed, and cannot disturb the mainline (its invariant 8). This spec adds no
simulation machinery; it differences the fork's start and end `Player`.

`[F]` **So the vectors are always the game's own arithmetic** — the Adamantine
Shield's signed floor, the Keysmasher bonus, `D`'s `+2`, Battle Gates opening at
a distance — because a simulator computed them rather than an analysis
remembering to.

### 2.1 Granularity is the player's, and it is load-bearing

`[F]` The same situation reads differently at different granularity, and both
readings are correct:

| Authored as | Profit |
|---|---|
| `-10G-> W` and `-W-> 40k` as two segments | `+15k` and `+10k` |
| `-10G-> W-> 40k` as one segment | `+25k` |

`[D]` **Neither is preferred.** The player authors at the granularity they
reason at. `[I]` Pairing a cost with the gain it buys is how iestyn works on
paper, and is usually the more useful row in a ranked list.

### 2.2 Nested chains need no new concept

`[I]` 2-1's B1F *Item Vault* is a strictly nested staircase:

```
5g-> W-> 5g-> W-> 10g-> W-> 10g-> W-> 20g-> W-> 25g-> V
```

Cumulative: 5 gems buys one `W`, 10 buys two, 20 three, 30 four, 50 five, and
75 buys five `W` and the `V`. Mirrored east.

`[D]` **The player authors cumulative segments — `1`, `1-2`, `1-3` … — in one
epoch**, and epoch exclusivity (§5.2) does the rest: at most one is chosen, each
spans the chain from its start, so no selection can be infeasible and no
precedence constraints exist. The ranking reports which prefix is best.

`[D]` **Precedence constraints were considered and rejected.** They need an
authoring UI for dependencies, and where a chain begins is a tactical choice
belonging to the player.

### 2.3 Segments overlap, and the first one pays

`[I]` iestyn. A single action can belong to several segments: one locked gate
may open three corridors, and a trade for each corridor reasonably contains the
gate. Whichever runs **first** opens it; the others find it already open and get
it free. So a trade's cost depends on what else is enabled and in what order.

`[F]` **The fork already gets this right, and that is why no new machinery is
needed.** §2 derives the vectors by forking from the epoch's start in the
*current* state (SPEC-008 §4). A gate already opened is simply not paid for
again — the simulator charges what the move actually costs, which is nothing.

`[D]` **So the vectors are state-dependent, and are recomputed whenever the
enabled set changes.** That already happens: every toggle re-prices.

`[D]` **Attribution: the earliest enabled segment in epoch order pays.**
Deterministic, and it needs no new input because §6.1 already requires epoch
order to be part of the model.

`[F]` **This is the second threat to §5.1's linearity, and is handled the same
way as the first.** A trade whose cost depends on another trade's switch is not
linear — but attribution is resolved *before* the solve, so the solver still
sees constants. Like the held item, the non-linearity is pushed out of the
maths and into what a segment means.

`[D]` **A trade whose cost is entirely taken by others is refused — behind a
setting, default on.** `[I]` iestyn, and the default is provisional: it is there
to be found useful or annoying in real planning, not because the case is known
to be harmful.

`[F]` **The arithmetic does not need the refusal.** A zero-cost trade prices
perfectly well and the payer legitimately bears the cost. What the refusal buys
is only clarity, and it costs something real: order-dependence here is
**inevitable rather than a defect** — someone has to open the gate first — so
refusing may be refusing an honest answer. `[I]` If it proves annoying, turn it
off and the trade prices at zero cost, which is what actually happened.

`[I]` Where it is annoying, the authoring fix remains: merge the three corridors
into one trade, or leave the gate in only one of them.

`[D]` **What the player sees**, because a cost that quietly vanished is worse
than one that is paid:

- In the **resource panel**, a taken action greys out, with a tooltip naming
  the segment that took it and the steps where — *"opened by 5F Light Gate,
  steps 99-103"*.
- On the **timeline**, inserting a segment inserts its taken actions greyed,
  so the trade still reads as the whole thing it is.

---

## 3. Resources

| Resource | Notes |
|---|---|
| `G` | Produced by bags and kills, consumed by Gold Gates |
| `W`, `B` | `[F]` under `negative_keys` there is one signed counter — GAME_MECHANICS §4.1 |
| `P`, `H` | |
| `g` | **Endowment only**, and a required separate input — §3.1 |
| power | The objective, and not linear — §4 |
| slot | The held-item slot, capacity **1 per epoch** — §5.3 |

`[D]` **An endowment is a stock with no producer.** `[I]` A loose `V` lying on
the floor is the same shape from the other side — a trade with an empty cost —
so "the first two `V` are free, later ones are bought" needs no special case.

### 3.1 The gem budget is a required input, and D46 is why

`[F]` **D46: gem gates never refuse.** A route carries
`gemsOwned = Number.MAX_SAFE_INTEGER`, a sentinel meaning "enough for every
gate", because planning a route that becomes viable at a future gem total is the
thing the player most wants to do.

`[D]` **That sentinel cannot be the analysis input.** An unbounded stock is
never exhausted, so its value is zero, so **every gem-priced trade prices as
free** — the B1F chain's `V` would rank as pure profit at no cost.

`[D]` So the analysis takes a **separate, finite gem budget**. The *simulator*
keeps the sentinel, so no route is refused; the *ledger* prices against a real
number. `[I]` It is how iestyn already works — D46 records a game-wide **gem
schedule**, and this is that schedule as an input rather than on paper.

`[D]` **Default is the player's actual gem count**, and sweeping it is a
first-class use: *what becomes worth doing at 90 gems?* is one re-solve.

---

## 4. Power is not a linear resource

`[F]` GAME_MECHANICS §4: an **Elixir** is `power += min(power, 1e9)` and a
**Half Gate** is `power -= floor(power/2)`. Both are multiplicative. Power
banked before a `2x` is worth double at the Crown; before a `1/2`, half.

`[D]` **Every quantity is denominated in power at the Crown.** Each epoch
carries a **fate multiplier** — the product of the `2x` and `1/2` factors
downstream — and a segment's Score contribution is its raw power delta times
that multiplier.

`[I]` iestyn calls this *power fate*, and it is why analysis is scoped to
epochs. An epoch followed by a `chain` of three `2x` has a fate of **×8**. The
strategy it prices is already the player's: **positive enemies in the
highest-fate epoch, negative enemies in the lowest**, and where a `1/2` blocks
the route, *throw power over the gate* by paying negative enemies before it to
unlock at least as much after.

`[D]` **Without this the analysis is wrong, not merely imprecise**: one
power-to-gold rate across a route containing a `1/2` misprices everything on one
side of it by 2×.

`[F]` **It reprices `M` sharply.** GAME_MECHANICS §5.1: on a `1/2` a Master Key
opens the gate with *no power loss at all*, so its value there is the whole half
that would have been lost — a number this prints, where it was a judgement call.

`[O]` **The Dark Crown doubles the submitted score** (GAME_MECHANICS §6.2), so
a route ending on one arguably carries a further ×2. `[I]` Possibly confusing,
possibly useful for aiming at a grade threshold. Default **off**; it scales
every trade equally, so it can never change a ranking.

---

## 5. The algorithm

Each candidate segment *i* gets a switch `x_i`.

```
maximise   sum_i  score_i * x_i
such that  for each resource r:
             stock[r] + sum_i (gain_i[r] - cost_i[r]) * x_i  >=  0
           epoch rows (5.2)
           0 <= x_i <= 1
```

Solved by **simplex**. A few hundred columns against a few dozen rows is a small
dense problem; §11 oracle 1 holds it to one frame.

### 5.1 Why the values fall out, and why they are trustworthy

`[F]` The solver cannot stop until certain no change improves the Score, and
checking that requires knowing what each resource is worth at the margin. **The
values are not computed afterwards; they are what it needed in order to know it
was finished.**

`[F]` **And local really is global here, because the problem is convex.** The
objective is a weighted sum and every constraint is a weighted sum, so the legal
region has flat faces and no dents: the straight line between any two legal
plans stays legal, and Score changes at a constant rate along it. So if a better
plan existed anywhere, the first step toward it would already improve — there is
nowhere for a better answer to hide.

`[F]` **This is exactly what 0/1 switches would destroy.** With nothing between
off and on there is no line to walk, local peaks appear, and the values stop
certifying anything. §5.5 is why we do not need them.

`[F]` **The one real threat to linearity is the held item**, since a room is
worth more while `C` is held. It stays linear only because a segment is
simulated with a *definite* held item, so its numbers are constants: "that room
with `C`" and "that room without" are two segments in one epoch. The
non-linearity is pushed into authoring, which is more weight on §2's structure.

### 5.2 Epoch semantics *are* the constraint rows

`[D]` SPEC-008 §3 already distinguishes four cases, each one row. Nothing new is
authored:

| Epoch, as SPEC-008 defines it | Row |
|---|---|
| plain, one segment | `x = 1` — **forced** |
| skippable, one segment | `x <= 1` — optional |
| parallel, *n* segments | `sum x = 1` — must pick one |
| parallel **and** skippable | `sum x <= 1` — pick at most one |

`[F]` **Exclusivity is load-bearing, not tidiness.** Without those rows a solve
of 11F *Final Mugging* took all three entrances to one room and banked its
contents three times.

`[D]` **A forced epoch never appears in the ranking.** It is not a choice. It
shows in a **fixed** section, consumes its resources, and reaches the player as
movement in every other value — which is what should happen to an obligatory
trade like 4F's `200G-> exit`.

### 5.3 The held slot

`[D]` **One capacity-1 row per epoch**, over the segments in it that carry a
held item. `[F]` GAME_MECHANICS §5.4: pickup is mandatory and replaces what is
held, so two held items cannot coexist in one span. `[I]` This is the
coarse-grained strategic decision the player is making, and is why epochs are
the unit rather than floors.

### 5.4 Units

`[D]` **Power at the Crown by default**, gold offered as a toggle. `[I]` Power
is common to every tower and is the score; gold exists only in the seven
`money_system` towers, but 2-1's thresholds are Gold Gates, so gold is more
convenient when aiming at the next one.

`[D]` **Everything displays in one unit at a time.** `[F]` A mixed table is
unreadable — "1 gold = 400 power, 1 `B` = 12.5G" asks the reader to multiply in
their head. `[F]` The choice cannot change a ranking, being a positive scaling
of every profit, which §11 asserts.

### 5.5 The plan is computed and never shown

`[D]` The solver's own `x` values are **not an output**. Draft 1 displayed them
and they were the single most confusing thing in it: `x` is fractional in
general, and "take 0.18 of a gate" means nothing to a player.

`[D]` **Nothing is lost by dropping it.** The ranking is what the player acts
on, and the selection is theirs. `[I]` The trade-offs *are* the game.

`[D]` **And it removes a whole machine**: forcing 0/1 would need branch and
bound, which §5.1 shows would also cost the guarantee that makes the values
mean anything. D11.

`[F]` The fractions are a **measuring device**, and a necessary one: you cannot
ask what one more gold is worth if the cheapest thing to spend it on costs 20.

---

## 6. Two modes, and only one of them simulates

`[D]` **Ledger mode — order-free.** Sum the selected trades. Resources may go
negative. No ordering, no reachability. This is where the player experiments:
aim at a `250G-> exit`, watch gold go red, add negative-enemy segments until it
is black.

`[D]` **Route mode — SPEC-004, unchanged.** Ordering, reachability, every
refusal rule. Where a selection becomes a route that runs.

`[D]` **The split is what keeps SPEC-004 untouched.** `TODO.md` carries
`[O] Let the simulation go negative` as blocked on `1/2`, `2x` and `KS`, and the
blocker is real: `power += min(power, 1e9)` on negative power *decreases* it. A
ledger has no such problem because it applies no rule, only sums.

`[O]` **A negative-tolerant simulator is still worth trying.** `[I]` iestyn's
rule set culls the nonsense without inventing anything: **below zero, `1/2` and
`2x` are no-ops; with a negative key count `KS` is a no-op**; proper arithmetic
resumes as each epoch goes green. `[D]` **Build both and use them on real
routes** — which is easier to plan against is not settleable by argument.

### 6.1 Working an epoch at a time

`[I]` iestyn's workflow: enable and disable the segments of one epoch until the
resources balance, then move to the next.

`[D]` **Totals head the trade list**: gained minus spent over enabled segments,
one line per resource.

`[D]` **Seed from the timeline where it can be trusted.** If the route is green
up to this epoch's start, the opening balances are the simulator's actual
`Player` there and the totals are real. `[D]` Where it is not green they are
**speculative** and say so: zero at the start of time, every enabled segment
assumed to run, propagated epoch to epoch.

`[F]` **So epoch order is part of the model**, which §4's fate multiplier
required anyway.

`[D]` The two readings are **marked, never blended**: a measurement and a plan
must not look alike.

---

## 7. Where a value is a range

`[D]` A resource's value is a **slope**, and slopes have kinks. This section
exists because the kink is the one part of the method that misleads on first
contact.

**Sort every use of a resource by power per unit, best first, and draw a line
where the stock runs out.** For 30 gold, with `W` at 10G/20G/40G opening rooms
worth 40k/30k/15k:

| use | power per gold | gold | running total |
|---|---|---|---|
| `-10G-> W-> 40k` | 4000 | 10 | 10 |
| `-20G-> W-> 30k` | 1500 | 20 | **30** ← the line |
| `-40G-> W-> 15k` | 375 | 40 | 70 |

- **One gold more** buys into the next row: **375**.
- **One gold less** gives up the row above: **1500**.

`[F]` Both are correct. The value is the interval **375 – 1500**, and it is not
a spread over all uses — it is the two rows **adjacent to the line**.

`[F]` **The range appears only when the line falls exactly between two rows** —
when the stock exactly finishes a whole number of uses. With 20 gold the line
falls *inside* the second row and both slopes are 1500: one number, which is the
normal case. `[D]` So "range" means *exactly on a boundary*, never "nearly out".

`[D]` **Measure both sides directly: re-solve at stock ±1.** Two extra solves,
sub-millisecond. `[F]` Draft 1 recommended a fixed pivot rule instead, which was
wrong — it makes the solver's arbitrary choice *repeatable* without making it
*right*, and would show one end of the interval as though it were the answer.

`[F]` **This is what made draft 1's worked example unreadable.** Its prices
appeared to change between steps while nothing in the world had; the solver had
hopped from one end of a kink to the other. A six-trade toy was enough to
produce it, so it is not a corner case.

`[D]` **The bar chart (§8) is the resolution.** Drawn, a kink is where the line
falls between two bars and needs no explanation at all.

### 7.1 The other things that are not exact

- **The relaxation.** Values come from a world where trades can be split, so
  they are mildly optimistic. Trust the sign and large gaps; two trades within a
  few percent are not distinguishable.
- **Tied plans, which are a different tie.** Several selections can score
  identically. That is one optimal Score with many optimal plans, where §7's
  kink is one optimal plan with many valid values. `[D]` Worth keeping distinct:
  the first is a real choice offered to the player, the second is an artefact.

---

## 8. What the player sees

`[D]` Behaviour lands in `docs/UI.md` when built (D31). Recorded here so the
migration is part of the work.

### 8.1 The bar chart, per resource — the primary display

`[I]` iestyn's design, and it replaces draft 1's price table.

```
 power
 per     4000 ┤███
 unit         │███
         1500 ┤███ ██████
              │███ ██████
          375 ┤███ ██████ ████████████
            0 ┼───┴──────┴────────────┴────
              0  10     30           70   G
                         ▲ stock      ▲ goal
```

One **bar per trade** that consumes the resource, sorted tallest first. Bar
**height** is power per unit; bar **width** is how much it consumes. A vertical
line marks the stock: everything left of it is affordable, everything right is
not.

`[D]` **Bars, not a curve.** `[I]` Flat treads say *one trade, indivisible*,
where a smooth curve would imply fractions the player cannot buy. The chart is
also the honest picture of §5.5's measuring device: the fractions live under the
bars and are never drawn.

`[F]` **It answers the aggregate question a number cannot.** Many towers force
doubling down on one resource, and **2-2 *Artificer's Task* B4F is the clean
case**, verified in the map data:

```
row 1,  x 3..14   twelve Weak Walls   -> $250 at (2,1)      -12P-> 250G
col 1,  y 3..14   twelve Light Gates  -> $250 at (1,2)      -12W-> 250G
```

Two 250-gold bags on one floor, one behind twelve `P` and one behind twelve `W`,
and the budget for both is rarely there. Two charts side by side, and the one
that is taller across its first twelve units wins.

`[F]` It is also a **step function with a cliff at exactly 12**, so it is the
sharpest possible illustration of §8.2's goals: eleven keys buy nothing.

`[F]` **And it reads as a plan.** 2-1's pickaxes have two tall bars — the 11F
rooms at ~30k each — and then a cliff, which says *get exactly two `P`* with no
arithmetic.

**A trade consuming several resources** appears in every chart it touches, and
its Score has to be divided between them. `[I]` iestyn: split it
proportionately — `3W 1B -> 40k` puts 30k on the `W` chart and 10k on the `B`.

`[D]` **Generalised: split in proportion to `quantity × resource value`**, which
is that rule when the resources are equally valued and stays right when they are
not. `[F]` Splitting on raw quantity alone breaks across unlike resources —
`3W 250G -> 40k` would put 99% of it on the gold chart for no reason but the
size of the number.

`[D]` **Display only.** The split never enters the solve, so its dependence on
the values it is drawn from is harmless: use the values from the solve just
finished.

`[F]` **The split is not what misleads. The stock line is.** A chart's premise is
that bars left of the stock line are affordable, and that premise is only true
for a trade this resource alone gates. A trade needing `1H 30G` sits left of the
gold line whenever the gold is there — **including when you hold no `H`** — so
the gold chart offers something that cannot be had. No division of the Score
fixes this, because it is not about height.

`[D]` **Hatch a bar that another resource blocks**, with a tooltip naming what
is missing. One chart per resource is kept, and the line stops lying.

`[P]` The alternative, if hatching proves noisy: put each trade on **only** the
chart of its tightest resource, so it appears once and needs no split at all.
`[D]` Not chosen — a trade would move between charts as the plan changes, and a
chart that reshuffles under you is worse than one with hatching on it.

### 8.2 Goals

`[I]` A goal is a **second line on the chart**, set by dragging it. The player
states a high-level plan — `8:P 12:W by epoch 3` — and the tool tracks it.

`[D]` Displayed as **`have:want`**, red short, green met, blue excess.

`[I]` Three tiers, and this is the top one:

| Tier | What | Where |
|---|---|---|
| **High** | goals per epoch | §8.2 |
| **Mid** | trades, the way to hit them | this spec |
| **Low** | the action timeline, stitching trades into a route that runs | SPEC-008 |

`[F]` **Segments beat tile markers for this.** `[I]` iestyn marks decisions
in-game by overlaying `markers.png` icons on tiles — a no-entry sign on a gate
he will not open. A segment carries the same decision *with its cost attached
and its pairing enforced*, so it is strictly more information and needs no new
store.

### 8.3 The ranked list

One row per candidate: floor name, the trade in `NOTATION.md` form, its profit,
and a quality bucket. Sorted by profit.

`[D]` **Three buckets to start**, five if three proves too coarse. `[O]` The
width that would make a bucket a real claim — *this analysis cannot tell these
apart* — needs the measurement in §11 oracle 2; draft 1 asserted a principle it
could not yet apply.

`[D]` **A swap is two rows, subtracted.** `[I]` The common question is "is
turning off A to afford B worth it", and it needs no new machinery:

```
turn OFF  -P-> 3:10k     -12 400
turn ON   -B-> -25k 3:10k  +9 100
net                        -3 300
```

`[F]` A competing use in another epoch is priced **only if it is authored as a
segment**. `[I]` An argument for authoring aspirational segments early, even
ones that will not be taken.

### 8.4 The rest

- **A fixed section** above the ranking, for forced epochs (§5.2).
- **Terminal balances** per resource. `[I]` Congruent with the existing player
  status row, and what makes the last few percent tunable by hand: 43 gold
  stranded is wasted potential, visible only if shown.
- **The gold cheat sheet**, at the head of the list: ten enemy tier icons, and
  under each the gold for a kill — base, with `D` (`+2`), with `C` (`×2`).
  `[F]` GAME_MECHANICS §5.3: `D` and `C` are an `elseif` and cannot combine.

| Tier | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| base | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| `D` | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
| `C` | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20 |

`[F]` 2-1 holds **one `D`**, floor 12 at `(8,5)`, and **no `C`**. 147 enemies
stand at or above it, so held to the Crown it is worth **+294 gold** against a
shortfall of 3 628.

`[O]` **A per-floor overlay** — click a floor, its trades arrange around the
periphery, each joined by a gold line to its segment's first tile.

`[O]` **Epoch-boundary hints on the slider** — `1/2`, `2x` and held-item icons,
with click-to-split. `[I]` Hints at the natural divisions without choosing them.

`[O]` **Named selections**, to compare two candidate sets. `[I]` Agreed in
principle, more UI, deferred.

`[O]` **Floor-name abbreviation.** Some towers prefix a floor number and some do
not; the ranked list needs a short stable label.

---

## 9. Worked example — 11F *Final Mugging*

`[F]` Real prices from *Ye Olde Shoppe* (floor 5): `P` and `B` both at
**25 / 30 / 35 / 40 / 50** gold. Real rooms from floor 13, three entrances to
one 2×2, which is one epoch of three segments:

```
-P->  3:10k          weak wall (7,7) — skips the -25k
-P->  -25k 3:10k     weak wall (7,6) — lands on it
-B->  -25k 3:10k     Dark Gate (6,5) — lands on it
```

Mirrored east. Stock 300 gold, unit power.

```
1 gold = 400      1 P = 12 000      1 B = 0 (unexhausted)

  +18 000   11F  -P-> 3:10k                 (west)
  +18 000   11F  -P-> 3:10k                 (east)
   +2 000   3F   -25G-> P
        0   3F   -30G-> P        <- the line falls here; this sets the value
   -2 000   3F   -35G-> P
   -7 000   11F  -P-> -25k 3:10k
  -10 000   3F   -25G-> B
  -20 000   3F   -50G-> B
```

`[F]` **The marginal purchase sets the value**, which is the argument for this
over averaging: `P` prices at exactly what the 30G one costs, and the 25G one
shows profit *because it is cheaper than the one at the line*. An average over
the five (36G) states nothing true about any of them.

`[F]` **Every `B` in that shop is a loss at these values**, because the only
thing a `B` buys on this floor is a forced `-25k` entrance worth `+5k`. A
finding about the tower, not about the method.

---

## 10. How iestyn evaluates this by hand

`[D]` Separate from §11, and neither substitutes for the other. §11 asserts the
arithmetic is self-consistent; **this list asks whether the analysis is any use
in planning a real route**, which is D24a applied to numbers instead of pixels.

`[D]` Each case names a thing to set up and the question to answer. `[I]` The
answers go in `docs/TODO.md` as they come, not here.

1. **Two trades sharing an action** (§2.3). Find a gate opening several rooms,
   author a trade per room with the gate in each, and enable them one at a time.
   *Does the greyed action and its tooltip make it obvious where the cost went?
   Is the zero-cost refusal useful, or is it in the way?* `[I]` The refusal's
   default is riding on this one.
2. **The 2-2 B4F choice** (§8.1). `-12P-> 250G` against `-12W-> 250G`. *Do the
   two charts settle it faster than doing it on paper, and do they agree with
   the answer reached on paper?*
3. **A `1/2` chain** (§4). Author trades either side of one. *Does power fate
   make the "throw power over the gate" reasoning visible, or does it have to
   be held in the head anyway?*
4. **The B1F gem chain** (§2.2). Author it as six cumulative segments in one
   epoch, and separately as six independent ones. *Which reads better, and does
   the cumulative form actually answer "which prefix is best"?*
5. **Granularity** (§2.1). Author one room as `-10G-> W` plus `-W-> 40k`, then
   as a single `-10G-> W-> 40k`. *Which row is more useful in the ranking?*
6. **A kink** (§7). Contrive a stock that exactly finishes a use. *Is the range
   legible on the chart without explanation?* `[F]` This is the thing that took
   a whole session to explain in words.
7. **Against a known route.** Price the trades of an existing best 2-1 run.
   *Does the ranking agree with the choices already made, and where it
   disagrees, is the analysis wrong or was the route?* `[I]` The most valuable
   of these, and the one that needs SPEC-011 first.

---

## 11. Verification Contract

```
Run: npm run parse-towers && npm test && npm run typecheck
Report: test summary; PASS/FAIL + actual value per named case;
        invariant results; solve time median/max;
        any file touched outside src/analysis/, src/ui/
```

`[F]` **`parse-towers` comes first because the tower JSON is built, not
committed** (`tools/paths.ts`, `build/towers/`). The figures below were measured
against the same data when it was still committed; the parser is byte-exact, so
they are unaffected. A missing file means the build has not run, not that the
numbers are wrong.

**Named cases with exact expected values** — tower 2-1, `v0.7-455`.

| Case | Expected |
|---|---|
| Gold Gates in 2-1 / total cost | **76** / **6 794** |
| Gold Bags / total | **58** / **1 275** |
| Enemies / of which negative | **568** / **212** |
| Gold from killing every enemy, base tiers | **1 891** |
| Maximum naive gold, bags + all kills | **3 166** |
| Shortfall against every gate | **3 628** |
| `D` / `C` in 2-1 | **1** at floor 12 `(8,5)` / **0** |
| Enemies at or above floor 12 | **147** → `D` worth **+294** gold |
| `money_system` towers in the game | **7** — 2-1 … 2-6, EX-2 |
| Shop prices, `B` and `P` (floor 5) | **25, 30, 35, 40, 50** each |
| §9: value of `G` / `P` | **400** / **12 000** |
| §9: Score | **158 000** |
| §7 toy: value of `G` at stock 30 | the interval **375 – 1500** |

**Invariants**

1. **The values certify the answer.** At the optimum, Score equals the stocks
   priced at their values plus the epoch rows at theirs. `[D]` One line, and it
   fails loudly if the value extraction is wrong — the part most easily wrong
   and least visibly so.
2. **An unexhausted resource is worth nothing.** If a resource has slack its
   value is 0; a trade taken fractionally has profit 0.
3. **Profit signs.** Every trade the solver takes has profit `>= -eps`; every
   one it refuses has profit `<= eps`.
4. **Unit invariance.** The ranked order is identical in power and in gold.
   `[D]` D18 diagnostic: it would differ if a value were divided
   inconsistently, which no other test would catch.
5. **Epoch exclusivity.** No solution takes more than one segment of an epoch; a
   non-skippable epoch takes exactly one. `[F]` The three-entrances bug (§5.2).
6. **Kink detection.** For the §7 toy the two re-solves return 375 and 1500, and
   the display shows a range. `[D]` Diagnostic for §7: a single number here
   means the ±1 measurement was skipped, which is exactly draft 1's error.
7. **`TradeVec` fidelity — the load-bearing one.** For a selection in which
   every epoch is forced, the ledger's per-resource totals equal the difference
   between the simulator's start and end `Player` over the same route. `[D]`
   This ties the vectors to SPEC-004 rather than to a second, silently divergent
   model of the rules. If the analysis ever forgets the Shield's floor or `D`'s
   `+2`, this says so.
8. **Fate multiplier.** For a route with no `2x` and no `1/2`, every epoch's
   fate is exactly 1, and Score equals raw power delta.
9. **The gem sentinel never reaches the ledger.** The analysis refuses a gem
   stock of `Number.MAX_SAFE_INTEGER`. `[D]` D18 diagnostic for §3.1: with the
   sentinel every gem trade prices as free, which is a plausible-looking ranking
   and a wrong one, so it must fail loudly rather than read oddly.
10. **No UI import in `src/analysis/`.** A grep, as D7 requires — folded into
    the existing one rather than a second (SPEC-008 invariant 9).

**Oracles**

1. **Solve cost.** `[D]` The budget is SPEC-008 oracle 4's: **one frame, 16 ms;
   ceiling 33 ms**, because a re-price happens on every toggle and a toggle is a
   click in a stream. `[F]` Note the ±1 re-solves of §7 make it **three** solves
   per resource per update, not one. Report median and max.
2. **Kink census.** `[O]` Over 2-1, count how often a value lands on a boundary
   and how wide the interval is when it does. Decides §8.3's bucket width, which
   cannot be chosen before it.

**Not verified here.** Everything in §8 — the charts, the goals, the buckets,
the cheat sheet's legibility. `[D]` Judged by looking (D24a), and stated so a
green suite is never mistaken for a usable analysis.
