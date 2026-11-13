// Pure role/permission model. Mirrors SQL helper public.has_org_role(); the DB is the
// enforcement point, this module drives UI and server-side pre-checks.
export type OrgRole = "owner" | "admin" | "member" | "viewer";

export const ROLE_RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

export type Action =
  | "org.update" | "org.delete" | "billing.manage"
  | "members.invite" | "members.manage"
  | "workspace.create" | "integrations.manage" | "extensions.manage" | "policies.manage"
  | "approvals.decide" | "audit.read"
  | "profile.edit" | "documents.upload" | "ai.use" | "approvals.propose"
  | "read";

const MIN_ROLE: Record<Action, OrgRole> = {
  "org.update": "admin", "org.delete": "owner", "billing.manage": "owner",
  "members.invite": "admin", "members.manage": "admin",
  "workspace.create": "admin", "integrations.manage": "admin", "extensions.manage": "admin",
  "policies.manage": "admin", "approvals.decide": "admin", "audit.read": "admin",
  "profile.edit": "member", "documents.upload": "member", "ai.use": "member", "approvals.propose": "member",
  read: "viewer",
};

export function hasRole(role: OrgRole | null | undefined, min: OrgRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export function can(role: OrgRole | null | undefined, action: Action): boolean {
  return hasRole(role, MIN_ROLE[action]);
}

/** Roles an actor may assign to others. Owner is never assignable (transfer is a separate flow). */
export function assignableRoles(actor: OrgRole | null | undefined): OrgRole[] {
  return hasRole(actor, "admin") ? ["admin", "member", "viewer"] : [];
}
