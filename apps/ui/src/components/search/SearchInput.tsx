import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "../../stores/searchStore";

export function SearchInput(): JSX.Element {
  const { t } = useTranslation();
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
        placeholder={t("search.placeholder")}
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
        aria-label={t("search.matchCase")}
        title={t("search.matchCase")}
        onClick={() => toggle("caseSensitive")}
      >
        Aa
      </button>
      <button
        type="button"
        className={`daisu-search-toggle daisu-search-toggle-text${options.wholeWord ? " is-on" : ""}`}
        aria-label={t("search.wholeWord")}
        title={t("search.wholeWord")}
        onClick={() => toggle("wholeWord")}
      >
        <span className="daisu-search-toggle-underline">ab</span>
      </button>
      <button
        type="button"
        className={`daisu-search-toggle daisu-search-toggle-text${options.regex ? " is-on" : ""}`}
        aria-label={t("search.regex")}
        title={t("search.regex")}
        onClick={() => toggle("regex")}
      >
        .*
      </button>
      <button
        type="button"
        className={`daisu-search-toggle daisu-search-toggle-text${options.multiline ? " is-on" : ""}`}
        aria-label={t("search.multiline")}
        title={t("search.multiline")}
        onClick={() => toggle("multiline")}
      >
        ¶
      </button>
    </div>
  );
}
