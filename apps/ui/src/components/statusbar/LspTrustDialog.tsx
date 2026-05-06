import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { trustWorkspace } from "../../lib/lsp";

interface Props {
  workspacePath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTrusted: () => void;
}

export function LspTrustDialog({
  workspacePath,
  open,
  onOpenChange,
  onTrusted,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await trustWorkspace(workspacePath);
      onTrusted();
      onOpenChange(false);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="daisu-modal-overlay" />
        <AlertDialog.Content className="daisu-modal">
          <AlertDialog.Title className="daisu-modal-title">
            {t("lsp.trustDialogTitle")}
          </AlertDialog.Title>
          <AlertDialog.Description className="daisu-modal-body">
            {t("lsp.trustDialogBody")}
          </AlertDialog.Description>
          <p
            className="my-2 px-2 py-1.5 bg-[var(--bg-panel)] rounded-[var(--radius-sm)] font-mono text-[11px] text-[var(--fg-muted)] overflow-x-auto whitespace-nowrap"
            title={workspacePath}
          >
            <code>{workspacePath}</code>
          </p>
          {error && (
            <p className="text-[11px] my-1.5 text-[var(--danger)]" role="alert">
              {error}
            </p>
          )}
          <div className="daisu-modal-actions">
            <button
              type="button"
              className="daisu-btn"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {t("lsp.trustDialogCancel")}
            </button>
            <button
              type="button"
              className="daisu-btn-primary"
              onClick={() => void handleConfirm()}
              disabled={busy}
            >
              {t("lsp.trustDialogConfirm")}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
