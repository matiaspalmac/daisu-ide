import { useEffect, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { ToggleField } from "../controls/ToggleField";
import { SelectField } from "../controls/SelectField";
import { NumberField } from "../controls/NumberField";
import { TextField } from "../controls/TextField";
import { useShells } from "../../../stores/shellsStore";

export function EditorSettings(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="daisu-settings-panel">
      <h2 className="daisu-settings-panel-title">{t("settingsEditor.title")}</h2>
      <NumberField category="editor" field="fontSize" label="Font size" min={8} max={48} />
      <TextField category="editor" field="fontFamily" label="Font family" />
      <NumberField category="editor" field="tabSize" label="Tab size" min={1} max={16} />
      <ToggleField category="editor" field="insertSpaces" label="Insert spaces" />
      <SelectField
        category="editor"
        field="wordWrap"
        label="Word wrap"
        options={[
          { value: "off", label: "Off" },
          { value: "on", label: "On" },
          { value: "wordWrapColumn", label: "Wrap at column" },
          { value: "bounded", label: "Bounded" },
        ]}
      />
      <ToggleField category="editor" field="minimap" label="Minimap" />
      <SelectField
        category="editor"
        field="lineNumbers"
        label="Line numbers"
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
          { value: "relative", label: "Relative" },
        ]}
      />
      <SelectField
        category="editor"
        field="cursorStyle"
        label="Cursor style"
        options={[
          { value: "line", label: "Line" },
          { value: "block", label: "Block" },
          { value: "underline", label: "Underline" },
        ]}
      />
      <ToggleField category="editor" field="smoothScrolling" label="Smooth scrolling" />
      <ToggleField
        category="editor"
        field="bracketPairColorization"
        label="Bracket pair colorization"
      />
      <ToggleField category="editor" field="formatOnSave" label="Format on save" />
      <TerminalDefaultShellField />


      <h3 className="daisu-settings-section-title">{t("editorKeySound.heading")}</h3>
      <p className="daisu-field-desc">{t("editorKeySound.description")}</p>
      <ToggleField
        category="editor"
        field="keySoundEnabled"
        label={t("editorKeySound.enable")}
      />
      <NumberField
        category="editor"
        field="keySoundVolume"
        label={t("editorKeySound.volume")}
        min={0}
        max={1}
        step={0.05}
      />
      <SelectField
        category="editor"
        field="keySoundPack"
        label={t("editorKeySound.pack")}
        options={[
          { value: "soft", label: t("editorKeySound.packs.soft") },
          { value: "typewriter", label: t("editorKeySound.packs.typewriter") },
          { value: "mechanical", label: t("editorKeySound.packs.mechanical") },
        ]}
      />
    </div>
  );
}

function TerminalDefaultShellField(): JSX.Element {
  const { t } = useTranslation();
  const shells = useShells((s) => s.shells);
  const ensureLoaded = useShells((s) => s.ensureLoaded);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  const options = [
    { value: "" as const, label: t("terminal.shells.defaultAuto") },
    ...shells.map((s) => ({ value: s.id, label: s.label })),
  ];
  return (
    <SelectField
      category="editor"
      field="terminalDefaultShellId"
      label={t("terminal.shells.defaultLabel")}
      options={options}
    />
  );
}
