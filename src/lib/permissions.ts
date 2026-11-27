// Pure role/permission model. Mirrors SQL helper public.has_org_role(); the DB is the
// enforcement point, this module drives UI and server-side pre-checks.
export type OrgRole = "owner" | "admin" | "editor" | "member" | "viewer";

/** Mirrors public.role_rank (proposal 0067): an editor passes every member check. */
export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  editor: 3,
  member: 2,
  viewer: 1,
};

export type Action =
  | "org.update"
  | "org.delete"
  | "billing.manage"
  | "members.invite"
  | "members.manage"
  | "workspace.create"
  | "integrations.manage"
  | "extensions.manage"
  | "policies.manage"
  | "approvals.decide"
  | "audit.read"
  | "profile.edit"
  | "documents.upload"
  | "ai.use"
  | "approvals.propose"
  | "profile.confirm"
  | "budgets.manage"
  | "specialists.manage"
  | "finance.consolidated"
  | "rates.manage"
  | "org.strategy"
  | "org.coordinate"
  | "evidence.decide"
  | "read";

const MIN_ROLE: Record<Action, OrgRole> = {
  "org.update": "admin",
  "org.delete": "owner",
  "billing.manage": "owner",
  "members.invite": "admin",
  "members.manage": "admin",
  "workspace.create": "admin",
  "integrations.manage": "admin",
  "extensions.manage": "admin",
  "policies.manage": "admin",
  "approvals.decide": "admin",
  "audit.read": "admin",
  "profile.edit": "member",
  "documents.upload": "member",
  "ai.use": "member",
  "approvals.propose": "member",
  // Business hierarchy (proposal 0068): editors confirm business facts and manage budgets; business admins allocate
  // specialists; organization admins see consolidated finances and record exchange rates.
  "profile.confirm": "editor",
  "budgets.manage": "editor",
  "specialists.manage": "admin",
  "finance.consolidated": "admin",
  "rates.manage": "admin",
  // Organization level (proposal 0070): admins start the Organization Growth Officer and approve organization strategies;
  // editors record opportunities and prepare shared initiatives and allocation proposals. Applying anything still needs the
  // business-level right in every affected business, checked by the database.
  "org.strategy": "admin",
  "org.coordinate": "editor",
  // Evidence governance (proposal 0073): editors accept or reject evidence and review proposals; admins approve.
  "evidence.decide": "editor",
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
  return hasRole(actor, "admin") ? ["admin", "editor", "member", "viewer"] : [];
}
