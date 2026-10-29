import {
  detectHubIdentityCollision,
  resolveHubIdentity,
  type HubIdentity,
} from "./hub-identity.js";

export type HubIdentityStore = {
  getHubIdentity: (userId: string) => Promise<HubIdentity | null>;
  findHubIdentityByLegacyEmail: (email: string) => Promise<HubIdentity | null>;
  findLegacyHubIdentityByUser?: (userId: string, email: string) => Promise<HubIdentity | null>;
  listHubIdentityMappings: () => Promise<HubIdentity[]>;
  upsertHubIdentity?: (mapping: HubIdentity) => Promise<void>;
};

export type AuthenticatedHubIdentityInput = {
  userId: string;
  email: string;
  store: HubIdentityStore;
  requestedHubUsername?: string;
  authorize?: () => Promise<boolean>;
  provision?: () => Promise<void>;
};

export class HubIdentityConflictError extends Error {
  constructor() {
    super("Hub identity conflict");
    this.name = "HubIdentityConflictError";
  }
}

export async function persistResolvedHubIdentity(identity: HubIdentity, store: Pick<HubIdentityStore, "upsertHubIdentity">): Promise<void> {
  await store.upsertHubIdentity?.(identity);
}

export async function resolveAuthenticatedHubIdentity(input: AuthenticatedHubIdentityInput): Promise<HubIdentity> {
  if (input.authorize && !(await input.authorize())) {
    throw new Error("Hub identity authorization denied");
  }

  const stored = await input.store.getHubIdentity(input.userId);
  const legacy = stored
    ? null
    : await input.store.findHubIdentityByLegacyEmail(input.email);
  const sandboxLegacy = stored || legacy || !input.store.findLegacyHubIdentityByUser
    ? null
    : await input.store.findLegacyHubIdentityByUser(input.userId, input.email);
  const identity = resolveHubIdentity({
    userId: input.userId,
    email: input.email,
    mapping: stored ?? legacy ?? sandboxLegacy,
    legacyHubUsername: sandboxLegacy?.hubUsername,
  });
  const resolvedIdentity = stored && stored.legacyEmail !== input.email
    ? { ...identity, legacyEmail: input.email }
    : identity;
  if (resolvedIdentity.status === "conflict") throw new HubIdentityConflictError();

  const mappings = await input.store.listHubIdentityMappings();
  const collisions = detectHubIdentityCollision([...mappings, resolvedIdentity]);
  if (collisions.length > 0) throw new HubIdentityConflictError();

  return resolvedIdentity;
}
