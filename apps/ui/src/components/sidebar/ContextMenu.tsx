import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { copy } from "../../lib/copy";

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
              {item(copy.contextMenu.newFile, "newFile")}
              {item(copy.contextMenu.newFolder, "newFolder")}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(copy.contextMenu.paste, "paste", pasteDisabled)}
            </>
          ) : (
            <>
              {item(copy.contextMenu.newFile, "newFile")}
              {item(copy.contextMenu.newFolder, "newFolder")}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(t("tabs.togglePin"), "togglePin", !oneSelected)}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(copy.contextMenu.cut, "cut", !anySelected)}
              {item(copy.contextMenu.copy, "copy", !anySelected)}
              {item(copy.contextMenu.paste, "paste", pasteDisabled)}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(copy.contextMenu.rename, "rename", renameDisabled)}
              {item(copy.contextMenu.delete, "delete", !anySelected)}
              <ContextMenu.Separator className="daisu-cmenu-separator" />
              {item(copy.contextMenu.copyPath, "copyPath", !oneSelected)}
              {item(copy.contextMenu.copyRelativePath, "copyRelativePath", !oneSelected)}
              {item(copy.contextMenu.revealInExplorer, "revealInExplorer", !oneSelected)}
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
