// SPEC-007 §1 + docs/UI.md §1 — the shell: empty state, file load, record
// pick, panels.
//
// React owns the chrome and nothing inside the canvas. Once a record is
// chosen, Scrubber takes over and React does not re-render again.

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { routeFromRecord } from "../sav/route";
import { parseSaveFile, type SaveRecord } from "../sav/savefile";
import type { TowerJSON } from "../sim/types";
import { knownTowerIds, loadSheet, loadTower, manifest, towerIdFromFilename } from "./assets";
import { blankSummaries, fillSummaries, type Summary } from "./records";
import { Scrubber, type ScrubberSettings } from "./scrubber";

const NOTICE =
  "Unofficial. Orderlyorderer is a fan-made planning tool for Towers of Scale. " +
  "It is not made by, endorsed by or affiliated with the game's developer.";
const SAVE_HINT = "%APPDATA%\\LOVE\\towers_of_scale\\";

/** A computed column: still coming, absent, or a number. */
function column(s: Summary, v: number | null, format: (n: number) => string = String): string {
  if (s.orbs) return "";
  if (!s.computed) return "…";
  return v === null ? "—" : format(v);
}

export default function App(): React.ReactElement {
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  const [tower, setTower] = useState<TowerJSON | null>(null);
  const [records, setRecords] = useState<Summary[] | null>(null);
  const [chosen, setChosen] = useState<SaveRecord | null>(null);
  const [pendingBytes, setPendingBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ScrubberSettings>({
    pixelPerfect: true,
    linearFilter: false,
    captions: true,
    perf: false,
    zoom: "auto",
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrubberRef = useRef<Scrubber | null>(null);

  useEffect(() => {
    loadSheet().then(setSheet).catch((e: Error) => setError(String(e)));
  }, []);

  const openFile = useCallback(async (file: File) => {
    setError(null);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = towerIdFromFilename(file.name);
    if (id === null) {
      // If the filename does not name a tower we know, ask rather than guess.
      setPendingBytes(bytes);
      return;
    }
    await openWith(id, bytes);
  }, []);

  // Which file the list belongs to. Opening another one abandons the fill that
  // is still running against the old one rather than letting it write over it.
  const openedRef = useRef(0);

  const openWith = useCallback(async (id: string, bytes: Uint8Array) => {
    const mine = ++openedRef.current;
    try {
      const t = await loadTower(id);
      const rows = blankSummaries(parseSaveFile(bytes).records);
      setTower(t);
      setRecords(rows);
      setPendingBytes(null);
      await fillSummaries(
        t,
        rows,
        (i, s) => setRecords((prev) => prev && prev.map((r, j) => (j === i ? s : r))),
        () => openedRef.current !== mine,
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Mount the scrubber once a record is chosen, and never re-render it after.
  useEffect(() => {
    if (!chosen || !tower || !sheet || !canvasRef.current) return;
    const s = new Scrubber(canvasRef.current, manifest, sheet, settings, setSettings);
    scrubberRef.current = s;
    s.load(tower, routeFromRecord(chosen));
    return () => {
      s.destroy();
      scrubberRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately not `settings`: see update() below.
  }, [chosen, tower, sheet]);

  useEffect(() => {
    scrubberRef.current?.update(settings);
  }, [settings]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) void openFile(f);
    },
    [openFile],
  );

  const shell = useMemo(
    () => ({ onDragOver: (e: React.DragEvent) => e.preventDefault(), onDrop }),
    [onDrop],
  );

  if (chosen && tower && sheet) {
    return (
      <div className="app" {...shell}>
        <canvas ref={canvasRef} className="stage" />
        <div className="tools">
          <button onClick={() => setChosen(null)}>← select save</button>
          {/* The exact 1x frame, not a screen grab — §7's capture control. */}
          <button onClick={() => scrubberRef.current?.saveCapture()} title="Save this frame as a PNG (S)">
            screenshot
          </button>
          <span className="keys">← → scrub · shift for 10 · +/− zoom · 0 auto · S shot</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app shell" {...shell}>
      <div className="pane">
        <h1>Orderlyorderer</h1>
        {error && <p className="error">{error}</p>}

        {records === null && pendingBytes === null && (
          <>
            <label className="drop">
              <strong>Open a save file</strong>
              <span>or drop one anywhere on this window</span>
              <input
                type="file"
                accept=".sav"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void openFile(f);
                }}
              />
            </label>
            <p className="hint">
              Saves live in <code>{SAVE_HINT}</code>
            </p>
          </>
        )}

        {pendingBytes !== null && (
          <div className="ask">
            <p>That filename does not name a tower. Which one is it?</p>
            <div className="towers">
              {knownTowerIds().map((id) => (
                <button key={id} onClick={() => void openWith(id, pendingBytes)}>
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}

        {records !== null && (
          <table className="records">
            <thead>
              <tr>
                <th>Record</th>
                <th>Saved</th>
                <th>Power</th>
                <th>Floor</th>
                <th>Stops</th>
              </tr>
            </thead>
            <tbody>
              {records.map((s) => (
                <tr key={s.record.name} className={s.orbs ? "disabled" : ""}>
                  <td>
                    {s.orbs ? (
                      <span title="Orb moves are not simulated in this slice">{s.record.name}</span>
                    ) : (
                      <button onClick={() => setChosen(s.record)}>{s.record.name}</button>
                    )}
                  </td>
                  <td>{s.record.time ?? "—"}</td>
                  <td>{s.orbs ? "uses orbs" : column(s, s.power, (n) => n.toLocaleString("en-GB"))}</td>
                  <td>{column(s, s.highest)}</td>
                  <td>{column(s, s.stops)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="notice">{NOTICE}</p>
      </div>
    </div>
  );
}
