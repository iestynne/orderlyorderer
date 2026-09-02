// SPEC-008 §2.4 — the `.ord` file: canonical JSON, and the hashes taken over it.
//
// `[D]` `.ord` is the document and `.sav` is import and export only (D35). The
// format is ours, so it cannot surprise us the way a reverse-engineered one
// can; what it must do is serialize byte-stably, because the unsaved-changes
// marker is a hash comparison and not a sticky flag.
//
// Pure module: no UI imports (D7).

import { RouteShapeError, type Action, type Epoch, type OrdFile, type Route, type Segment } from "./document";
import { sha256, sha256Text } from "./sha256";
import type { Waypoint } from "../types";

export const FORMAT = "orderlyorderer-route";
export const VERSION = 1;

/**
 * Sorted object keys, no insignificant whitespace, integers without exponent.
 *
 * `[D]` Not `JSON.stringify`: its key order is insertion order, so two
 * documents that differ only in the order two edits happened to set fields
 * would serialize differently and the marker would report a change nobody made.
 * `[D]` Absent optional fields are **omitted, never written null**, which is
 * what makes disabling an action and re-enabling it restore the byte-identical
 * document (invariant 4).
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RouteShapeError(`${value} is not a finite number`);
    const s = JSON.stringify(value);
    if (s.includes("e") || s.includes("E")) throw new RouteShapeError(`${value} serializes with an exponent`);
    return s;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const parts = Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(o[k])}`);
    return `{${parts.join(",")}}`;
  }
  throw new RouteShapeError(`cannot serialize ${typeof value}`);
}

export function emit(file: OrdFile): string {
  return canonicalJSON(file);
}

/** SHA-256 over the canonical serialization — the unsaved-changes marker (DESIGN §2.3). */
export function documentHash(file: OrdFile): string {
  return sha256Text(emit(file));
}

/**
 * SHA-256 over a record's **decompressed** payload.
 *
 * `[F]` SPEC-006 §6: Node's zlib reproduces only 82 of the game's 326
 * compressed streams while the payload underneath is exact in all 326, so a
 * hash over compressed bytes would report mismatches that are the
 * compressor's, not the player's.
 */
export function payloadHash(payload: Uint8Array): string {
  return sha256(payload);
}

// --- parsing -------------------------------------------------------------
//
// `[D]` Every field is checked. The format is ours, but the file is the
// player's and may have been hand-edited -- that is the reason it is text
// (D35), so a bad one has to fail with a sentence rather than a stack trace
// eight modules deep in the simulator.

function fail(where: string, what: string): never {
  throw new RouteShapeError(`${where}: ${what}`);
}

function obj(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(where, "is not an object");
  return v as Record<string, unknown>;
}

function str(v: unknown, where: string): string {
  if (typeof v !== "string") fail(where, "is not a string");
  return v;
}

function int(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) fail(where, "is not an integer");
  return v;
}

function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(where, "is not an array");
  return v;
}

function waypoint(v: unknown, where: string): Waypoint {
  const o = obj(v, where);
  return { z: int(o["z"], `${where}.z`), x: int(o["x"], `${where}.x`), y: int(o["y"], `${where}.y`) };
}

function action(v: unknown, where: string): Action {
  const o = obj(v, where);
  const a: Action = { from: waypoint(o["from"], `${where}.from`), to: waypoint(o["to"], `${where}.to`) };
  if (o["disabled"] !== undefined) {
    if (typeof o["disabled"] !== "boolean") fail(`${where}.disabled`, "is not a boolean");
    if (o["disabled"]) a.disabled = true;
  }
  return a;
}

function segment(v: unknown, where: string): Segment {
  const o = obj(v, where);
  return {
    name: str(o["name"], `${where}.name`),
    actions: arr(o["actions"], `${where}.actions`).map((a, i) => action(a, `${where}.actions[${i}]`)),
  };
}

function epoch(v: unknown, where: string): Epoch {
  const o = obj(v, where);
  const segments = arr(o["segments"], `${where}.segments`).map((s, i) => segment(s, `${where}.segments[${i}]`));
  if (segments.length < 1) fail(`${where}.segments`, "is empty; an epoch holds at least one segment");
  const active = int(o["active"], `${where}.active`);
  if (active < 0 || active >= segments.length) fail(`${where}.active`, `${active} is not a segment index`);
  if (typeof o["skippable"] !== "boolean") fail(`${where}.skippable`, "is not a boolean");
  const e: Epoch = { skippable: o["skippable"], active, segments };
  if (o["name"] !== undefined) e.name = str(o["name"], `${where}.name`);
  return e;
}

function route(v: unknown, where: string): Route {
  const o = obj(v, where);
  const epochs = arr(o["epochs"], `${where}.epochs`).map((e, i) => epoch(e, `${where}.epochs[${i}]`));
  if (epochs.length < 1) fail(`${where}.epochs`, "is empty; a route holds at least one epoch");
  const r: Route = {
    name: str(o["name"], `${where}.name`),
    tower: str(o["tower"], `${where}.tower`),
    gemsOwned: int(o["gemsOwned"], `${where}.gemsOwned`),
    epochs,
    final: waypoint(o["final"], `${where}.final`),
  };
  if (o["source"] !== undefined) {
    const s = obj(o["source"], `${where}.source`);
    r.source = {
      file: str(s["file"], `${where}.source.file`),
      record: str(s["record"], `${where}.source.record`),
      hash: str(s["hash"], `${where}.source.hash`),
    };
  }
  return r;
}

export function parse(text: string): OrdFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new RouteShapeError(`not JSON: ${String(e)}`);
  }
  const o = obj(raw, "document");
  if (o["format"] !== FORMAT) fail("document.format", `is not ${JSON.stringify(FORMAT)}`);
  if (o["version"] !== VERSION) fail("document.version", `is ${String(o["version"])}, not ${VERSION}`);
  return {
    format: FORMAT,
    version: VERSION,
    routes: arr(o["routes"], "document.routes").map((r, i) => route(r, `document.routes[${i}]`)),
  };
}

export function ordFile(routes: Route[]): OrdFile {
  return { format: FORMAT, version: VERSION, routes };
}
