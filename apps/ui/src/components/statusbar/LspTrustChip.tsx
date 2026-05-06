import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { ShieldWarning } from "@phosphor-icons/react";
import { useWorkspace } from "../../stores/workspaceStore";
import { isWorkspaceTrusted } from "../../lib/lsp";
import { LspTrustDialog } from "./LspTrustDialog";

const chipCls =
  "h-5 px-1.5 inline-flex items-center gap-1 text-[11px] rounded-[var(--radius-sm)] " +
  "text-[var(--warn)] bg-[var(--warn-soft)] border border-[var(--warn)] " +
  "hover:bg-[var(--warn)] hover:text-[var(--bg-base)] transition-colors";

export function LspTrustChip(): JSX.Element | null {
  const { t } = useTranslation();
  const rootPath = useWorkspace((s) => s.rootPath);
  const [trusted, setTrusted] = useState<boolean | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!rootPath) {
      setTrusted(null);
      return;
    }
    let cancelled = false;
    void isWorkspaceTrusted(rootPath)
      .then((s) => {
        if (!cancelled) setTrusted(s.trusted);
      })
      .catch(() => {
        if (!cancelled) setTrusted(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  if (!rootPath) return null;
  if (trusted === null) return null;
  if (trusted) return null;

  return (
    <>
      <button
        type="button"
        className={chipCls}
        onClick={() => setDialogOpen(true)}
        title={t("lsp.trustButton")}
        aria-label={t("lsp.trustButton")}
      >
        <ShieldWarning size={11} weight="fill" />
        <span>{t("lsp.untrustedChip")}</span>
      </button>
      <LspTrustDialog
        workspacePath={rootPath}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onTrusted={() => setTrusted(true)}
      />
    </>
  );
}
