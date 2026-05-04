import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as ContextMenu from "@radix-ui/react-context-menu";

export type TabAction =
  | "close"
  | "closeOthers"
  | "closeAll"
  | "pin"
  | "unpin"
  | "copyPath"
  | "revealInExplorer";

interface Props {
  tabId: string;
  pinned: boolean;
  hasPath: boolean;
  totalTabs: number;
  onAction: (action: TabAction) => void;
  children: ReactNode;
}

export function TabContextMenu(props: Props): JSX.Element {
  const { t } = useTranslation();
  const item = (label: string, action: TabAction, disabled = false): JSX.Element => (
    <ContextMenu.Item
      className="daisu-cmenu-item"
      disabled={disabled}
      onSelect={() => props.onAction(action)}
    >
      {label}
    </ContextMenu.Item>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{props.children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="daisu-cmenu" collisionPadding={8}>
          {item(t("tabContext.close"), "close")}
          {item(t("tabContext.closeOthers"), "closeOthers", props.totalTabs <= 1)}
          {item(t("tabContext.closeAll"), "closeAll", props.totalTabs === 0)}
          <ContextMenu.Separator className="daisu-cmenu-separator" />
          {props.pinned ? item(t("tabContext.unpin"), "unpin") : item(t("tabContext.pin"), "pin")}
          <ContextMenu.Separator className="daisu-cmenu-separator" />
          {item(t("tabContext.copyPath"), "copyPath", !props.hasPath)}
          {item(t("tabContext.revealInExplorer"), "revealInExplorer", !props.hasPath)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
