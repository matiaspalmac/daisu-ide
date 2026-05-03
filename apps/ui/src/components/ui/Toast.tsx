import type { JSX } from "react";
import * as RadixToast from "@radix-ui/react-toast";
import { useUI } from "../../stores/uiStore";

export function ToastViewport(): JSX.Element {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);

  return (
    <RadixToast.Provider swipeDirection="right" duration={5000}>
      {toasts.map((t) => (
        <RadixToast.Root
          key={t.id}
          className={`daisu-toast daisu-toast-${t.level}`}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          duration={t.durationMs ?? 5000}
        >
          <span className="daisu-toast-glyph" aria-hidden="true">
            {t.level === "success" ? "成" : t.level === "warning" ? "警" : t.level === "error" ? "誤" : "情"}
          </span>
          <RadixToast.Title className="daisu-toast-title">{t.message}</RadixToast.Title>
          {t.action && (
            <RadixToast.Action altText={t.action.label} asChild>
              <button
                type="button"
                className="daisu-toast-action"
                onClick={() => {
                  const result = t.action?.onAction();
                  Promise.resolve(result).finally(() => dismiss(t.id));
                }}
              >
                {t.action.label}
              </button>
            </RadixToast.Action>
          )}
          <RadixToast.Close className="daisu-toast-close" aria-label="Close">
            ×
          </RadixToast.Close>
        </RadixToast.Root>
      ))}
      <RadixToast.Viewport className="daisu-toast-viewport" />
    </RadixToast.Provider>
  );
}

export function useToast(): (message: string, level?: "info" | "success" | "warning" | "error") => void {
  const push = useUI((s) => s.pushToast);
  return (message, level = "info") => {
    push({ message, level });
  };
}
