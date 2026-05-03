import type { JSX } from "react";
import { useTabs } from "../../stores/tabsStore";
import { useSearch } from "../../stores/searchStore";
import { getActiveEditor } from "../../lib/monaco-editor-ref";
import { highlightMatch } from "../../lib/search-highlight";
import type { SearchHit } from "../../api/tauri";

interface Props {
  hit: SearchHit;
}

export function ResultLine(props: Props): JSX.Element {
  const openTab = useTabs((s) => s.openTab);
  const excluded = useSearch((s) => s.excludedHitIds.has(props.hit.id));
  const toggleExcluded = useSearch((s) => s.toggleHitExcluded);

  const open = async (): Promise<void> => {
    await openTab(props.hit.path);
    setTimeout(() => {
      const editor = getActiveEditor();
      if (editor) {
        editor.revealLineInCenter(props.hit.lineNo);
        editor.setSelection({
          startLineNumber: props.hit.lineNo,
          startColumn: props.hit.matchStartCol + 1,
          endLineNumber: props.hit.lineNo,
          endColumn: props.hit.matchEndCol + 1,
        });
      }
    }, 50);
  };

  return (
    <div className={`daisu-result-line${excluded ? " is-excluded" : ""}`}>
      <input
        type="checkbox"
        checked={!excluded}
        onChange={() => toggleExcluded(props.hit.id)}
        aria-label={`Include hit at line ${props.hit.lineNo}`}
      />
      <button
        type="button"
        className="daisu-result-line-btn"
        onClick={() => void open()}
      >
        <span className="daisu-result-line-no">{props.hit.lineNo}</span>
        <span className="daisu-result-line-text">
          {highlightMatch(
            props.hit.lineText,
            props.hit.matchStartCol,
            props.hit.matchEndCol,
          )}
        </span>
      </button>
    </div>
  );
}
