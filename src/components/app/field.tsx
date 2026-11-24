import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A form field with its name always visible above the control, so a field never depends on placeholder text alone. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs", className)}>
      <span className="font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-2xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
