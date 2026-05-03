import * as SwitchPrimitives from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/cn";

export const Switch = forwardRef<
  ElementRef<typeof SwitchPrimitives.Root>,
  ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] transition-colors",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]",
      "disabled:cursor-not-allowed disabled:opacity-40",
      "data-[state=checked]:bg-[var(--accent-soft)] data-[state=checked]:border-[var(--accent)]",
      "data-[state=checked]:shadow-[var(--glow-cyan-sm)]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-[var(--fg-muted)] shadow-md transition-transform",
        "data-[state=checked]:translate-x-4 data-[state=checked]:bg-[var(--accent)]",
        "data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;
