import { type JSX } from "react";
import { useTranslation } from "react-i18next";

export function OutputView(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center h-full text-[11px] text-[var(--fg-muted)]">
      {t("bottomPanel.outputEmpty")}
    </div>
  );
}
