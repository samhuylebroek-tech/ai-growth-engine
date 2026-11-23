// Simulated provider adapter. It behaves like an external platform for the test environment: it stores what it
// "holds" in the sandbox table (through server-attested functions) so verification can genuinely look a result up,
// including after a timeout. Nothing leaves the application. Pure apart from the injected backend.
import { actionByType } from "./catalog";

export const SCENARIOS = [
  "success",
  "provider_error",
  "timeout_after_write",
  "timeout_before_write",
  "permission_denied",
  "token_expired",
  "state_drift",
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export type SimRecord = {
  found: boolean;
  external_ref?: string;
  state?: string;
  created_at?: string;
};
export interface SimBackend {
  write(
    key: string,
    type: string,
    state: string,
    payload: Record<string, unknown>,
  ): Promise<{ external_ref: string; state: string; existing: boolean }>;
  lookup(key: string): Promise<SimRecord>;
}
export type ExecOutcome =
  | { outcome: "executed"; ref: string }
  | { outcome: "failed"; error: string; health: "expired" | "insufficient_scope" | "error" | null }
  | { outcome: "uncertain"; error: string };

/** The provider adapter contract every integration implements; real adapters are added behind the same shape. */
export interface ProviderAdapter {
  execute(input: {
    key: string;
    type: string;
    payload: Record<string, unknown>;
    scenario: Scenario;
  }): Promise<ExecOutcome>;
  verify(input: { key: string; type: string }): Promise<{
    status: "verified" | "failed" | "unavailable";
    found: boolean;
    ref: string | null;
    evidence: Record<string, unknown>;
  }>;
}

export function simulatedAdapter(b: SimBackend): ProviderAdapter {
  return {
    async execute({ key, type, payload, scenario }) {
      const spec = actionByType(type);
      if (!spec) return { outcome: "failed", error: "Unknown action type", health: null };
      switch (scenario) {
        case "provider_error":
          return {
            outcome: "failed",
            error: "Simulated: the provider rejected the request",
            health: null,
          };
        case "permission_denied":
          return {
            outcome: "failed",
            error: "Simulated: the provider denied permission",
            health: "insufficient_scope",
          };
        case "token_expired":
          return {
            outcome: "failed",
            error: "Simulated: the access token expired",
            health: "expired",
          };
        case "timeout_before_write":
          return { outcome: "uncertain", error: "Simulated: no answer from the provider" };
        case "timeout_after_write":
          await b.write(key, type, spec.state, payload);
          return { outcome: "uncertain", error: "Simulated: no answer from the provider" };
        case "state_drift": {
          const r = await b.write(key, type, "rejected_by_provider", payload);
          return { outcome: "executed", ref: r.external_ref };
        }
        default: {
          const r = await b.write(key, type, spec.state, payload);
          return { outcome: "executed", ref: r.external_ref };
        }
      }
    },
    async verify({ key, type }) {
      const spec = actionByType(type);
      const r = await b.lookup(key);
      if (!r.found)
        return {
          status: "failed",
          found: false,
          ref: null,
          evidence: { found: false, checked_at: new Date().toISOString() },
        };
      const ok = !!spec && r.state === spec.state;
      return {
        status: ok ? "verified" : "failed",
        found: true,
        ref: r.external_ref ?? null,
        evidence: {
          found: true,
          external_ref: r.external_ref,
          provider_state: r.state,
          expected_state: spec?.state,
          provider_created_at: r.created_at,
          simulated: true,
        },
      };
    },
  };
}
