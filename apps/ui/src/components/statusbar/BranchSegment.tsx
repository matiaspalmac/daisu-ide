import type { JSX, MouseEvent } from "react";
import { GitBranch, ArrowsClockwise } from "@phosphor-icons/react";
import { BranchPicker } from "./BranchPicker";
import { useGit } from "../../stores/gitStore";
import { useUI } from "../../stores/uiStore";
import { translateError } from "../../lib/error-translate";

export function BranchSegment(): JSX.Element | null {
  const info = useGit((s) => s.info);
  const fetchRemote = useGit((s) => s.fetchRemote);
  const pushToast = useUI((s) => s.pushToast);

  if (!info) return null;

  const handleFetch = async (e: MouseEvent): Promise<void> => {
    e.stopPropagation();
    try {
      const r = await fetchRemote("origin");
      pushToast({
        message: `Fetched ${r.commitsReceived} new commit(s) from ${r.remote}`,
        level: "success",
      });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  };

  // Fetch button is a sibling of the picker trigger, not nested inside it.
  // Nested interactive elements are invalid HTML and break keyboard / screen
  // reader navigation.
  const trigger = (
    <button
      type="button"
      className="daisu-status-segment daisu-status-clickable daisu-branch-segment"
      title="Switch branch"
    >
      <GitBranch size={12} />
      {info.branch}
      {info.ahead > 0 && <span title="Ahead">↑{info.ahead}</span>}
      {info.behind > 0 && <span title="Behind">↓{info.behind}</span>}
    </button>
  );

  return (
    <span className="daisu-branch-group">
      <BranchPicker trigger={trigger} />
      <button
        type="button"
        className="daisu-icon-btn-sm"
        onClick={(e) => void handleFetch(e)}
        aria-label="Fetch from origin"
        title="Fetch from origin"
      >
        <ArrowsClockwise size={10} />
      </button>
    </span>
  );
}
