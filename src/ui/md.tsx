// Inline markdown for user-facing strings: `code` and **bold**, nothing else.
//
// `[D]` Exists so `text.ts` can stay plain strings and still produce styled
// output. Moving the wording out of JSX cost the `<code>` spans that coloured
// folder names; this gives them back without putting markup back in the way of
// whoever is editing the words. `[I]` iestyn, 2026-09-15.
//
// `[D]` **Two marks, and no block syntax.** Not a markdown library and not a
// subset anyone should grow: these strings are sentences, and a renderer that
// also did links or lists would be a parser to get wrong. Anything needing more
// structure is a component's job, not a string's.
//
// `[D]` Splitting, not parsing. The marks cannot nest and cannot span a string,
// so one regex split is the whole implementation — and an unclosed mark stays
// visible as itself rather than swallowing the rest of the line.

import type React from "react";

const MARK = /(`[^`]+`|\*\*[^*]+\*\*)/g;

/** `text` with its marks rendered. Plain text in gives plain text out. */
export function md(text: string): React.ReactNode {
  const parts = text.split(MARK);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : part.startsWith("**") && part.endsWith("**") && part.length > 3 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}
