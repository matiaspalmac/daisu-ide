import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ToggleField } from "../controls/ToggleField";
import { SelectField } from "../controls/SelectField";
import { NumberField } from "../controls/NumberField";
import { TextField } from "../controls/TextField";

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
    </div>
  );
}
