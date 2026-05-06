import { useMemo, type JSX } from "react";

interface Props {
  /** Accumulated JSON string from ToolUseArgsDelta events. */
  raw: string;
  /** Whether ToolUseDone has fired — drives the typewriter caret. */
  done: boolean;
}

/**
 * Render streamed tool args. While `done` is false, show the raw buffer
 * with a blinking caret (the model is still emitting). Once done, try
 * to JSON.parse + pretty-print so the user sees normalised indentation;
 * fall back to the raw string if parsing fails (truncated stream).
 */
export function StreamingJson({ raw, done }: Props): JSX.Element {
  const display = useMemo(() => {
    if (!done) return raw;
    if (!raw.trim()) return "{}";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }, [raw, done]);

  return (
    <pre
      className={`daisu-tool-args${done ? " is-done" : " is-streaming"}`}
      aria-live="off"
    >
      <code>{display}</code>
      {!done && <span className="daisu-tool-caret" aria-hidden="true" />}
    </pre>
  );
}
