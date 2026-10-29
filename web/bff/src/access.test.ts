import assert from "node:assert/strict";
import test from "node:test";
import { resolveProjectPermission } from "./access.js";

test("owner and admin retain project access despite a direct block", () => {
  assert.deepEqual(resolveProjectPermission({ spaceRole: "owner", directRole: "blocked" }), {
    role: "manager",
    canRead: true,
    canOperate: true,
    canManage: true,
  });
  assert.deepEqual(resolveProjectPermission({ spaceRole: "admin", directRole: "blocked" }), {
    role: "manager",
    canRead: true,
    canOperate: true,
    canManage: true,
  });
});

test("team membership grants project access and direct roles replace inheritance", () => {
  assert.equal(resolveProjectPermission({ teamRole: "lead" })?.role, "manager");
  assert.equal(resolveProjectPermission({ teamRole: "member" })?.role, "contributor");
  assert.equal(resolveProjectPermission({ teamRole: "lead", directRole: "viewer" })?.role, "viewer");
  assert.equal(resolveProjectPermission({ teamRole: "member", directRole: "manager" })?.role, "manager");
});

test("blocked and absent membership deny access by default", () => {
  assert.equal(resolveProjectPermission({ directRole: "blocked" }), null);
  assert.equal(resolveProjectPermission({}), null);
});

test("space viewers remain read-only even with stronger project access", () => {
  assert.deepEqual(resolveProjectPermission({ spaceRole: "viewer", teamRole: "lead" }), {
    role: "viewer",
    canRead: true,
    canOperate: false,
    canManage: false,
  });
  assert.deepEqual(resolveProjectPermission({ spaceRole: "viewer", directRole: "manager" }), {
    role: "viewer",
    canRead: true,
    canOperate: false,
    canManage: false,
  });
});
