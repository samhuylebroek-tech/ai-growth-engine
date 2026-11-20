// Where a number comes from and how much it can be trusted. Pure; shared by screens, tests and the Growth Officer.
// Actual = reported by a connected source or verified; manual = entered by the team; estimated = forecast or estimate;
// planned = a target. AI-inferred values are never stored as measurements or revenue, so they cannot appear as facts.
export type DataClass = "actual" | "manual" | "estimated" | "planned";
export type Verification = "verified" | "source_reported" | "unverified" | "not_applicable";
export type Freshness = "current" | "aging" | "stale" | "unknown";
export type Reliability = "high" | "medium" | "low";

export function measurementClass(kind: string): { cls: DataClass; verification: Verification } {
  switch (kind) {
    case "verified_actual":
      return { cls: "actual", verification: "verified" };
    case "imported_actual":
      return { cls: "actual", verification: "source_reported" };
    case "manual_actual":
      return { cls: "manual", verification: "unverified" };
    case "forecast":
      return { cls: "estimated", verification: "not_applicable" };
    default:
      return { cls: "planned", verification: "not_applicable" };
  }
}

export function revenueClass(dataClass: string): { cls: DataClass; verification: Verification } {
  if (dataClass === "imported") return { cls: "actual", verification: "source_reported" };
  if (dataClass === "manual") return { cls: "manual", verification: "unverified" };
  return { cls: "estimated", verification: "not_applicable" };
}

const DAY = 86_400_000;
/** Data about a finished period is current for about one month after it ends, then ages, then is stale. */
export function freshness(periodEnd: string | null | undefined, now: Date = new Date()): Freshness {
  if (!periodEnd) return "unknown";
  const end = new Date(`${periodEnd.slice(0, 10)}T23:59:59Z`).getTime();
  if (Number.isNaN(end)) return "unknown";
  const age = (now.getTime() - end) / DAY;
  if (age <= 35) return "current";
  if (age <= 70) return "aging";
  return "stale";
}

export function reliability(
  cls: DataClass,
  verification: Verification,
  fresh: Freshness,
): Reliability {
  if (cls === "estimated" || cls === "planned" || fresh === "stale" || fresh === "unknown")
    return "low";
  if (verification === "verified" || (verification === "source_reported" && fresh === "current"))
    return "high";
  return "medium";
}

const RANK: Record<DataClass, number> = { actual: 3, manual: 2, estimated: 1, planned: 0 };
/** A figure derived from several inputs is only as strong as its weakest input. */
export function weakestClass(classes: readonly DataClass[]): DataClass | null {
  if (!classes.length) return null;
  return classes.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}
