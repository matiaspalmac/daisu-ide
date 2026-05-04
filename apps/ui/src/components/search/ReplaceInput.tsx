import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "../../stores/searchStore";
import { ReplaceConfirmDialog } from "./ReplaceConfirmDialog";

export function ReplaceInput(): JSX.Element {
  const { t } = useTranslation();
  const hits = useSearch((s) => s.hits);
  const excluded = useSearch((s) => s.excludedHitIds);
  const replaceAll = useSearch((s) => s.replaceAll);
  const clearResults = useSearch((s) => s.clearResults);
  const [text, setText] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const effective = hits.filter((h) => !excluded.has(h.id));
  const fileCount = new Set(effective.map((h) => h.path)).size;
  const canReplace = effective.length > 0;

  const fileNames = Array.from(
    new Set(effective.map((h) => h.path.split(/[\\/]/).pop() ?? h.path)),
  );

  return (
    <div className="daisu-search-row">
      <input
        type="text"
        className="daisu-input daisu-search-input"
        placeholder={t("search.replace")}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="daisu-search-toggle daisu-search-toggle-text"
        disabled={!canReplace}
        onClick={() => setConfirmOpen(true)}
        title={t("search.replaceAll")}
        aria-label={t("search.replaceAll")}
      >
        AB
      </button>
      <ReplaceConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        totalReplacements={effective.length}
        fileCount={fileCount}
        fileNames={fileNames}
        onConfirm={async () => {
          await replaceAll(text);
          clearResults();
          setText("");
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}
