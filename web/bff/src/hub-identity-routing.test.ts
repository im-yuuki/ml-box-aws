import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHubUsername, type HubIdentity } from "./hub-identity.js";
import { persistResolvedHubIdentity, resolveAuthenticatedHubIdentity, type HubIdentityStore } from "./hub-identity-routing.js";

function mapping(overrides: Partial<HubIdentity> = {}): HubIdentity {
  return {
    userId: "sub-a",
    hubUsername: "legacy@example.com",
    legacyEmail: "legacy@example.com",
    previousHubUsername: null,
    status: "legacy",
    ...overrides,
  };
}

function store(overrides: Partial<HubIdentityStore> = {}): HubIdentityStore {
  return {
    getHubIdentity: async () => null,
    findHubIdentityByLegacyEmail: async () => null,
    findLegacyHubIdentityByUser: async () => null,
    listHubIdentityMappings: async () => [],
    ...overrides,
  };
}

test("resolved identity uses the canonical Cognito subject for a new user", async () => {
  const identity = await resolveAuthenticatedHubIdentity({ userId: "sub-new", email: "new@example.com", store: store() });
  assert.equal(identity.hubUsername, canonicalHubUsername("sub-new"));
  assert.equal(identity.status, "mapped");
});

test("resolved identity keeps the stored legacy username after an email rename", async () => {
  const identity = await resolveAuthenticatedHubIdentity({
    userId: "sub-a",
    email: "renamed@example.com",
    store: store({ getHubIdentity: async () => mapping() }),
  });
  assert.equal(identity.hubUsername, "legacy@example.com");
  assert.equal(identity.legacyEmail, "renamed@example.com");
});

test("resolved identity uses an owner-scoped legacy sandbox mapping", async () => {
  const identity = await resolveAuthenticatedHubIdentity({
    userId: "sub-a",
    email: "renamed@example.com",
    store: store({ findLegacyHubIdentityByUser: async () => mapping() }),
  });
  assert.equal(identity.hubUsername, "legacy@example.com");
});

test("resolved identity discovers a legacy email mapping without changing it", async () => {
  const identity = await resolveAuthenticatedHubIdentity({
    userId: "sub-a",
    email: "legacy@example.com",
    store: store({ findHubIdentityByLegacyEmail: async () => mapping() }),
  });
  assert.deepEqual(identity, mapping());
});

test("identity collision fails before provisioning or overwriting", async () => {
  let writes = 0;
  await assert.rejects(
    () => resolveAuthenticatedHubIdentity({
      userId: "sub-new",
      email: "new@example.com",
      store: store({
        listHubIdentityMappings: async () => [
          mapping({ userId: "sub-existing", hubUsername: canonicalHubUsername("sub-new") }),
        ],
        upsertHubIdentity: async () => { writes += 1; },
      }),
    }),
    /Hub identity conflict/,
  );
  assert.equal(writes, 0);
});

test("request input cannot override the authenticated identity", async () => {
  const identity = await resolveAuthenticatedHubIdentity({
    userId: "sub-new",
    email: "new@example.com",
    requestedHubUsername: "attacker@example.com",
    store: store(),
  });
  assert.equal(identity.hubUsername, canonicalHubUsername("sub-new"));
});

test("identity resolution does not write before authorization", async () => {
  const calls: string[] = [];
  await resolveAuthenticatedHubIdentity({
    userId: "sub-new",
    email: "new@example.com",
    authorize: async () => { calls.push("authorize"); return true; },
    provision: async () => { calls.push("provision"); },
    store: store(),
  });
  assert.deepEqual(calls, ["authorize"]);
});

test("persistResolvedHubIdentity writes before Hub provisioning", async () => {
  const calls: string[] = [];
  let saved: HubIdentity | null = null;
  const identity = await resolveAuthenticatedHubIdentity({
    userId: "sub-new",
    email: "new@example.com",
    authorize: async () => { calls.push("authorize"); return true; },
    store: store(),
  });
  await persistResolvedHubIdentity(identity, {
    upsertHubIdentity: async (mapping: HubIdentity) => { calls.push("persist"); saved = mapping; },
  });
  calls.push("provision");
  assert.deepEqual(calls, ["authorize", "persist", "provision"]);
  assert.deepEqual(saved, identity);
});
