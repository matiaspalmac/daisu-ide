import type { JSX } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const visible = props.fileNames.slice(0, PREVIEW_CAP);
  const overflow = props.fileNames.length - visible.length;
  const fileCountLabel = t("search.replaceFiles", { count: props.fileCount });
  return (
    <AlertDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="daisu-modal-overlay" />
        <AlertDialog.Content className="daisu-modal" aria-describedby={undefined}>
          <AlertDialog.Title className="daisu-modal-title">
            {t("search.replaceTitle", {
              count: props.totalReplacements,
              fileCount: fileCountLabel,
            })}
          </AlertDialog.Title>
          <AlertDialog.Description className="daisu-modal-body">
            <ul className="daisu-modal-list">
              {visible.map((n) => (
                <li key={n}>{n}</li>
              ))}
              {overflow > 0 && (
                <li className="daisu-modal-list-more">
                  {t("search.andMore", { count: overflow })}
                </li>
              )}
            </ul>
          </AlertDialog.Description>
          <div className="daisu-modal-actions">
            <button
              type="button"
              className="daisu-btn"
              onClick={() => props.onOpenChange(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="daisu-btn-primary"
              onClick={() => void props.onConfirm()}
            >
              {t("search.confirmReplace")}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
