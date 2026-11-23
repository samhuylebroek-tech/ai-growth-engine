import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeading({
  title,
  eyebrow,
  action,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <div>
        {eyebrow && <p className="section-label mb-2">{eyebrow}</p>}
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {action}
    </div>
  );
}

/**
 * A secondary section that can be folded: the heading is the toggle (disclosure pattern), the body renders only when
 * open. Pages keep their first screen for what needs attention and fold supporting detail behind clear headings.
 */
export function CollapsibleSection({
  id,
  title,
  eyebrow,
  action,
  open,
  onOpenChange,
  children,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 border-t border-border pt-5">
      <div className={cn("flex items-center justify-between gap-3", open && "mb-4")}>
        <div className="min-w-0">
          {eyebrow && <p className="section-label mb-1 pl-6">{eyebrow}</p>}
          <h2 className="text-base font-semibold">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => onOpenChange(!open)}
              className="flex min-h-11 items-center gap-2 text-left hover:text-primary"
            >
              <ChevronDown
                aria-hidden
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
                  !open && "-rotate-90",
                )}
              />
              {title}
            </button>
          </h2>
        </div>
        {open && action}
      </div>
      {open && <div id={id}>{children}</div>}
    </section>
  );
}
