import type { OrgRole } from "@/lib/permissions";

export type Status = "implemented" | "partial" | "simulated" | "planned";
export type Risk = "read" | "write_internal" | "write_external";

export interface CapabilityManifest {
  key: string;
  name: string;
  description: string;
  risk: Risk;
  minRole: OrgRole;
  credits: number;
  /** write_external always requires approval regardless of policy */
  requiresApproval: boolean;
  status: Status;
}
export interface AgentManifest {
  key: string;
  name: string;
  description: string;
  capabilities: string[];
  status: Status;
}
export interface ConnectorManifest {
  key: string;
  name: string;
  category: string;
  description: string;
  auth: "oauth" | "api_key" | "none";
  capabilities: string[];
  status: Status;
  /** what is needed before it can be connected */
  requires?: string;
}
export interface ExtensionManifest {
  key: string;
  name: string;
  description: string;
  phase: number;
  status: Status;
}

export function defineCapability(m: CapabilityManifest): CapabilityManifest {
  if (m.risk === "write_external" && !m.requiresApproval)
    throw new Error(`${m.key}: external writes must require approval`);
  return m;
}
export const defineAgent = (m: AgentManifest) => m;
export const defineConnector = (m: ConnectorManifest) => m;
export const defineExtension = (m: ExtensionManifest) => m;
