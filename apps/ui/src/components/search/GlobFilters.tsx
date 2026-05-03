import type { JSX } from "react";
import { useSearch } from "../../stores/searchStore";

export function GlobFilters(): JSX.Element {
  const include = useSearch((s) => s.options.includeGlobs.join(", "));
  const exclude = useSearch((s) => s.options.excludeGlobs.join(", "));
  const setInclude = useSearch((s) => s.setIncludeGlobs);
  const setExclude = useSearch((s) => s.setExcludeGlobs);

  const parse = (value: string): string[] =>
    value
      .split(",")
      .map((g) => g.trim())
      .filter((g) => g.length > 0);

  return (
    <div className="daisu-search-globs">
      <label className="daisu-search-glob-label">
        <span>files to include</span>
        <input
          type="text"
          className="daisu-input"
          placeholder="src/**, tests/**"
          defaultValue={include}
          onBlur={(e) => setInclude(parse(e.target.value))}
        />
      </label>
      <label className="daisu-search-glob-label">
        <span>files to exclude</span>
        <input
          type="text"
          className="daisu-input"
          placeholder="dist/**, *.min.js"
          defaultValue={exclude}
          onBlur={(e) => setExclude(parse(e.target.value))}
        />
      </label>
    </div>
  );
}
