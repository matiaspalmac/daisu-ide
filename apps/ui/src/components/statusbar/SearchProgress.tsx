import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "../../stores/searchStore";
import { useUI } from "../../stores/uiStore";

export function SearchProgress(): JSX.Element | null {
  const { t } = useTranslation();
  const active = useSearch((s) => s.activeRequestId);
  const filesSearched = useSearch((s) => s.filesSearched);
  const hits = useSearch((s) => s.hits.length);
  const done = useSearch((s) => s.done);
  const toggleSearch = useUI((s) => s.toggleSearchPanel);

  if (!active && !done) return null;
  if (done && hits === 0) return null;

  const hitsLabel = t("search.hits", { count: hits });
  const label = active
    ? t("search.searching", { filesSearched, hits: hitsLabel })
    : t("search.completion", { hits: hitsLabel, filesSearched });

  return (
    <button
      type="button"
      className="daisu-status-segment daisu-status-clickable"
      onClick={() => toggleSearch()}
      title={t("statusbarSegment.searchProgressTitle")}
    >
      {label}
    </button>
  );
}
