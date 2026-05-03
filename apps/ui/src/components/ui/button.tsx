import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] focus-visible:shadow-[var(--glow-cyan-sm)] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-[var(--fg-inverse)] hover:bg-[var(--accent-bright)] shadow-[var(--glow-cyan-md)]",
        secondary:
          "bg-[var(--bg-elevated)] text-[var(--fg-primary)] border border-[var(--border-subtle)] hover:border-[var(--border-strong)]",
        ghost:
          "text-[var(--fg-primary)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]",
        outline:
          "border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-soft)] shadow-[var(--glow-cyan-sm)]",
        destructive:
          "bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_30%,transparent)]",
        warn:
          "bg-[var(--warn)] text-[var(--fg-inverse)] hover:bg-[var(--warn-bright)] shadow-[var(--glow-orange-md)]",
        link: "text-[var(--accent)] underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-7 px-2 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-10 px-4 text-base",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const buttonType = asChild ? type : (type ?? "button");
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...(buttonType !== undefined ? { type: buttonType } : {})}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
