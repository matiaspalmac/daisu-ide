import type { JSX } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useTabs } from "../../stores/tabsStore";
import { useUI } from "../../stores/uiStore";
import { convertEolCmd, openFile } from "../../api/tauri";
import { translateError } from "../../lib/error-translate";

export function EolSegment(): JSX.Element | null {
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const pushToast = useUI((s) => s.pushToast);
  if (!tab || !tab.path) return null;
  const path = tab.path;

  const apply = async (target: "LF" | "CRLF"): Promise<void> => {
    if (target === tab.eol) return;
    try {
      await convertEolCmd(path, target);
      // Re-read the file from disk so the in-memory editor buffer matches
      // the converted line endings; otherwise the next save would silently
      // restore the previous EOL style from the stale buffer.
      const opened = await openFile(path);
      useTabs.setState((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                content: opened.contents,
                savedContent: opened.contents,
                eol: opened.eol ?? target,
              }
            : t,
        ),
      }));
      pushToast({ message: `EOL converted to ${target}`, level: "success" });
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
          title="End of line"
        >
          {tab.eol}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="daisu-dropdown" sideOffset={6}>
          <DropdownMenu.Item
            className="daisu-dropdown-item"
            onSelect={() => void apply("LF")}
          >
            LF
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="daisu-dropdown-item"
            onSelect={() => void apply("CRLF")}
          >
            CRLF
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
