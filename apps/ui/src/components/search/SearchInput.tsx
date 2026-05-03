import type { JSX } from "react";
import {
  CaseSensitive,
  Regex,
  WholeWord,
  AlignVerticalSpaceAround,
} from "lucide-react";
import { useSearch } from "../../stores/searchStore";

export function SearchInput(): JSX.Element {
  const query = useSearch((s) => s.query);
  const options = useSearch((s) => s.options);
  const setQuery = useSearch((s) => s.setQuery);
  const toggleStore = useSearch((s) => s.toggleOption);
  const search = useSearch((s) => s.search);
  const toggle = (
    field: "caseSensitive" | "regex" | "wholeWord" | "multiline",
  ): void => {
    toggleStore(field);
    void search();
  };

  return (
    <div className="daisu-search-row">
      <input
        type="text"
        className="daisu-input daisu-search-input"
        placeholder="Search..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          void search();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") void search();
        }}
      />
      <button
        type="button"
        className={`daisu-icon-btn-sm${options.caseSensitive ? " is-on" : ""}`}
        aria-label="Match case"
        title="Match case"
        onClick={() => toggle("caseSensitive")}
      >
        <CaseSensitive size={14} />
      </button>
      <button
        type="button"
        className={`daisu-icon-btn-sm${options.wholeWord ? " is-on" : ""}`}
        aria-label="Whole word"
        title="Whole word"
        onClick={() => toggle("wholeWord")}
      >
        <WholeWord size={14} />
      </button>
      <button
        type="button"
        className={`daisu-icon-btn-sm${options.regex ? " is-on" : ""}`}
        aria-label="Regex"
        title="Regex"
        onClick={() => toggle("regex")}
      >
        <Regex size={14} />
      </button>
      <button
        type="button"
        className={`daisu-icon-btn-sm${options.multiline ? " is-on" : ""}`}
        aria-label="Multiline"
        title="Multiline"
        onClick={() => toggle("multiline")}
      >
        <AlignVerticalSpaceAround size={14} />
      </button>
    </div>
  );
}
