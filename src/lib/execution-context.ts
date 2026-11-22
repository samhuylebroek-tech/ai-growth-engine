import { z } from "zod";
export const executionRefSchema = z.object({
  kind: z.enum(["projects", "tasks", "campaigns", "approvals", "activity_events"]),
  id: z.guid(),
});
export const executionSelectionSchema = z.array(executionRefSchema).max(12).default([]).superRefine((refs, ctx) => {
  if (new Set(refs.map(r => `${r.kind}:${r.id}`)).size !== refs.length)
    ctx.addIssue({ code: "custom", message: "Select each record only once" });
});
export type ExecutionRef = z.infer<typeof executionRefSchema>;