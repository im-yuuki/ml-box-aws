export type HubIdentityStatus = "legacy" | "mapped" | "migrated" | "conflict";

export type HubIdentity = {
  userId: string;
  hubUsername: string;
  legacyEmail: string | null;
  previousHubUsername: string | null;
  status: HubIdentityStatus;
};

const HUB_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/;

export function canonicalHubUsername(userId: string): string {
  if (!userId || !/^[A-Za-z0-9-]+$/.test(userId)) {
    throw new Error("Invalid Cognito subject");
  }
  const username = `cognito-${userId}`;
  if (!HUB_USERNAME_PATTERN.test(username)) {
    throw new Error("Invalid Cognito subject");
  }
  return username;
}

export function resolveHubIdentity(input: {
  userId: string;
  email: string;
  mapping?: HubIdentity | null;
  legacyHubUsername?: string | null;
}): HubIdentity {
  if (!input.userId || !input.email) throw new Error("Invalid Hub identity input");
  if (input.mapping) {
    if (input.mapping.userId !== input.userId) throw new Error("Hub identity mapping owner mismatch");
    return { ...input.mapping };
  }

  if (input.legacyHubUsername) {
    return {
      userId: input.userId,
      hubUsername: input.legacyHubUsername,
      legacyEmail: input.email,
      previousHubUsername: null,
      status: "legacy",
    };
  }

  return {
    userId: input.userId,
    hubUsername: canonicalHubUsername(input.userId),
    legacyEmail: input.email,
    previousHubUsername: null,
    status: "mapped",
  };
}

export function detectHubIdentityCollision(entries: HubIdentity[]): string[] {
  const owners = new Map<string, Set<string>>();
  for (const entry of entries) {
    const userIds = owners.get(entry.hubUsername) ?? new Set<string>();
    userIds.add(entry.userId);
    owners.set(entry.hubUsername, userIds);
  }
  return [...owners.entries()]
    .filter(([, userIds]) => userIds.size > 1)
    .map(([username]) => username)
    .sort();
}
