import { type JSX } from "react";
import {
  CheckCircle,
  XCircle,
  CircleNotch,
  Prohibit,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export type ToolStatus = "running" | "done" | "errored" | "denied";

interface Props {
  status: ToolStatus;
  latencyMs?: number;
}

/**
 * Status pill for a tool call. Mirrors Cline / Continue conventions:
 * spinner while running, green check on success, amber X on error, red
 * prohibit on permission denial. Wraps the icon in a polite aria-live
 * region so screen readers announce state transitions without
 * interrupting other speech.
 */
export function ToolStatusBadge({ status, latencyMs }: Props): JSX.Element {
  const { t } = useTranslation();
  const labelKey = (
    {
      running: "chat.toolStatusRunning",
      done: "chat.toolStatusDone",
      errored: "chat.toolStatusErrored",
      denied: "chat.toolStatusDenied",
    } as const
  )[status];
  const label = t(labelKey, {
    defaultValue: status,
  });
  return (
    <span
      className={`daisu-tool-badge is-${status}`}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      {status === "running" && (
        <CircleNotch
          size={11}
          className="daisu-tool-spin"
          aria-hidden="true"
        />
      )}
      {status === "done" && (
        <CheckCircle size={11} weight="fill" aria-hidden="true" />
      )}
      {status === "errored" && (
        <XCircle size={11} weight="fill" aria-hidden="true" />
      )}
      {status === "denied" && (
        <Prohibit size={11} weight="fill" aria-hidden="true" />
      )}
      <span className="daisu-tool-badge-label">{label}</span>
      {latencyMs != null && status === "done" && (
        <span className="daisu-tool-badge-latency"> · {formatMs(latencyMs)}</span>
      )}
    </span>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
