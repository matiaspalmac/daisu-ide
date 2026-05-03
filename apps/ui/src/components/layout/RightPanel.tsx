import type { JSX } from "react";
import { useUI } from "../../stores/uiStore";
import { AgentsPanel } from "./AgentsPanel";
import { ConfigPanel } from "./ConfigPanel";

export function RightPanel(): JSX.Element | null {
  const mode = useUI((s) => s.rightPanelMode);
  if (mode === "hidden") return null;
  if (mode === "config") return <ConfigPanel />;
  return <AgentsPanel />;
}
