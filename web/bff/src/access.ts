export type SpaceRole = "owner" | "admin" | "member" | "viewer";
export type TeamRole = "lead" | "member";
export type ProjectRole = "manager" | "contributor" | "viewer" | "blocked";

export type ProjectPermissionInput = {
  spaceRole?: SpaceRole;
  teamRole?: TeamRole;
  directRole?: ProjectRole;
};

export type ProjectPermission = {
  role: Exclude<ProjectRole, "blocked">;
  canRead: boolean;
  canOperate: boolean;
  canManage: boolean;
};

export function resolveProjectPermission(input: ProjectPermissionInput): ProjectPermission | null {
  if (input.spaceRole === "owner" || input.spaceRole === "admin") {
    return { role: "manager", canRead: true, canOperate: true, canManage: true };
  }
  if (input.spaceRole === "viewer") {
    return { role: "viewer", canRead: true, canOperate: false, canManage: false };
  }

  const inheritedRole = input.teamRole === "lead" ? "manager" : input.teamRole === "member" ? "contributor" : null;
  const role = input.directRole ?? inheritedRole;
  if (!role || role === "blocked") return null;
  return {
    role,
    canRead: true,
    canOperate: role === "manager" || role === "contributor",
    canManage: role === "manager",
  };
}
