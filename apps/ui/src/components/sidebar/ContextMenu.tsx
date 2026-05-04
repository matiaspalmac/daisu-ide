import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as ContextMenu from "@radix-ui/react-context-menu";

export type TreeAction =
  | "newFile"
  | "newFolder"
  | "cut"
  | "copy"
  | "paste"
  | "rename"
  | "delete"
  | "copyPath"
  | "copyRelativePath"
  | "revealInExplorer"
  | "togglePin";

interface Props {
  target: "node" | "empty-area";
  selectionSize: number;
  clipboardPresent: boolean;
  onAction: (action: TreeAction) => void;
  children: ReactNode;
}

export function TreeContextMenu(props: Props): JSX.Element {
  const { t } = useTranslation();
  const renameDisabled = props.selectionSize !== 1;
  const oneSelected = props.selectionSize === 1;
  const anySelected = props.selectionSize >= 1;
  const pasteDisabled = !props.clipboardPresent;

  const item = (label: string, action: TreeAction, disabled = false): JSX.Element => (
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
          {props.target === "empty-area" ? (
            <>
              {item(t("explorer.ctxNewFile"), "newFile")}
              {item(t("explorer.ctxNewFolder"), "newFolder")}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(t("explorer.ctxPaste"), "paste", pasteDisabled)}
            </>
          ) : (
            <>
              {item(t("explorer.ctxNewFile"), "newFile")}
              {item(t("explorer.ctxNewFolder"), "newFolder")}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(t("tabs.togglePin"), "togglePin", !oneSelected)}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(t("explorer.ctxCut"), "cut", !anySelected)}
              {item(t("explorer.ctxCopy"), "copy", !anySelected)}
              {item(t("explorer.ctxPaste"), "paste", pasteDisabled)}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(t("explorer.ctxRename"), "rename", renameDisabled)}
              {item(t("explorer.ctxDelete"), "delete", !anySelected)}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(t("explorer.ctxCopyPath"), "copyPath", !oneSelected)}
              {item(t("explorer.ctxCopyRelativePath"), "copyRelativePath", !oneSelected)}
              {item(t("explorer.ctxRevealInExplorer"), "revealInExplorer", !oneSelected)}
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
