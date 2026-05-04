import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../stores/settingsStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";

type Side = "left" | "right";

interface DesignCardProps {
  title: string;
  desc: string;
  selectKey?: keyof Pick<
    DesignSettings,
    "activityBarSide" | "sidebarSide" | "rightPanelSide"
  >;
  selectOptions?: Array<{ value: Side; label: string }>;
  toggleKey?: keyof Pick<
    DesignSettings,
    | "activityBarVisible"
    | "statusBarVisible"
    | "sidebarVisible"
    | "rightPanelVisible"
    | "terminalVisible"
    | "statusBarPanelToggles"
    | "statusBarUtility"
    | "titleBarHamburger"
    | "titleBarMenuStrip"
    | "titleBarUserAvatar"
  >;
}

interface DesignSettings {
  activityBarSide: Side;
  activityBarVisible: boolean;
  statusBarVisible: boolean;
  sidebarSide: Side;
  sidebarVisible: boolean;
  rightPanelSide: Side;
  rightPanelVisible: boolean;
  terminalVisible: boolean;
  statusBarPanelToggles: boolean;
  statusBarUtility: boolean;
  titleBarHamburger: boolean;
  titleBarMenuStrip: boolean;
  titleBarUserAvatar: boolean;
}

function DesignCard(props: DesignCardProps): JSX.Element {
  const { t } = useTranslation();
  const design = useSettings((s) => s.settings.design) as DesignSettings;
  const setSetting = useSettings((s) => s.set);

  const onToggle = (): void => {
    if (!props.toggleKey) return;
    void setSetting("design", { [props.toggleKey]: !design[props.toggleKey] });
  };
  const onSelect = (v: Side): void => {
    if (!props.selectKey) return;
    void setSetting("design", { [props.selectKey]: v });
  };

  const isOn = props.toggleKey ? design[props.toggleKey] : false;

  return (
    <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 flex flex-col gap-2 min-h-[120px]">
      <div>
        <h4 className="text-sm font-medium text-[var(--fg-primary)]">{props.title}</h4>
        <p className="text-xs text-[var(--fg-secondary)] mt-0.5">{props.desc}</p>
      </div>
      <div className="flex items-center justify-between mt-auto gap-2">
        {props.selectKey && props.selectOptions ? (
          <Select
            value={design[props.selectKey]}
            onValueChange={(v) => onSelect(v as Side)}
          >
            <SelectTrigger className="flex-1 min-w-0 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.selectOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="flex-1" />
        )}
        {props.toggleKey && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={isOn}
            aria-label={t("settings.design.toggleAria", { name: props.title })}
            className={
              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
              (isOn
                ? "bg-[var(--accent)]"
                : "bg-[var(--bg-base)] border border-[var(--border-subtle)]")
            }
          >
            <span
              className={
                "block h-3.5 w-3.5 rounded-full transition-transform shadow-sm " +
                (isOn
                  ? "translate-x-[18px] bg-[var(--bg-base)]"
                  : "translate-x-[3px] bg-[var(--fg-primary)]")
              }
            />
          </button>
        )}
      </div>
    </div>
  );
}

function LayoutPicker(): JSX.Element {
  const { t } = useTranslation();
  const layoutMode = useSettings((s) => s.settings.design.layoutMode);
  const setSetting = useSettings((s) => s.set);

  const options: Array<{ value: "classic" | "fleet"; title: string; desc: string }> = [
    {
      value: "classic",
      title: t("settings.design.layout.classic"),
      desc: t("settings.design.layout.classicDesc"),
    },
    {
      value: "fleet",
      title: t("settings.design.layout.fleet"),
      desc: t("settings.design.layout.fleetDesc"),
    },
  ];

  return (
    <section className="mb-8">
      <h3 className="text-sm font-medium mb-3 text-[var(--fg-primary)]">
        {t("settings.design.layout.title")}
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
        {options.map((opt) => {
          const active = layoutMode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (opt.value === "fleet") {
                  void setSetting("design", {
                    layoutMode: "fleet",
                    sidebarSide: "right",
                    rightPanelSide: "left",
                    activityBarVisible: false,
                  });
                  void setSetting("editor", { keySoundEnabled: true });
                } else {
                  void setSetting("design", {
                    layoutMode: "classic",
                    sidebarSide: "left",
                    rightPanelSide: "right",
                  });
                }
              }}
              aria-pressed={active}
              className={
                "text-left bg-[var(--bg-elevated)] border rounded-[var(--radius-md)] p-4 flex flex-col gap-1 min-h-[100px] transition-colors " +
                (active
                  ? "border-[var(--accent)]"
                  : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]")
              }
            >
              <h4 className="text-sm font-medium text-[var(--fg-primary)]">{opt.title}</h4>
              <p className="text-xs text-[var(--fg-secondary)]">{opt.desc}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function Design(): JSX.Element {
  const { t } = useTranslation();
  const sideOptions: Array<{ value: Side; label: string }> = [
    { value: "left", label: t("settings.design.side.left") },
    { value: "right", label: t("settings.design.side.right") },
  ];

  return (
    <div className="daisu-settings-panel">
      <header className="border-b border-[var(--border-subtle)] pb-3 mb-6">
        <h2 className="text-base font-semibold text-[var(--fg-primary)]">{t("settings.design.title")}</h2>
        <p className="text-xs text-[var(--fg-secondary)]">
          {t("settings.design.subtitle")}
        </p>
      </header>

      <LayoutPicker />

      <section className="mb-8">
        <h3 className="text-sm font-medium mb-3 text-[var(--fg-primary)]">
          {t("settings.design.components")}
        </h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <DesignCard
            title={t("settings.design.cards.activityBar.title")}
            desc={t("settings.design.cards.activityBar.desc")}
            selectKey="activityBarSide"
            selectOptions={sideOptions}
            toggleKey="activityBarVisible"
          />
          <DesignCard
            title={t("settings.design.cards.statusBar.title")}
            desc={t("settings.design.cards.statusBar.desc")}
            toggleKey="statusBarVisible"
          />
          <DesignCard
            title={t("settings.design.cards.sidebar.title")}
            desc={t("settings.design.cards.sidebar.desc")}
            selectKey="sidebarSide"
            selectOptions={sideOptions}
            toggleKey="sidebarVisible"
          />
          <DesignCard
            title={t("settings.design.cards.terminal.title")}
            desc={t("settings.design.cards.terminal.desc")}
            toggleKey="terminalVisible"
          />
          <DesignCard
            title={t("settings.design.cards.chatPanel.title")}
            desc={t("settings.design.cards.chatPanel.desc")}
            selectKey="rightPanelSide"
            selectOptions={sideOptions}
            toggleKey="rightPanelVisible"
          />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-medium mb-3 text-[var(--fg-primary)]">
          {t("settings.design.panelButtons")}
        </h3>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <DesignCard
            title={t("settings.design.cards.panelToggles.title")}
            desc={t("settings.design.cards.panelToggles.desc")}
            toggleKey="statusBarPanelToggles"
          />
          <DesignCard
            title={t("settings.design.cards.utilityCluster.title")}
            desc={t("settings.design.cards.utilityCluster.desc")}
            toggleKey="statusBarUtility"
          />
          <DesignCard
            title={t("settings.design.cards.hamburger.title")}
            desc={t("settings.design.cards.hamburger.desc")}
            toggleKey="titleBarHamburger"
          />
          <DesignCard
            title={t("settings.design.cards.menuStrip.title")}
            desc={t("settings.design.cards.menuStrip.desc")}
            toggleKey="titleBarMenuStrip"
          />
          <DesignCard
            title={t("settings.design.cards.userAvatar.title")}
            desc={t("settings.design.cards.userAvatar.desc")}
            toggleKey="titleBarUserAvatar"
          />
        </div>
      </section>

      <p className="text-[11px] text-[var(--fg-muted)] mt-4">
        {t("settings.design.footer")}
      </p>
    </div>
  );
}
