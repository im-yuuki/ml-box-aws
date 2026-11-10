// Organization (Space) roles. One owner, any number of admins, and members.
//  - owner: unique. Full rights, buys the subscription, can delete the organization, and can hand the
//    ownership to one admin (the previous owner becomes an admin).
//  - admin: invites members, removes members, and changes member roles. Admins cannot grant admin.
//  - member / viewer: see the team and its members, and use the team's resources.
// Personal Spaces are never managed through these rules.

export type SpaceMemberRole = "owner" | "admin" | "member" | "viewer";

export const ASSIGNABLE_SPACE_ROLES: readonly SpaceMemberRole[] = ["admin", "member", "viewer"];

export function isSpaceMemberRole(value: unknown): value is SpaceMemberRole {
  return typeof value === "string" && ["owner", "admin", "member", "viewer"].includes(value);
}

/** Owners and admins see and change the member list. */
export function canManageMembers(actor: SpaceMemberRole | null): boolean {
  return actor === "owner" || actor === "admin";
}

/**
 * Whether `actor` may change `target`'s role to `next`. The owner role never changes here: ownership
 * moves only through transfer. Admins manage member and viewer roles, but cannot grant admin.
 */
export function canChangeMemberRole(actor: SpaceMemberRole | null, target: SpaceMemberRole, next: SpaceMemberRole): boolean {
  if (target === "owner" || next === "owner") return false;
  if (!ASSIGNABLE_SPACE_ROLES.includes(next)) return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target !== "admin" && next !== "admin";
  return false;
}

/** Owners remove anyone but themselves; admins remove members and viewers, never other admins. */
export function canRemoveMember(actor: SpaceMemberRole | null, target: SpaceMemberRole): boolean {
  if (target === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return target !== "admin";
  return false;
}

/** Only the owner hands the ownership to an admin. */
export function canTransferOwnership(actor: SpaceMemberRole | null, target: SpaceMemberRole | null): boolean {
  return actor === "owner" && target === "admin";
}

export function canDeleteOrganization(actor: SpaceMemberRole | null): boolean {
  return actor === "owner";
}

/** The owner types the organization name to confirm deletion. */
export function deleteConfirmationMatches(name: string, typed: unknown): boolean {
  return typeof typed === "string" && typed.trim() === name.trim();
}

export const ORGANIZATION_NAME_MAX_LENGTH = 60;

export function validateOrganizationName(name: unknown): { ok: true; value: string } | { ok: false } {
  if (typeof name !== "string") return { ok: false };
  const value = name.trim();
  if (!value || value.length > ORGANIZATION_NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, value };
}
