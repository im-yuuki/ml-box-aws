import type { SpaceSummary } from "./app-store.js";

/**
 * The Space a usage request is about. Without an explicit id the caller's personal Space is used.
 * Returns null when the caller is not a member of the requested Space.
 */
export function resolveSpaceId(
  spaces: SpaceSummary[],
  userId: string,
  requested: unknown,
): string | null {
  const personalSpaceId = `personal:${userId}`;
  const requestedId = typeof requested === "string" && requested.trim() ? requested.trim() : personalSpaceId;
  if (requestedId === personalSpaceId) return personalSpaceId;
  return spaces.some((space) => space.id === requestedId) ? requestedId : null;
}

/**
 * Keeps the Hub servers that belong to a Space. A Hub server is named after its Project, so the
 * Space of a server is the Space of that Project. A server that is not a known Project (the legacy
 * default server) belongs to the personal Space.
 */
export async function scopeServersToSpace<T extends { name: string }>(
  servers: T[],
  spaceId: string,
  userId: string,
  spaceOfProject: (projectId: string) => Promise<string | null>,
): Promise<T[]> {
  const kept: T[] = [];
  for (const server of servers) {
    const owner = (await spaceOfProject(server.name)) ?? `personal:${userId}`;
    if (owner === spaceId) kept.push(server);
  }
  return kept;
}
