// The export screen: the warning, the protocol, and the two ways out.
//
// `[D]` A screen rather than a toast. This app cannot reach the game's save
// folder (`store/savefolder.ts`), so what it writes is only useful once the
// player copies it across — which makes the instructions the feature, not a
// caveat attached to it.
//
// `[D]` Three stages. **Prepare** comes first because the folder it asks for has
// to exist before the file picker opens — a player meeting the OS dialog with no
// `tos_backups` has nothing to select. **Choose** lists what was found.
// **Done** shows the protocol again, because that is the moment it is needed:
// the files are written and the player is about to go and use them. `[I]`
// iestyn, 2026-09-10, on both.
//
// `[D]` No platform names. The game ships for one, but the app is a web page
// and nothing here depends on which file manager the player has. `[I]` iestyn.
//
// `[D]` The warning does not animate for anyone who has asked motion to stop
// (`prefers-reduced-motion`), and never flashes: a two-second breath is loud
// enough to read as a warning without being a photosensitivity hazard.

import type React from "react";
import { useState } from "react";
import { exportDirFor, type Backup, type Exported } from "../store/savefolder";

export type ExportChoice = "pick" | "download";

/** `[D]` One worked example throughout, so "that folder" is never ambiguous. */
const EG = "savestates-2026-09-10";
const EG_OUT = exportDirFor(EG);

type Step = readonly [string, string];

const PREPARE: readonly Step[] = [
  ["Make a folder called tos_backups", "Anywhere you like. It is yours, and this app only ever writes inside it."],
  ["Copy your whole savestates folder into it", "Copy, never move — the original stays where the game expects it."],
  ["Give the copy today's date", `${EG}, say. Without a date, nothing tells one backup from another later.`],
];

/** `[I]` iestyn's protocol, arrived at by repetition rather than designed. */
const DEPLOY: readonly Step[] = [
  ["Launch the game and let it finish syncing", "Steam Cloud settles on startup. Wait for it."],
  ["Go to the main menu and stay there", "Not inside the tower you are about to change."],
  [`Copy the contents of ${EG_OUT} into your savestates folder`, `The files inside it — not the folder itself. Steam Cloud corrupts any folder placed in there.`],
  ["Check every route you had is still present", "In the game's savestate list, for that tower."],
  ["Load your best route", "It should play exactly as before."],
  ["Load the newly exported route", "This is the one that proves the export."],
  ["Quit, and let it sync again", "Now the route is part of your saves."],
];

function Steps({ list, from }: { list: readonly Step[]; from: number }): React.ReactElement {
  return (
    <ol className="protocol" start={from}>
      {list.map(([step, why]) => (
        <li key={step}>
          <strong>{step}</strong>
          <span>{why}</span>
        </li>
      ))}
    </ol>
  );
}

function Restore({ folder }: { folder: string }): React.ReactElement {
  return (
    <details>
      <summary>To restore your backup, if it goes wrong or you change your mind</summary>
      <ul>
        <li>If the game crashed or quit, start it again first.</li>
        <li>Go to the main menu.</li>
        <li>
          Copy the contents of <code>{folder}</code> over your savestates folder — copy, not move.
        </li>
        <li>Quit cleanly, so the restored copy is what syncs.</li>
        <li>Keep every backup. They are tiny, and the one you delete is the one you wanted.</li>
        <li>
          <strong>This app never deletes a route</strong> — delete or rename them in the game as you see fit.
        </li>
        <li>If the game refuses to load an exported route, send iestyn that <code>.sav</code> for diagnosis.</li>
      </ul>
    </details>
  );
}

interface Props {
  towerId: string;
  recordName: string;
  gems: number;
  canPick: boolean;
  busy: boolean;
  /** Non-null once a container has been picked: what was found inside it. */
  backups: readonly Backup[] | null;
  /** The picked folder held saves itself, so it is a snapshot, not the container. */
  isSnapshot: boolean;
  /** Set once the write has happened: the protocol is shown against this. */
  done: Exported | null;
  onChoose: (c: ExportChoice) => void;
  onExport: (b: Backup) => void;
  onCancel: () => void;
}

export function ExportDialog(props: Props): React.ReactElement {
  const [understood, setUnderstood] = useState(false);

  const body = (): React.ReactElement => {
    // Stage 3 — written. The protocol, now that it is about to be used.
    if (props.done !== null) {
      const out = props.done;
      const deployed: readonly Step[] = DEPLOY.map(([s, w]) =>
        s.startsWith("Copy the contents")
          ? ([`Copy the contents of ${out.folder} into your savestates folder`, w] as const)
          : ([s, w] as const),
      );
      return (
        <>
          <p className="lede">
            <code>{out.name}</code> {out.accumulated ? "joined" : "starts"} <code>{out.folder}/{props.towerId}.sav</code>,
            which now holds {out.records} records. Every other record was read back from disk and is unchanged.
            The folder holds {out.towers.join(", ")}.
          </p>
          <h2>Now do this</h2>
          <Steps list={deployed} from={1} />
          <Restore folder={out.from} />
          <div className="towers">
            <button className="urgent" onClick={props.onCancel}>done</button>
          </div>
        </>
      );
    }

    // Stage 2 — a container has been picked.
    if (props.backups !== null) {
      return (
        <>
          <p className="lede">Which backup should the export be built from?</p>
          {props.isSnapshot && (
            <p className="warn">
              That folder holds <code>.sav</code> files, so it looks like a savestates copy rather than the
              folder your copies live in. Pick <code>tos_backups</code> itself — the one <em>containing</em>{" "}
              <code>{EG}</code>, not <code>{EG}</code>.
            </p>
          )}
          {props.backups.length === 0 && !props.isSnapshot && (
            <p className="hint">
              Nothing in there to build from. Copy your savestates folder into it first, and give the copy
              today&rsquo;s date — <code>{EG}</code>.
            </p>
          )}
          <ul className="backups">
            {props.backups.map((b) => {
              const why =
                b.towers.length === 0
                  ? "no .sav files in it"
                  : !b.stamped
                    ? "no date in the name, so nothing will tell it from another copy later"
                    : !b.towers.includes(props.towerId)
                      ? `no ${props.towerId}.sav in it`
                      : null;
              return (
                <li key={b.name}>
                  <button disabled={why !== null || props.busy} onClick={() => props.onExport(b)}>
                    {b.name}
                  </button>
                  <span>
                    {b.towers.length} saves{why === null ? "" : ` — ${why}`}
                    {b.newest && <strong className="latest"> ← latest save backup</strong>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="hint">
            The export lands in a folder named for whichever you choose — <code>{EG}</code> gives{" "}
            <code>{EG_OUT}</code>. Export again from the same one and the routes gather there, which is safe
            exactly as long as the game has not run since you took it.
          </p>
          <div className="towers">
            <button disabled={props.busy} onClick={props.onCancel}>cancel</button>
          </div>
        </>
      );
    }

    // Stage 1 — prepare.
    return (
      <>
        <p className="lede">
          This adds one record, <code>{props.recordName}</code> — or the next free name if that one is taken —
          to a <strong>copy</strong> of <code>{props.towerId}.sav</code>. It never touches your real save file;
          your browser is not allowed near that folder, so the last step is yours.
          <strong> Unofficial tool. Your saves are your responsibility.</strong>
        </p>

        {props.gems > 0 && (
          <p className="hint">
            This route spends {props.gems} gems. With fewer, the game refuses to load it — that is the gem
            gate, not a fault in the export.
          </p>
        )}

        <h2>Before you click</h2>
        <Steps list={PREPARE} from={1} />
        <p className="hint">
          Then pick <code>tos_backups</code> below — the folder that <em>contains</em> your dated copies, not a
          copy itself. The export lands beside them, in <code>{EG_OUT}</code>, and you copy it into place
          afterwards. The full instructions come back when it is written.
        </p>

        <Restore folder={EG} />

        <label className="understood">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          I have made <code>tos_backups</code>, copied my savestates folder into it, and dated the copy.
        </label>

        <div className="towers">
          <button
            className="urgent"
            disabled={!understood || !props.canPick || props.busy}
            onClick={() => props.onChoose("pick")}
            title={props.canPick ? "Pick your tos_backups folder" : "This browser has no folder picker; download instead"}
          >
            {props.busy ? "reading…" : "pick my tos_backups folder"}
          </button>
          <button disabled={props.busy} onClick={() => props.onChoose("download")} title="A new one-record .sav in your downloads">
            download a copy instead
          </button>
          <button disabled={props.busy} onClick={props.onCancel}>cancel</button>
        </div>

        {!props.canPick && (
          <p className="hint">
            This browser has no folder picker — Chrome and Edge have one, Firefox and Safari do not. The
            download works everywhere, but it is one record on its own: putting it in place would replace your
            other routes rather than join them, so it is the riskier of the two.
          </p>
        )}
      </>
    );
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Export to a save file">
      <div className="export">
        <p className="caveat" aria-label="Caveat emptor">CAVEAT EMPTOR</p>
        {body()}
      </div>
    </div>
  );
}
