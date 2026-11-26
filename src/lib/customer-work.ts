import { z } from "zod";
import { dateInput } from "@/lib/execution";

export const CUSTOMER_PURPOSES = ["followup", "retention", "reactivation"] as const;
export type CustomerPurpose = (typeof CUSTOMER_PURPOSES)[number];
export const customerWorkSchema = z.object({
  orgId: z.guid(),
  workspaceId: z.guid(),
  dealId: z.guid(),
  requestId: z.guid(),
  purpose: z.enum(CUSTOMER_PURPOSES),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(8000),
  due: dateInput,
});
export type CustomerWorkInput = z.infer<typeof customerWorkSchema>;
export function customerPurpose(stage: string): CustomerPurpose {
  return stage === "won" ? "retention" : stage === "lost" ? "reactivation" : "followup";
}
export function customerWorkLabels(dealId: string, purpose: CustomerPurpose) {
  return ["customer-work", `crm-deal:${dealId}`, `customer-purpose:${purpose}`];
}
export async function customerInputLabel(input: CustomerWorkInput) {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `customer-input:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
export function customerTaskState(status: string, due: string | null, today: string) {
  if (status === "done") return "recorded_done";
  if (status === "cancelled") return "cancelled";
  if (status === "review") return "review";
  if (due && due < today) return "overdue";
  return status === "in_progress" ? "in_progress" : "prepared";
}
