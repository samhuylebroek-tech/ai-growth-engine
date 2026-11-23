import type { ReactNode } from "react";
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
