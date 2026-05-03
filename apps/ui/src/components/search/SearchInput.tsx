import type { JSX } from "react";
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
        placeholder="Search"
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
        className={`daisu-search-toggle daisu-search-toggle-text${options.caseSensitive ? " is-on" : ""}`}
        aria-label="Match case"
        title="Match case"
        onClick={() => toggle("caseSensitive")}
      >
        Aa
      </button>
      <button
        type="button"
        className={`daisu-search-toggle daisu-search-toggle-text${options.wholeWord ? " is-on" : ""}`}
        aria-label="Match whole word"
        title="Match whole word"
        onClick={() => toggle("wholeWord")}
      >
        <span className="daisu-search-toggle-underline">ab</span>
      </button>
      <button
        type="button"
        className={`daisu-search-toggle daisu-search-toggle-text${options.regex ? " is-on" : ""}`}
        aria-label="Use regular expression"
        title="Use regular expression"
        onClick={() => toggle("regex")}
      >
        .*
      </button>
      <button
        type="button"
        className={`daisu-search-toggle daisu-search-toggle-text${options.multiline ? " is-on" : ""}`}
        aria-label="Multiline"
        title="Multiline"
        onClick={() => toggle("multiline")}
      >
        ¶
      </button>
    </div>
  );
}
