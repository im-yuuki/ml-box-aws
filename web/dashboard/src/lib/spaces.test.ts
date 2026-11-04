import assert from "node:assert/strict";
import test from "node:test";

import { canManageTeams, chooseActiveSpace, type SpaceSummary } from "./spaces.ts";

const personal: SpaceSummary = { id: "personal:u1", type: "personal", name: "Me", role: "owner" };
const org: SpaceSummary = { id: "org-1", type: "organization", name: "Acme", role: "member" };

test("the stored Space is kept only while the user still belongs to it", () => {
  assert.equal(chooseActiveSpace([personal, org], "org-1")?.id, "org-1");
  assert.equal(chooseActiveSpace([personal, org], "removed-space")?.id, "personal:u1");
  assert.equal(chooseActiveSpace([personal, org], null)?.id, "personal:u1");
  assert.equal(chooseActiveSpace([], "org-1"), null);
});

test("only owners and admins see team management", () => {
  assert.equal(canManageTeams("owner"), true);
  assert.equal(canManageTeams("admin"), true);
  assert.equal(canManageTeams("member"), false);
  assert.equal(canManageTeams("viewer"), false);
  assert.equal(canManageTeams(null), false);
});
