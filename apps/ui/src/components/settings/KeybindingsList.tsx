import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ACTIONS } from "../../lib/keybinding-registry";
import { KeybindingField } from "./controls/KeybindingField";

export function KeybindingsList(): JSX.Element {
  const { t } = useTranslation();
  // Collapse tabs.goto2..tabs.goto9 into a single header row backed by tabs.goto1.
  const visible = ACTIONS.filter((a) => !/^tabs\.goto[2-9]$/.test(a.id));

  return (
    <div className="daisu-keybindings">
      <div className="daisu-keybindings-header">
        <span>{t("keybindList.action")}</span>
        <span>{t("keybindList.category")}</span>
        <span>{t("keybindList.binding")}</span>
        <span />
        <span />
      </div>
      {visible.map((action) => {
        const isGoto = action.id === "tabs.goto1";
        const label = isGoto ? t("keybindList.gotoSeries") : action.label;
        return (
          <div className="daisu-keybindings-row-wrap" key={action.id}>
            <span className="daisu-keybindings-cat">{action.category}</span>
            <KeybindingField
              actionId={action.id}
              actionLabel={label}
              defaultBinding={action.defaultBinding}
            />
          </div>
        );
      })}
    </div>
  );
}
