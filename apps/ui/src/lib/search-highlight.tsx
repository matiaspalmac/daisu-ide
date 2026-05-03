import type { JSX } from "react";

/**
 * Render a line with a single highlighted match span between
 * `start` and `end` byte offsets. Multi-byte characters may drift slightly
 * vs char offsets; M2 polish addresses byte-aware slicing.
 */
export function highlightMatch(
  line: string,
  start: number,
  end: number,
): JSX.Element {
  const safeStart = Math.max(0, Math.min(start, line.length));
  const safeEnd = Math.max(safeStart, Math.min(end, line.length));
  return (
    <>
      {line.slice(0, safeStart)}
      <mark className="daisu-search-match">{line.slice(safeStart, safeEnd)}</mark>
      {line.slice(safeEnd)}
    </>
  );
}
