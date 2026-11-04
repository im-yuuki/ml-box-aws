export type TeamRole = "lead" | "member";

export type TeamRecord = {
  id: string;
  spaceId: string;
  name: string;
};

export type TeamMemberRecord = {
  userId: string;
  role: TeamRole;
  email: string | null;
};

export type TeamListResponse = { spaceId?: string; teams?: TeamRecord[] };
export type TeamMemberListResponse = { teamId?: string; members?: TeamMemberRecord[] };

export type TeamLoadState = "ready" | "unauthenticated" | "unauthorized" | "unavailable";

export function classifyTeamResponse(status: number): TeamLoadState {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "unauthorized";
  if (status >= 500) return "unavailable";
  return "ready";
}

export const TEAM_NAME_MAX_LENGTH = 60;
export const MEMBER_ID_MAX_LENGTH = 128;

export function validateTeamName(name: string): { ok: true; value: string } | { ok: false } {
  const value = name.trim();
  if (!value || value.length > TEAM_NAME_MAX_LENGTH) return { ok: false };
  return { ok: true, value };
}

// Members are added by Cognito subject until invitations exist; keep the input conservative.
export function validateMemberId(userId: string): { ok: true; value: string } | { ok: false } {
  const value = userId.trim();
  if (!value || value.length > MEMBER_ID_MAX_LENGTH || /\s/.test(value)) return { ok: false };
  return { ok: true, value };
}

export function parseTeamRole(value: string): TeamRole | null {
  return value === "lead" || value === "member" ? value : null;
}

export function memberLabel(member: TeamMemberRecord): string {
  return member.email ?? member.userId;
}
