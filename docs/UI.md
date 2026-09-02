# UI.md

**What the app currently does**, in natural language. Current state only.

Read with `SPEC-007` and `SPEC-008`, which hold the numbers: constants and
interfaces there, observable behaviour here. Rules and the 150-line budget: D31.

---

## 1. Shell and loading

On first run the app is only the way in: a large **Open a save file or a route**
target that also takes a file dropped anywhere on the window. A `.sav` is
imported from; an `.ord` is reopened. The empty state names where saves live,
and carries the unofficial notice and a line saying routes live in `.ord` files
the player keeps while the browser's working copy is crash recovery, not a
backup. A working copy from a previous session is offered back, with when it was
written and that warning again; one that crashed *during* load is discarded
instead, and the app says so.

Opening a `.sav` lists its records at once: name, timestamp where there is one,
and three figures simulated behind the list, `…` until each lands — final power,
highest floor, waypoint stops. Player-named records sort above the `AUTOSAVE_*`
ones, those names being the player's own index. A record using orbs is listed
but not openable, and says why. The tower comes from the filename; if that names
no tower we know, the app asks. An `.ord` names its own tower, and is asked
which route only when it holds more than one. Choosing one replaces the empty
state with the two panels, over a toolbar: close, undo and redo, the epoch
commands of §6, save `.ord`, export `.sav`, a **screenshot** button writing the
exact 1× frame to a PNG, and the keys.

## 2. Timeline panel

The left panel is a horizontally scrolling strip of floors in the order the
route visits them, each tile captioned with its name and which visit it is. A
floor earns a tile only where the player **acts** on it; floors merely walked
through get none, and the trail crosses the gap in one dashed segment so it
reads as travel. The route is cut into **scroll units**: runs whose floors all
fit at once. Inside a unit each floor has one tile and the strip does not move;
it shifts only when scrubbing leaves the unit, so a three-floor tower never
scrolls. Scroll units are a **view** device — recomputed on resize, never saved,
and not the route segments of §6. D34.

Tiles lie in two rows, each offset half a tile-width from the last, in a
bricklayer pattern; every one has a border and a gap. At least three are
visible, a wider window showing more. When the strip does move it glides, easing
over about half a second and landing on whole pixels. The captions can be
switched off, which gives their height back to the floors.

## 3. The route trail

A line runs through the route's waypoints over the floors, connecting them
directly rather than following the walked path. It crosses between tiles, so
stairs read as one continuous line; those crossings are dashed as travel. Both
halves are lavender, separated only by hue: the past shifted towards blue, the
future towards red. Both carry a black outline, and both fade to nothing two
stops either side of the scrub position — a narrow reminder, not a whole-route
overlay. **Once the route breaks**, that pair is replaced by green as far as it
gets and red from the action that breaks it, and not before. The future draws
before the past and the segment at the scrub position draws last; the player is
drawn at the current waypoint in the state *after* that action, with its power
beneath it.

## 4. Control panel

The right panel holds a fixed shape at any window size while the left panel
takes the rest. It is headed, as the game is, with the tower name over the
floor name.

**Scrub slider.** Vertical, running **upward**: the first action is at the
bottom, as floor 1 is in the stack beside it. It stops once per action plus once
at the final position, not once per simulated step. Ticks mark floor changes; a
counter reads which action you are on. The handle is an hourglass on its side,
crossing the track at its waist: wide enough to grab, pinched so it never hides
its tick. The track carries §3's verdict, green then red, and nothing while the
route runs clean.

**Tower stack.** The whole tower as a vertical stack of floors, each squashed
and raked over at **2:1**, reusing the timeline's floor images so the two agree.
The squash is filtered, not sampled: each pixel averages the pixels it stands
for. **The whole tower always fits — nothing scrolls.** Floors are spaced to
fill the panel and centred in it, so a tall tower's floors overlap, each showing
a band of itself behind a 2 px outline; a short tower spreads out instead, to a
limit of two pixels of air. Every floor is drawn identically: the current one is
marked by being drawn last, with a lavender outline, and by being the only one
labelled — not by being enlarged. Nothing in the stack moves as you scrub.

**Player status.** A column right of the stack: power, light keys, dark keys,
pickaxes, gold, gems spent, held item. Numbers are right-aligned into a centre
gutter with labels beside it. Some rows carry a sprite rather than a word, as
the game labels them; the held item is the one row whose *value* is a sprite.
Power is shown in full with the game's dot separators — `1.284.900`, never
`1.28M`. Gems are an amount **spent**. Dark keys, gold and the held item are
absent where the game omits them too.

**Settings.** Below everything: a performance test, and floor captions.

## 5. Presentation

Everything is drawn as the game draws it — the same tiles, the same bitmap
fonts, whole-number scaling, no smoothing, so pixels stay square at any window
size. The game's pixel-perfect and filtered-upscale settings are mirrored here,
but zoom is the app's own, on `+` / `-` with `0` for automatic: the browser's
scales the canvas by a fraction when the whole point is whole numbers.
The game is monochrome apart from the player, and so are we: the player carries
the game's own cyan tint. Every other colour is ours, and belongs to things the
game does not draw — the trail and the editing marks now, the overlays later.

## 6. Editing

**Three mutually-exclusive mode buttons** sit at the top-right of the left
panel: a play icon for scrubbing, minus for removing, plus for adding, on `1`,
`2` and `3`. The slider, the arrow keys and `Z` / `Y` are live in all three;
`Z` and `Y` single-step the history as the game's own undo and redo do.
**In add mode** a left-click paths the player to the clicked tile and performs
whatever action is implied, exactly as the game does; a click implying no action
is ignored. **In remove mode** a left-click toggles the clicked action, the one
nearest the slider where a route visits a cell twice. An **added** action is
outlined green with a `+` badge; a **disabled** one is outlined red with a *no
entry* badge and keeps its place on the floor rather than on the slider. Both
carry a drop shadow.

The segment the slider is in wears a **bracket** over its tiles, labelled with
its name and whether the epoch is skippable or was skipped. Where an epoch holds
alternatives each gets a **pip** below the bracket: filled for the live one,
green or red for whether the others would pass from that point. Clicking a pip
switches to it, and the colours downstream answer immediately. A break shows a
red outline on the cell and, below it, **why** — *no light key*, *4 000 short*.

The toolbar holds what a click cannot: **split here** cuts the epoch at the
current action, **merge next** puts it back, **add alternative** and
**skippable** are features 2 and 3, and **rename** names the segment.
Anything that changes the document sets the **unsaved-changes marker**, in the
toolbar and the tab title, and pushes an undo entry; scrubbing, mode and the
option toggles do neither. **Save `.ord`** clears it. **Export `.sav`** writes a
fresh, uniquely named file, never an overwrite, and refuses a route that fails.

## 7. Open questions

Answered ones move out — to `DECISIONS.md` if the reasoning matters, else above.

- **The trail is anti-aliased and the stack filtered**, where the game is not.
- **How big the stack should be**, and whether overlapped floors stay legible on
  a 32- or 75-floor tower.
- **Freezing past and future floors** as you scrub: the past at its final state,
  the future at its initial one.
- **Whether a scroll unit should ever be narrower than the screen.**
- **Whether the outline around edited actions reads well**, and whether live
  actions should carry one too.
- **Whether an ignored click in add mode should still move the player icon.**
