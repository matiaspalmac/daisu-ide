import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { CaretDown, PushPin } from "@phosphor-icons/react";

export interface OverflowEntry {
  id: string;
  name: string;
  dirty: boolean;
  pinned: boolean;
}

interface Props {
  hidden: OverflowEntry[];
  onPick: (id: string) => void;
}

export function TabOverflowDropdown(props: Props): JSX.Element | null {
  const { t } = useTranslation();
  if (props.hidden.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="daisu-tab-overflow"
          aria-label={t("tabOverflow.moreAria", { count: props.hidden.length })}
        >
          <CaretDown size={12} />
          +{props.hidden.length}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="daisu-dropdown" sideOffset={4} align="end">
          {props.hidden.map((entry) => (
            <DropdownMenu.Item
              key={entry.id}
              className="daisu-dropdown-item"
              onSelect={() => props.onPick(entry.id)}
            >
              {entry.pinned && (
                <PushPin
                  size={12}
                  weight="fill"
                  aria-hidden="true"
                  style={{ marginRight: 4 }}
                />
              )}
              {entry.name}
              {entry.dirty && (
                <span aria-hidden="true" style={{ marginLeft: 4 }}>●</span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
