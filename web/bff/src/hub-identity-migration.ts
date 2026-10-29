import { canonicalHubUsername, type HubIdentity } from "./hub-identity.js";

export type HubIdentityMigrationEntry = {
  userId: string;
  email: string;
  currentHubUsername: string | null;
  canonicalHubUsername: string;
  status: "ready" | "conflict" | "unchanged";
  reason?: string;
};

export function planHubIdentityMigration(entries: HubIdentity[]): HubIdentityMigrationEntry[] {
  const ordered = [...entries].sort((left, right) => left.userId.localeCompare(right.userId));
  const ownersByUsername = new Map<string, Set<string>>();
  for (const entry of ordered) {
    const usernames = [entry.hubUsername, canonicalHubUsername(entry.userId)];
    for (const username of usernames) {
      const owners = ownersByUsername.get(username) ?? new Set<string>();
      owners.add(entry.userId);
      ownersByUsername.set(username, owners);
    }
  }

  return ordered.map((entry) => {
    const canonical = canonicalHubUsername(entry.userId);
    const email = entry.legacyEmail ?? "";
    const collision = [entry.hubUsername, canonical].some((username) => (ownersByUsername.get(username)?.size ?? 0) > 1);
    if (collision) {
      return {
        userId: entry.userId,
        email,
        currentHubUsername: entry.hubUsername,
        canonicalHubUsername: canonical,
        status: "conflict",
        reason: "Hub username collision requires manual review",
      };
    }
    if (entry.hubUsername === canonical) {
      return {
        userId: entry.userId,
        email,
        currentHubUsername: entry.hubUsername,
        canonicalHubUsername: canonical,
        status: "unchanged",
        reason: "canonical username already mapped",
      };
    }
    return {
      userId: entry.userId,
      email,
      currentHubUsername: entry.hubUsername,
      canonicalHubUsername: canonical,
      status: "ready",
      reason: "legacy username can be migrated",
    };
  });
}

export function rollbackHubIdentity(mapping: HubIdentity): HubIdentity {
  if (mapping.status !== "migrated" || !mapping.previousHubUsername) return { ...mapping };
  return {
    ...mapping,
    hubUsername: mapping.previousHubUsername,
    previousHubUsername: null,
    status: "legacy",
  };
}
