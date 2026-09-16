# NOTATION.md

`[I]` iestyn's shorthand for routes and trades, used in chat, in segment names
and in the specs. Recorded so it is one notation and not several.

Canonical. Extend it here rather than inventing a second form.

---

## Resources

| | | | |
|---|---|---|---|
| `W` | light key (white) | `B` | dark key (black) |
| `K` | either colour of key | `M` | master key |
| `G` | gold | `g` | gem (lower case; `G` is gold) |
| `P` | pickaxe | `H` | hyper pickaxe |
| `V` | vorpal blade | `D` | golden dagger |
| `C` | golden claymore | `KS` | keysmasher |
| `WW` | light rod (white wand) | `BW` | dark rod (black wand) |
| `1/2` | half gate | `2x` | elixir |

`K` exists because many floors are parity-symmetric and the colour does not
matter to the argument.

Two more that name structure rather than a thing:

- **`chain`** — a run of `1/2` gates, or a run of `2x` elixirs. `[I]` Most
  towers' strategy is demarcated by these, which is why they get a word. They
  are also what SPEC-012 §4's fate multiplier is computed from.
- **`exit`** — the way off this floor to the *next* one, where next means
  further from the tower's start: usually up, and down in the basement.

## Trades

An arrow is a trade. The left is spent, the right is gained.

```
-4P-> 10k B
```

Spend four pickaxes to reach a room worth `+10k` power and one dark key.

`[D]` **A bare number on the right is always power gained**; items are named
beside it. So `10k B` is "+10k power and a dark key".

`[D]` **Minus signs on the left are usually omitted** — being spent is implied
by the side it is on. They are kept where the reader might otherwise miss it.

**Multiples** use a colon:

```
-B-> 2:(-5k W)
```

One dark key opens a gate onto two rooms, each holding a `-5k` enemy and a
light key. The `-5k` is listed because it is **unavoidable**; an avoidable cost
is simply not written.

`[F]` **Multiples matter most for power, because `10:100` is not `1k`.** With
101 power you can take ten hundreds one at a time; you cannot take a thousand.
The form preserves the entry threshold, which a sum destroys.

`[D]` The colon is for **sets in parentheses**, and for counts where it reads
better. `4P` is unambiguous and shorter than `4:P`, so plain juxtaposition wins
for a simple count.

**Chained trades** put each link's output into the next:

```
5g-> P-> 5g-> P-> 10g-> P
```

Three gem gates in a line, each opening onto a pickaxe and the next gate. `[F]`
This is the shape SPEC-012 §2.1 prices as cumulative segments in one epoch.

**Parentheses** group a cost paid together:

```
(3W 4B) -> 5k P
```

**Gold from enemies** is written last, to the right, because it is a
by-product rather than the point:

```
W-> 50G -25k-> 4:10k  +25G
```

Spend a light key to reach a 50-gold bag, take a `-25k` to reach four `+10k`
enemies; the kills yield 25 gold on top of the bag. `[D]` A `D` or `C` held at
that point is accounted for in that trailing number (GAME_MECHANICS §5.2), so
the same room reads differently under a different held item — which is why it
would be two segments, not one.

**A floor prefix** marks a segment that lives on one floor but detours:

```
8F
 - 2:(W-> 1k)
 - B-> 4:(1k P)
 - 5k
 - 7F: -5k-> H
 - (4P H)-> 250G
 - 250G-> exit
```

## What it does not track

`[I]` **The held-item slot.** The notation records an item *gained* or *lost*,
never whether the slot is occupied. `[F]` SPEC-012 §5.3 needs the occupancy and
gets it from the simulator instead, which is the authority (GAME_MECHANICS
§5.4: pickup is mandatory and replaces).
