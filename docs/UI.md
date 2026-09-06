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
backup. A working copy from a previous session is offered back with that warning
again; one that crashed *during* load is discarded instead, and the app says so.

Opening a `.sav` lists its records at once: name, timestamp where there is one,
and three figures simulated behind the list, `…` until each lands — final power,
highest floor, waypoint stops. Player-named records sort above the `AUTOSAVE_*`
ones, those names being the player's own index. A record using orbs is listed
but not openable, and says why. The tower comes from the filename; if that names
no tower we know, the app asks. An `.ord` names its own tower, and is asked
which route only when it holds more than one. Choosing one replaces the empty
state with the two panels, over a toolbar: back to the records, the route's
name — editable there — save `.ord`, export `.sav`, and a **screenshot** button
writing the exact 1× frame to a PNG. Going back returns to the record list
rather than the file picker.

## 2. Timeline panel

The left panel shows the floors the route visits, each tile captioned with its
name and which visit it is. A floor earns a tile only where the player **acts**
on it; floors merely walked through get none, and the trail crosses the gap in
one dashed segment so it reads as travel.

The route is cut into **working sets**: runs whose floors all fit at once. The
panel shows one at a time and **nothing scrolls** — it jumps to the next set
when scrubbing leaves this one, so a three-floor tower never changes at all.
Working sets are a **view** device, not the route segments of §6. D34.

Tiles fill the panel in reading order, left to right and then down, **sorted by
floor number** — which floors a set holds is the route's business, the order
they sit in is not, and entry order put 7F left of 3F whenever the route reached
it first. As many as the window and the zoom allow, the block centred in
whatever room is left. Every
one has a border, a gap, and a name strip under it — which is also where the
current action is summarised (§6).

## 3. The route trail

A line runs through the route's waypoints over the floors, connecting them
directly rather than following the walked path. It crosses between tiles, so
stairs read as one continuous line; those crossings are dashed as travel. Both
halves are lavender, separated only by hue: the past shifted towards blue, the
future towards red. Both carry a black outline, and both fade to nothing two
stops either side of the scrub position — a narrow reminder, not a whole-route
overlay. **It says tense, not verdict**; the slider says verdict. `[O]` **trail behind**
draws it under the floors instead, at one strength rather than fading — visible
only where the floor is, so it can never cover a cell. On trial.

## 4. Control panel

The right panel holds a fixed shape at any window size while the left panel
takes the rest.

**Scrub slider.** Vertical, running **upward**: the first action is at the
bottom, as floor 1 is in the stack beside it. It stops once per action —
disabled ones included, which keep their number and their place — plus once at
the final position. Ticks mark floor changes. The handle is an hourglass on its
side, crossing the track at its waist. **The track is the verdict**: green the
whole way from a clean load, turning red from the action an edit has broken. An
**exclamation** sits left of the track at the break, and brightens under the
pointer, being also the control that seeks to it.

**Tower stack.** The whole tower as a vertical stack of floors, each squashed
and raked over at **2:1**, reusing the timeline's floor images so the two agree.
The squash is filtered, not sampled: each pixel averages the pixels it stands
for. **The whole tower always fits — nothing scrolls.** Floors are spaced to
fill the panel, so a tall tower's overlap behind a 2 px outline, each showing a
band of itself; a short tower spreads to a limit of two pixels of air. Every
floor is drawn identically: the current one is marked by being drawn last, with
a lavender outline, by being the only one labelled, and by being the only one at
full contrast — the rest are pulled halfway to mid-grey. Nothing moves as you
scrub.

**Player status.** Two lines of header, over a **divider**. The tower's name
leads the first, with **Power** at its right: in full, with the game's dot
separators — `1.284.900`, never `1.28M` — being the only figure that needs the
width. The second carries the **score** at the left — what the run is worth if it is
played out, shown the whole way through rather than appearing at the crown, and
blank for a route that never reaches one. It replaced an action counter that
said what the slider already says. Ranged right is everything the player
carries: the held item first, then light keys, dark keys, pickaxes, gold, gems.
Each is a sprite and a number, and each reserves only the digits it can reach —
four for gold and gems, two for the rest — so the row is tight and still never
shuffles when a number grows. Gems are an amount
**spent**, which the row says on hover rather than in a word. Dark keys, gold
and the held item are absent where the game omits them too.

**Help.** Behind a **?** at the top-right of the left panel: the keys, and the
three options — **perf test**, **show paths** and **trail behind**. It draws over everything, and a click anywhere off it closes it and
does nothing else.

## 5. Presentation

Everything is drawn as the game draws it — the same tiles, the same bitmap
fonts, whole-number scaling, no smoothing, so pixels stay square at any window
size. The game's pixel-perfect and filtered-upscale settings are mirrored here,
but zoom is the app's own, on `+` / `-` with `0` for automatic. The game is
monochrome apart from the player, and so are we: the player carries the game's
own cyan tint. Every other colour is ours, and belongs to what the game does not
draw.

## 6. Editing

A route acts on the same cell more than once — walking a spike tile twice,
back through a one-way — so a badge on the floor cannot say *which* of those
actions it means. The **action list**, right of the slider, is what makes an
edit unambiguous: a window of the route centred on the current action, which
wears a thin lavender outline. Time runs upward, as it does on the slider.

A row is what the action **did**, not where, in fixed columns so the list reads
down: its number, what it **spent**, what it **acted on** with its own value
badge, the gold it moved stamped on a bag — negative at a Money Gate, the only
thing that takes gold away — and last what it was **carrying** that changed the
outcome without being used up. Spent comes first because that is what a failure
is usually about. The carried item is **dimmed** unless this action is the one
that expends it: it is true of the whole run and says nothing about this row.
Past the break the gold column is **projected** rather than measured — nothing
has run, so the figure is what the cell would pay to whatever was held at the
break, on the same reasoning that already fills the spent slot there. An added action wears a `+` beside its checkbox, at full
strength even when switched off. Hovering a row highlights it on the timeline;
the wheel moves the selection from anywhere on screen, so the pointer can
already be over the tile you mean to click.

**Every edit happens at the current action**, which is why there are no modes.

- A row's checkbox switches its action off. Unticked it fills dim red, so a
  disabled action can be found by scanning the column; the row greys out but
  keeps its number and its place on the slider, and scrubs through unchanged.
  Its outline goes **grey and dashed**, in the list and on the floor alike:
  dimming alone said "less important" where the thing to say is "not
  happening". A contiguous run of switched-off actions is outlined **once**, as
  a run of insertions and the failing stretch already are — each run is one
  decision, and a box per row makes it look like several.
- **Inserting is a click on a floor cell**, and it lands directly after the
  current action. Hovering a cell shows the `+` badge on it and a preview row
  offset up and to the right of the current one — where it would land — outlined
  in the **blue** that means *the player added this*, green being taken by *the
  route passes*. A cell that implies no action shows nothing at all; one the
  rules would refuse shows the **no-entry sign**.
- **A failing action draws the walk it attempted.** The player stands on the
  last square they reached, ghosted players mark the ones behind them, and one
  thin red outline runs round the whole route — the union's outer edge, never a
  box per cell. The thick box covers the player *and the cell that stopped
  them*, which is not the cell the action was aimed at: a battle gate is
  reached on the way to the enemy behind it. Without the approach there is no
  saying why a square blocks, and without the ghosts there is no saying where
  the player came from. `NO_PATH` draws no walk at all, because none was
  taken — which is itself the difference between "blocked on the way" and "no
  way in the first place". **Show paths** in the help panel draws the same
  outline and ghosts for every action, not only a failing one; it is on trial.
- `Z` and `Y` undo and redo insertions, as the game's own undo and redo do.
  They reach back over the current run of them and no further: insert four
  here, scrub away, insert four there, and `Z` takes back four.
- Clicking a row moves to it and **that row does not move**: the list shifts
  around it. Dragging on from there holds the rows still and **keeps the current
  action under the cursor**, so the row being aimed at is the row landed on.

The current action is drawn as an **action**, not as a position. The player
stands where it acts *from* — the square the auto-pather leaves them on,
**adjacent to the target** — so the affected tile is visible. **One box covers
both squares**, the one stood on and the one acted on, and the target is knocked
askew, as though shoved aside. Its row is repeated at the right of that floor's
name strip, joined to the player by a thick line: a display, not a control, in
the strip rather than over the grid so it never covers a cell worth clicking,
and without its number, which the list already carries.

**Where it fails**, the target is left square and whole and the player ring, the
connecting line, the summary's frame and the floor's own frame all turn red. The
row is outlined red too, whether or not it is the one being looked at, and its
**spent** column says what it was short of: a bag reading **-21** for gold in red
ink, the player with a power deficit to four figures, a boxed key or pickaxe
where there is no number to give, an arrow where the square cannot be reached at
all. The whole failing stretch is outlined as well as banded.

**Past** a failure everything is drawn as usual but in grey: those actions
*would* happen and cannot. The floors keep coming, so the route can be scrubbed
to its end. Those rows carry a faint red band and their icons say what they
would have done.

An action that finds its work already done — inserted before one that kills the
same enemy — says nothing but its number, and is not exported.

Anything that changes the document sets the **unsaved-changes marker**, in the
toolbar and the tab title; scrubbing and the option toggles do neither. **Save
`.ord`** clears it. **Export `.sav`** writes a fresh, uniquely named file, never
an overwrite, and refuses a route that fails. Segment affordances are off.

## 7. Open questions

Answered ones move out — to `DECISIONS.md` if the reasoning matters, else above.

- **The trail is anti-aliased and the stack filtered**, where the game is not.
- **The toolbar is wider than it needs to be.** It stops at the left panel now;
  what is in it could move, and then it need not be a strip at all.
- **How big the stack should be**, and whether overlapped floors stay legible on
  a 32- or 75-floor tower.
- **Freezing past and future floors** as you scrub: the past at its final state,
  the future at its initial one.
- **How wide the action list wants to be**, and how many rows it shows.
