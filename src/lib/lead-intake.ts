import { z } from "zod";

/**
 * Pure validation for public lead intake (proposal 0093, staging schema pending).
 * Spam protection: honeypot field plus minimum fill time. Consent is mandatory.
 * The idempotency key lets the database reject the same lead twice per day.
 */
export const MIN_FILL_MS = 3000;

export const leadIntakeSchema = z.object({
  formKey: z.string().trim().regex(/^[a-z0-9-]{8,64}$/),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().max(2000).optional(),
  consent: z.literal(true),
  website: z.string().max(0).optional(), // honeypot: must stay empty
  startedAt: z.number().int().nonnegative(),
});

export type LeadIntake = z.infer<typeof leadIntakeSchema>;

export type IntakeVerdict =
  | { ok: true; lead: LeadIntake }
  | { ok: false; reason: "invalid" | "consent" | "spam" };

export function checkLeadIntake(input: unknown, now: number): IntakeVerdict {
  const raw = (input ?? {}) as Record<string, unknown>;
  if (typeof raw["website"] === "string" && raw["website"].length > 0)
    return { ok: false, reason: "spam" };
  if (raw["consent"] !== true) return { ok: false, reason: "consent" };
  const parsed = leadIntakeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (now - parsed.data.startedAt < MIN_FILL_MS) return { ok: false, reason: "spam" };
  return { ok: true, lead: parsed.data };
}

export async function leadIdempotencyKey(formKey: string, email: string, now: number) {
  const day = new Date(now).toISOString().slice(0, 10);
  const data = new TextEncoder().encode(`${formKey}|${email.trim().toLowerCase()}|${day}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
