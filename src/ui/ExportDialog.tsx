// The export screen: the warning, the protocol, and the two ways out.
//
// `[D]` A screen rather than a toast. This app cannot reach the savestates
// folder (`store/savefolder.ts`), so what it writes is only useful once the
// player moves it — which makes the instructions the feature, not a caveat
// attached to it.
//
// `[D]` Two stages, and the first one exists because the folder it asks for has
// to be made before the picker opens: a player who meets the OS dialog without
// having made `tos_backups` has nothing to select. `[I]` iestyn, 2026-09-10.
//
// `[D]` The warning does not animate for anyone who has asked motion to stop
// (`prefers-reduced-motion`), and never flashes: a two-second breath is loud
// enough to read as a warning without being a photosensitivity hazard.

import type React from "react";
import { useState } from "react";
import { exportDirFor, type Backup } from "../store/savefolder";

export type ExportChoice = "pick" | "download";

/** `[I]` iestyn's, and arrived at by repetition rather than designed. */
const PREPARE: readonly (readonly [string, string])[] = [
  ["Make a folder called tos_backups", "Anywhere you like — Documents, the desktop. It is yours, and this app only ever writes inside it."],
  ["Copy your whole savestates folder into it", `%APPDATA%\\LOVE\\towers_of_scale\\savestates. Copy, never move.`],
  ["Put today's date in the copy's name", "savestates_2026-09-10, say. Without a date, nothing tells one backup from another later — so the export will refuse it."],
];

const THEN: readonly (readonly [string, string])[] = [
  ["Pick tos_backups below, and choose that dated copy", "The app reads it and never writes to it."],
  ["We write an export folder beside it", "Named for the copy it came from, holding only the towers you export, with your route added."],
  ["Launch the game, let Steam Cloud finish, sit on the main menu", "Not inside the tower you are about to change."],
  ["Copy that folder's contents into your savestates folder", "The contents, not the folder itself — a folder in there becomes a junk save."],
  ["Load that tower and check it", "Every route you had, plus the new one, and the new one plays."],
  ["Quit, and let Steam Cloud upload", "Now the route is part of your saves."],
];

interface Props {
  towerId: string;
  recordName: string;
  gems: number;
  canPick: boolean;
  busy: boolean;
  /** Non-null once a container has been picked: what was found inside it. */
  backups: readonly Backup[] | null;
  onChoose: (c: ExportChoice) => void;
  onExport: (b: Backup) => void;
  onCancel: () => void;
}

export function ExportDialog(props: Props): React.ReactElement {
  const [understood, setUnderstood] = useState(false);
  const steps = (list: readonly (readonly [string, string])[], from: number): React.ReactElement[] =>
    list.map(([step, why], i) => (
      <li key={step} value={from + i}>
        <strong>{step}</strong>
        <span>{why}</span>
      </li>
    ));

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Export to a save file">
      <div className="export">
        <p className="caveat" aria-label="Caveat emptor">CAVEAT EMPTOR</p>

        {props.backups === null ? (
          <>
            <p className="lede">
              This adds one record, <code>{props.recordName}</code> — or the next free name if that one is taken —
              to a <strong>copy</strong> of <code>{props.towerId}.sav</code>. It never touches your real save file:
              Windows will not let a browser near that folder, so the last step is yours to do in Explorer.
              <strong> Unofficial tool. Your saves are your responsibility.</strong>
            </p>

            {props.gems > 0 && (
              <p className="hint">
                This route spends {props.gems} gems. With fewer, the game refuses to load it — that is the gem
                gate, not a fault in the export.
              </p>
            )}

            <h2>Before you click</h2>
            <ol className="protocol">{steps(PREPARE, 1)}</ol>
            <h2>Then</h2>
            <ol className="protocol" start={PREPARE.length + 1}>{steps(THEN, PREPARE.length + 1)}</ol>

            <details>
              <summary>If it goes wrong, or you change your mind</summary>
              <ul>
                <li>Exit to the main menu.</li>
                <li>Copy your dated backup's contents over your savestates folder — copy, not move.</li>
                <li>Quit cleanly so Steam Cloud takes the restored copy.</li>
                <li>Keep every backup. They are tiny, and the one you delete is the one you wanted.</li>
                <li>Send iestyn the file that misbehaved, so the failure can be read.</li>
              </ul>
            </details>

            <label className="understood">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              I have made <code>tos_backups</code>, copied my savestates folder into it, and put the date in its name.
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
              <button disabled={props.busy} onClick={() => props.onChoose("download")} title="A new one-record .sav in Downloads">
                download a copy instead
              </button>
              <button disabled={props.busy} onClick={props.onCancel}>cancel</button>
            </div>

            {!props.canPick && (
              <p className="hint">
                This browser has no folder picker. Chrome and Edge do; Firefox and Safari do not. The download
                works everywhere, but it is one record on its own — you would be replacing your save, not adding
                to it, so it is the riskier of the two.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="lede">Which copy should the export be built from?</p>

            <p className="hint">
              The export lands in <code>{exportDirFor("savestates_…")}</code>, named for whichever you choose.
              Export again from the same one and the routes gather there — which is safe exactly as long as
              the game has not run since you took it.
            </p>

            {props.backups.length === 0 && (
              <p className="hint">
                No folder in there holds any <code>.sav</code> files. Copy your savestates folder into{" "}
                <code>tos_backups</code> first, with today&rsquo;s date in the name.
              </p>
            )}
            <ul className="backups">
              {props.backups.map((b) => (
                <li key={b.name}>
                  <button disabled={!b.stamped || props.busy} onClick={() => props.onExport(b)}>
                    {b.name}
                  </button>
                  <span>
                    {b.towers.length} saves{b.towers.includes(props.towerId) ? "" : ` — no ${props.towerId}.sav`}
                    {b.stamped ? "" : " — no date in the name, so it cannot be told from any other copy later"}
                    {b.stamped && !b.newest && " — not the most recent copy here, so the game has probably run since"}
                  </span>
                </li>
              ))}
            </ul>
            <div className="towers">
              <button disabled={props.busy} onClick={props.onCancel}>cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
