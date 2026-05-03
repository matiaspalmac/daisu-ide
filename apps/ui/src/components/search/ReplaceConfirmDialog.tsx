import type { JSX } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totalReplacements: number;
  fileCount: number;
  fileNames: string[];
  onConfirm: () => void | Promise<void>;
}

const PREVIEW_CAP = 8;

export function ReplaceConfirmDialog(props: Props): JSX.Element {
  const visible = props.fileNames.slice(0, PREVIEW_CAP);
  const overflow = props.fileNames.length - visible.length;
  return (
    <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="daisu-modal-overlay" />
        <AlertDialog.Content className="daisu-modal" aria-describedby={undefined}>
          <AlertDialog.Title className="daisu-modal-title">
            Replace {props.totalReplacements} occurrence
            {props.totalReplacements === 1 ? "" : "s"} in {props.fileCount} file
            {props.fileCount === 1 ? "" : "s"}?
          </AlertDialog.Title>
          <AlertDialog.Description className="daisu-modal-body">
            <ul className="daisu-modal-list">
              {visible.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {overflow > 0 && (
                <li className="daisu-modal-list-more">and {overflow} more</li>
              )}
            </ul>
          </AlertDialog.Description>
          <div className="daisu-modal-actions">
            <button
              type="button"
              className="daisu-btn"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="daisu-btn-primary"
              onClick={() => void props.onConfirm()}
            >
              Replace
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
