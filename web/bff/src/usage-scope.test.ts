import assert from "node:assert/strict";
import test from "node:test";
import { resolveSpaceId, scopeServersToSpace } from "./usage-scope.js";
import type { SpaceSummary } from "./app-store.js";

const spaces: SpaceSummary[] = [
  { id: "personal:u1", type: "personal", name: "u1's Space", role: "owner" },
  { id: "org:a", type: "organization", name: "Team A", role: "owner" },
  { id: "org:b", type: "organization", name: "Team B", role: "member" },
];

test("usage falls back to the personal Space", () => {
  assert.equal(resolveSpaceId(spaces, "u1", undefined), "personal:u1");
  assert.equal(resolveSpaceId(spaces, "u1", ""), "personal:u1");
});

test("usage accepts a Space the caller belongs to", () => {
  assert.equal(resolveSpaceId(spaces, "u1", "org:a"), "org:a");
  assert.equal(resolveSpaceId(spaces, "u1", "org:b"), "org:b");
});

test("usage rejects a Space the caller does not belong to", () => {
  assert.equal(resolveSpaceId(spaces, "u1", "org:other"), null);
});

test("the project list refuses a Space the caller does not belong to", () => {
  // The projects route uses the same guard as the usage route, so a Space of another account
  // is refused instead of answered with an empty project list.
  const memberSpaces: SpaceSummary[] = [{ id: "personal:u2", type: "personal", name: "u2's Space", role: "owner" }];
  assert.equal(resolveSpaceId(memberSpaces, "u2", "org:a"), null);
  assert.equal(resolveSpaceId(spaces, "u1", "org:b"), "org:b");
});

test("only the servers of the requested Space are reported", async () => {
  const servers = [{ name: "p1" }, { name: "p2" }, { name: "default" }];
  const spaceOfProject = async (projectId: string) => {
    if (projectId === "p1") return "org:a";
    if (projectId === "p2") return "org:b";
    return null;
  };

  const orgA = await scopeServersToSpace(servers, "org:a", "u1", spaceOfProject);
  assert.deepEqual(orgA.map((server) => server.name), ["p1"]);

  const personal = await scopeServersToSpace(servers, "personal:u1", "u1", spaceOfProject);
  // The legacy default server is not a Project, so it belongs to the personal Space.
  assert.deepEqual(personal.map((server) => server.name), ["default"]);
});
