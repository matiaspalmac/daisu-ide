import type { JSX, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, ArrowsClockwise } from "@phosphor-icons/react";
import { BranchPicker } from "./BranchPicker";
import { useGit } from "../../stores/gitStore";
import { useUI } from "../../stores/uiStore";
import { translateError } from "../../lib/error-translate";

export function BranchSegment(): JSX.Element | null {
  const { t } = useTranslation();
  const info = useGit((s) => s.info);
  const fetchRemote = useGit((s) => s.fetchRemote);
  const pushToast = useUI((s) => s.pushToast);

  if (!info) return null;

  const handleFetch = async (e: MouseEvent): Promise<void> => {
    e.stopPropagation();
    try {
      const r = await fetchRemote("origin");
      pushToast({
        message: t("branch.fetched", { count: r.commitsReceived, remote: r.remote }),
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
      title={t("branch.switchAria")}
    >
      <GitBranch size={12} />
      {info.branch}
      {info.ahead > 0 && <span title={t("branch.ahead")}>↑{info.ahead}</span>}
      {info.behind > 0 && <span title={t("branch.behind")}>↓{info.behind}</span>}
    </button>
  );

  return (
    <span className="daisu-branch-group">
      <BranchPicker trigger={trigger} />
      <button
        type="button"
        className="daisu-icon-btn-sm"
        onClick={(e) => void handleFetch(e)}
        aria-label={t("branch.fetchAria")}
        title={t("branch.fetchTitle")}
      >
        <ArrowsClockwise size={10} />
      </button>
    </span>
  );
}
