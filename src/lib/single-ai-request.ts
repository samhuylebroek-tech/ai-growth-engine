import { z } from "zod";
import { executionSelectionSchema } from "@/lib/execution-context";

export const singleRequestSchema = z.object({
  id: z.string().uuid(), run_id: z.string().uuid(), claimed: z.boolean().optional(),
  kind: z.enum(["growth_officer", "strategy", "research", "seo", "content"]),
  status: z.enum(["running", "succeeded", "failed"]),
  input: z.object({ request: z.string(), conversationId: z.string().uuid().nullable().optional(), executionContext: executionSelectionSchema }),
  conversation_id: z.string().uuid().nullable(), message_id: z.string().uuid().nullable(),
  reply: z.string().nullable(), credits: z.number().int().nullable(),
});

/** An attempt keeps its identity through errors and reloads; only success releases it. */
export function requestAttemptKey(storage: Pick<Storage, "getItem" | "setItem">, scope: string, input: string, create: () => string) {
  const key = `single-ai-attempt:${scope}`;
  try {
    const previous = JSON.parse(storage.getItem(key) ?? "null") as { input?: string; requestKey?: string } | null;
    if (previous?.input === input && previous.requestKey && z.string().uuid().safeParse(previous.requestKey).success) return previous.requestKey;
  } catch { /* Invalid local drafts are replaced, not trusted for authorization. */ }
  const requestKey = create();
  storage.setItem(key, JSON.stringify({ input, requestKey }));
  return requestKey;
}