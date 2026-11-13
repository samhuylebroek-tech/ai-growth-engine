import { defineCapability } from "./types";

export const CAPABILITIES = [
  defineCapability({ key: "profile.read", name: "Read business profile", description: "Read the workspace business profile and verified facts.", risk: "read", minRole: "viewer", credits: 0, requiresApproval: false, status: "implemented" }),
  defineCapability({ key: "documents.extract_facts", name: "Extract facts from documents", description: "Read an uploaded document and propose structured business facts.", risk: "write_internal", minRole: "member", credits: 3, requiresApproval: false, status: "implemented" }),
  defineCapability({ key: "website.analyze", name: "Analyze website", description: "Fetch the public homepage and summarize positioning.", risk: "read", minRole: "member", credits: 3, requiresApproval: false, status: "implemented" }),
  defineCapability({ key: "strategy.recommend", name: "Recommend growth actions", description: "Produce prioritized recommendations with reasoning and expected impact.", risk: "read", minRole: "member", credits: 0, requiresApproval: false, status: "implemented" }),
  defineCapability({ key: "approvals.propose", name: "Propose an action", description: "Create an action proposal in the Approval Center.", risk: "write_internal", minRole: "member", credits: 0, requiresApproval: false, status: "implemented" }),
  defineCapability({ key: "content.publish", name: "Publish content", description: "Publish a post or page to a connected channel.", risk: "write_external", minRole: "member", credits: 1, requiresApproval: true, status: "planned" }),
  defineCapability({ key: "ads.adjust_budget", name: "Adjust ad budget", description: "Change a campaign budget on a connected ad account.", risk: "write_external", minRole: "admin", credits: 1, requiresApproval: true, status: "planned" }),
  defineCapability({ key: "email.send_campaign", name: "Send email campaign", description: "Send a campaign through a connected email provider.", risk: "write_external", minRole: "admin", credits: 1, requiresApproval: true, status: "planned" }),
  defineCapability({ key: "crm.create_lead", name: "Create CRM lead", description: "Create a lead in a connected CRM.", risk: "write_external", minRole: "member", credits: 1, requiresApproval: true, status: "planned" }),
] as const;

export const capabilityByKey = (k: string) => CAPABILITIES.find((c) => c.key === k);
