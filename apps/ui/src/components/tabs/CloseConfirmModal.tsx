import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { PendingClose } from "../../stores/tabsStore";

interface Props {
  pending: PendingClose | null;
  tabsByName: Map<string, string>;
  onResolve: (action: "save" | "discard" | "cancel") => void;
}

const PREVIEW_CAP = 8;

export function CloseConfirmModal(props: Props): JSX.Element | null {
  const { t } = useTranslation();
  const { pending, tabsByName, onResolve } = props;
  if (!pending) return null;

  const isSingle = pending.mode === "single";
  const firstName = pending.ids[0]
    ? tabsByName.get(pending.ids[0]) ?? t("closeConfirm.defaultName")
    : t("closeConfirm.defaultName");
  const titleText = isSingle
    ? t("closeConfirm.titleSingle", { name: firstName })
    : t("closeConfirm.titleMulti", { count: pending.ids.length });
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
              <>{t("closeConfirm.descSingle")}</>
            ) : (
              <ul className="daisu-modal-list">
                {visibleNames.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                {overflow > 0 && (
                  <li className="daisu-modal-list-more">
                    {t("closeConfirm.andMore", { count: overflow })}
                  </li>
                )}
              </ul>
            )}
          </AlertDialog.Description>
          <div className="daisu-modal-actions">
            <button
              type="button"
              className="daisu-btn"
              onClick={() => onResolve("discard")}
            >
              {t("closeConfirm.dontSave")}
            </button>
            <button
              type="button"
              className="daisu-btn"
              onClick={() => onResolve("cancel")}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="daisu-btn-primary"
              onClick={() => onResolve("save")}
            >
              {isSingle ? t("closeConfirm.save") : t("closeConfirm.saveAll")}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
