import type { JSX } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTabs } from "../../stores/tabsStore";
import { useUI } from "../../stores/uiStore";
import { readFileWithEncodingCmd } from "../../api/tauri";
import { translateError } from "../../lib/error-translate";

const ENCODINGS = ["UTF-8", "UTF-16LE", "UTF-16BE", "Windows-1252"];

export function EncodingSegment(): JSX.Element | null {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const pushToast = useUI((s) => s.pushToast);
  if (!tab || !tab.path) return null;
  const path = tab.path;

  const reload = async (encoding: string): Promise<void> => {
    if (encoding === tab.encoding) return;
    try {
      const opened = await readFileWithEncodingCmd(path, encoding);
      useTabs.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                content: opened.contents,
                savedContent: opened.contents,
                encoding: opened.encoding,
                eol: opened.eol ?? t.eol,
              }
            : t,
        ),
      }));
      pushToast({ message: `Reloaded with ${encoding}`, level: "success" });
    } catch (err) {
      pushToast({ message: translateError(err), level: "error" });
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="daisu-status-segment daisu-status-clickable"
          title="File encoding"
        >
          {tab.encoding}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="daisu-dropdown" sideOffset={6}>
          {ENCODINGS.map((e) => (
            <DropdownMenu.Item
              key={e}
              className="daisu-dropdown-item"
              onSelect={() => void reload(e)}
            >
              Reload with {e}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
