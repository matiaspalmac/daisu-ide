import type { JSX } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { PendingClose } from "../../stores/tabsStore";

interface Props {
  pending: PendingClose | null;
  tabsByName: Map<string, string>;
  onResolve: (action: "save" | "discard" | "cancel") => void;
}

const PREVIEW_CAP = 8;

export function CloseConfirmModal(props: Props): JSX.Element | null {
  const { pending, tabsByName, onResolve } = props;
  if (!pending) return null;

  const isSingle = pending.mode === "single";
  const firstName = pending.ids[0]
    ? tabsByName.get(pending.ids[0]) ?? "this file"
    : "this file";
  const titleText = isSingle
    ? `Save changes to ${firstName}?`
    : `Save changes to ${pending.ids.length} files?`;
  const visibleNames = pending.ids
    .slice(0, PREVIEW_CAP)
    .map((id) => tabsByName.get(id) ?? id);
  const overflow = pending.ids.length - visibleNames.length;

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onResolve("cancel")}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="daisu-modal-overlay" />
        <AlertDialog.Content className="daisu-modal">
          <AlertDialog.Title className="daisu-modal-title">{titleText}</AlertDialog.Title>
          <AlertDialog.Description className="daisu-modal-body">
            {isSingle ? (
              <>Your changes will be lost if you don't save them.</>
            ) : (
              <ul className="daisu-modal-list">
                {visibleNames.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {overflow > 0 && <li className="daisu-modal-list-more">and {overflow} more</li>}
              </ul>
            )}
          </AlertDialog.Description>
          <div className="daisu-modal-actions">
            <button
              type="button"
              className="daisu-btn"
              onClick={() => onResolve("discard")}
            >
              Don't Save
            </button>
            <button
              type="button"
              className="daisu-btn"
              onClick={() => onResolve("cancel")}
            >
              Cancel
            </button>
            <button
              type="button"
              className="daisu-btn-primary"
              onClick={() => onResolve("save")}
            >
              {isSingle ? "Save" : "Save All"}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
