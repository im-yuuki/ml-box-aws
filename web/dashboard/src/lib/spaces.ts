export type SpaceRole = "owner" | "admin" | "member" | "viewer";

export type SpaceSummary = {
  id: string;
  type: "personal" | "organization";
  name: string;
  role: SpaceRole;
};

export type SpaceListResponse = { spaces?: SpaceSummary[] };

export const ACTIVE_SPACE_STORAGE_KEY = "mlbox-active-space";
export const ACTIVE_SPACE_EVENT = "mlbox-active-space-change";

// Chooses the stored Space when it is still one the user belongs to; otherwise the first Space
// (personal Spaces are listed first by the BFF).
export function chooseActiveSpace(spaces: SpaceSummary[], storedId: string | null): SpaceSummary | null {
  if (spaces.length === 0) return null;
  return spaces.find((space) => space.id === storedId) ?? spaces[0] ?? null;
}

// Fired after an organization is created or deleted, so every hook instance reloads the Space list.
export const SPACES_CHANGED_EVENT = "mlbox-spaces-changed";

export function notifySpacesChanged(): void {
  window.dispatchEvent(new Event(SPACES_CHANGED_EVENT));
}

// Owners and admins invite members and manage the member list. Members only view the team.
export function canManageTeams(role: SpaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
