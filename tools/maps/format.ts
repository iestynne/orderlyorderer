// Human-reviewable JSON serialization: tower JSON is committed and reviewed
// as diffs (D9, D14e), so a wall row, an entity, or a textbox must each sit
// on one line rather than spanning ~15 lines the way a naive pretty-printer
// would render it. One small generic rule does this for any JSON-shaped
// value, rather than hand-writing per-field formatting: an array whose
// elements are themselves "flat" (arrays or objects containing only
// primitives) renders each element compactly, one per line.

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue };

function isPrimitive(v: JSONValue): v is string | number | boolean | null {
  return v === null || typeof v !== "object";
}


function isFlatObject(v: JSONValue): v is { [key: string]: JSONValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every(isPrimitive);
}

function compactArray(arr: JSONValue[]): string {
  return "[" + arr.map((x) => (isFlatObject(x) ? compactObject(x) : JSON.stringify(x))).join(", ") + "]";
}

/**
 * A merged cell row: primitives and flat objects mixed. Rendering it on one
 * line keeps a floor 15 reviewable lines rather than 225 (D9, D14e), and keeps
 * a changed cell to a one-row diff.
 */
function isCompactableArray(v: JSONValue): v is JSONValue[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isPrimitive(x) || isFlatObject(x));
}

function compactObject(obj: { [key: string]: JSONValue }): string {
  const entries = Object.entries(obj).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return "{ " + entries.join(", ") + " }";
}

function stringifyPretty(value: JSONValue, level: number): string {
  const pad = "  ".repeat(level);
  const padIn = "  ".repeat(level + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPrimitive)) return compactArray(value);
    if (value.every((x) => isCompactableArray(x) || isFlatObject(x))) {
      const items = value.map((x) => padIn + (isCompactableArray(x) ? compactArray(x) : compactObject(x as { [key: string]: JSONValue })));
      return "[\n" + items.join(",\n") + "\n" + pad + "]";
    }
    const items = value.map((x) => padIn + stringifyPretty(x, level + 1));
    return "[\n" + items.join(",\n") + "\n" + pad + "]";
  }

  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    const items = keys.map((k) => padIn + JSON.stringify(k) + ": " + stringifyPretty(value[k] as JSONValue, level + 1));
    return "{\n" + items.join(",\n") + "\n" + pad + "}";
  }

  return JSON.stringify(value);
}

/** Serializes a JSON-shaped value into a reviewable file, ending in a single trailing newline. */
export function toReviewableJson(value: JSONValue): string {
  return stringifyPretty(value, 0) + "\n";
}
