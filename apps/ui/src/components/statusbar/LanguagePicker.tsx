import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useTabs } from "../../stores/tabsStore";
import {
  getActiveEditor,
  getMonacoNamespace,
} from "../../lib/monaco-editor-ref";
import { loadLanguageList, type LanguageEntry } from "../../lib/language-list";

export function LanguagePicker(): JSX.Element | null {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const setLanguage = useTabs((s) => s.setLanguage);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [languages, setLanguages] = useState<LanguageEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    const monaco = getMonacoNamespace();
    if (monaco) setLanguages(loadLanguageList(monaco));
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return languages;
    return languages.filter(
      (l) =>
        l.id.toLowerCase().includes(q) ||
        l.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [languages, filter]);

  if (!tab) return null;

  const apply = (langId: string): void => {
    setLanguage(tab.id, langId);
    const monaco = getMonacoNamespace();
    const editor = getActiveEditor();
    const model = editor?.getModel();
    if (monaco && model) {
      monaco.editor.setModelLanguage(model, langId);
    }
    setOpen(false);
    setFilter("");
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="daisu-status-segment daisu-status-clickable"
          title="Editor language"
        >
          {tab.language}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="daisu-language-popover"
          sideOffset={6}
          align="end"
        >
          <input
            ref={inputRef}
            type="text"
            className="daisu-language-filter"
            placeholder="Filter languages..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="daisu-language-list">
            {filtered.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`daisu-language-item${tab.language === l.id ? " is-active" : ""}`}
                onClick={() => apply(l.id)}
              >
                {l.id}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="daisu-language-empty">No matches</div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
