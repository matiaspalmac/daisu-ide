import { useEffect } from "react";
import { useTabs } from "../stores/tabsStore";

const NUMERIC_KEYS = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);

export function useKeybindings(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!e.ctrlKey) return;
      const tabs = useTabs.getState();
      const key = e.key;

      if ((key === "s" || key === "S") && !e.shiftKey) {
        e.preventDefault();
        void tabs.saveActive();
        return;
      }
      if ((key === "s" || key === "S") && e.shiftKey) {
        e.preventDefault();
        void tabs.saveActiveAs();
        return;
      }
      if (key === "n" || key === "N") {
        e.preventDefault();
        tabs.newTab();
        return;
      }
      if (key === "w" || key === "W") {
        e.preventDefault();
        void tabs.closeActive();
        return;
      }
      if (key === "Tab") {
        e.preventDefault();
        tabs.cycleTabs(e.shiftKey ? -1 : 1);
        return;
      }
      if ((key === "t" || key === "T") && e.shiftKey) {
        e.preventDefault();
        void tabs.reopenClosed();
        return;
      }
      if (NUMERIC_KEYS.has(key)) {
        e.preventDefault();
        tabs.setActiveByIndex(Number(key) - 1);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
