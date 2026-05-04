import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import type { RecentEntry } from "../../stores/workspaceStore";

interface Props {
  recents: RecentEntry[];
  onOpenFolderPicker: () => void;
  onPickRecent: (path: string) => void;
  onClearRecents: () => void;
}

export function RecentsDropdown(props: Props): JSX.Element {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="daisu-recents-trigger"
          aria-label={t("explorer.recent")}
          title={t("explorer.recent")}
        >
          <ClockCounterClockwise size={13} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="daisu-dropdown" sideOffset={4}>
          <DropdownMenu.Item
            className="daisu-dropdown-item"
            onSelect={() => props.onOpenFolderPicker()}
          >
            {t("explorer.recentOpenFolder")}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="daisu-dropdown-separator" />
          {props.recents.length === 0 ? (
            <div className="daisu-dropdown-empty">{t("explorer.recentNone")}</div>
          ) : (
            props.recents.map((r) => (
              <DropdownMenu.Item
                key={r.path}
                className="daisu-dropdown-item"
                onSelect={() => props.onPickRecent(r.path)}
                title={r.path}
              >
                {r.name}
              </DropdownMenu.Item>
            ))
          )}
          {props.recents.length > 0 && (
            <>
              <DropdownMenu.Separator className="daisu-dropdown-separator" />
              <DropdownMenu.Item
                className="daisu-dropdown-item"
                onSelect={() => props.onClearRecents()}
              >
                {t("explorer.recentClear")}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
