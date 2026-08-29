// SPEC-002 §8.4 — convert_value_str, exact port of util.convert_value_str.

import { describe, expect, it } from "vitest";
import { convertValueStr } from "../../../tools/maps/parser";

describe("convertValueStr (SPEC-002 §8.4)", () => {
  it.each([
    ["0", 0],
    ["5", 5],
    ["999", 999],
    ["10k", 10000],
    ["255k", 255000],
    ["1M", 1000000],
    ["999G", 999000000000],
  ])('convertValueStr("%s") === %d', (input, expected) => {
    expect(convertValueStr(input)).toBe(expected);
  });
});
