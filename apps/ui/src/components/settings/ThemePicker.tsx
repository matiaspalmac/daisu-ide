import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "@phosphor-icons/react";
import { useThemes } from "../../stores/themesStore";
import { useSettings } from "../../stores/settingsStore";
import { readThemeJsonCmd, type ThemeDescriptor } from "../../api/tauri";
import { ThemeSchema } from "../../lib/theme-schema";

interface ThemeSwatch {
  bg: string;
  fg: string;
}

export function ThemePicker(): JSX.Element {
  const { t } = useTranslation();
  const bundled = useThemes((s) => s.bundled);
  const loadBundled = useThemes((s) => s.loadBundled);
  const activeThemeId = useSettings((s) => s.settings.themes.activeThemeId);
  const setSetting = useSettings((s) => s.set);
  const [swatches, setSwatches] = useState<Record<string, ThemeSwatch>>({});

  useEffect(() => {
    void loadBundled();
  }, [loadBundled]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, ThemeSwatch> = {};
      for (const t of bundled) {
        try {
          const json = await readThemeJsonCmd(t.id);
          const parsed = ThemeSchema.parse(json);
          next[t.id] = {
            bg: parsed.colors?.["editor.background"] ?? "#1f1f1f",
            fg: parsed.colors?.["editor.foreground"] ?? "#cccccc",
          };
        } catch {
          next[t.id] = { bg: "#1f1f1f", fg: "#cccccc" };
        }
      }
      if (!cancelled) setSwatches(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [bundled]);

  const select = (theme: ThemeDescriptor): void => {
    void setSetting("themes", { activeThemeId: theme.id });
  };
  const activeAria = t("settingsThemes.activeAria");

  return (
    <div className="daisu-theme-grid" role="radiogroup" aria-label={t("settingsThemes.pickerAria")}>
      {bundled.map((theme) => {
        const sw = swatches[theme.id] ?? { bg: "#1f1f1f", fg: "#ccc" };
        const active = activeThemeId === theme.id;
        return (
          <button
            type="button"
            key={theme.id}
            role="radio"
            aria-checked={active}
            className={`daisu-theme-card${active ? " is-active" : ""}`}
            onClick={() => select(theme)}
          >
            <span
              className="daisu-theme-swatch"
              style={{ background: sw.bg, color: sw.fg }}
              aria-hidden="true"
            >
              Aa
            </span>
            <span className="daisu-theme-name">{theme.name}</span>
            <span className="daisu-theme-kind">{theme.kind}</span>
            {active && <Check size={14} className="daisu-theme-check" aria-label={activeAria} />}
          </button>
        );
      })}
    </div>
  );
}
