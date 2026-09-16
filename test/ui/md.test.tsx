// `md()` — inline `code` and **bold**, and nothing else.

import { describe, expect, it } from "vitest";
import { md } from "../../src/ui/md";

/** The rendered shape, flattened to tag+text so the assertions read as prose. */
function shape(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(shape).join("");
  const el = node as { type?: string; props?: { children?: unknown } };
  return el.type === undefined ? "" : `<${el.type}>${shape(el.props?.children)}</${el.type}>`;
}

describe("md", () => {
  it("passes plain text through untouched, as a string", () => {
    expect(md("no marks here")).toBe("no marks here");
  });

  it("renders the two marks", () => {
    expect(shape(md("copy `2-5.sav` across"))).toBe("copy <code>2-5.sav</code> across");
    expect(shape(md("this is **important** now"))).toBe("this is <strong>important</strong> now");
    expect(shape(md("`a` and **b**"))).toBe("<code>a</code> and <strong>b</strong>");
  });

  it("leaves an unclosed mark visible rather than swallowing the line", () => {
    // `[D]` The failure mode that matters: a typo in text.ts must show as a
    // stray backtick, never as the rest of the sentence disappearing.
    expect(shape(md("an `unclosed mark"))).toBe("an `unclosed mark");
    expect(shape(md("**also unclosed"))).toBe("**also unclosed");
  });

  it("does not treat empty marks as marks", () => {
    expect(shape(md("`` and ****"))).toBe("`` and ****");
  });
});
