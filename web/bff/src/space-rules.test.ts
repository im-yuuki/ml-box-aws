import assert from "node:assert/strict";
import test from "node:test";
import {
  canChangeMemberRole,
  canDeleteOrganization,
  canManageMembers,
  canRemoveMember,
  canTransferOwnership,
  deleteConfirmationMatches,
  validateOrganizationName,
} from "./space-rules.js";

test("owners and admins manage members; members and viewers do not", () => {
  assert.equal(canManageMembers("owner"), true);
  assert.equal(canManageMembers("admin"), true);
  assert.equal(canManageMembers("member"), false);
  assert.equal(canManageMembers("viewer"), false);
  assert.equal(canManageMembers(null), false);
});

test("owner sets any non-owner role; admin manages member and viewer roles only", () => {
  assert.equal(canChangeMemberRole("owner", "member", "admin"), true);
  assert.equal(canChangeMemberRole("owner", "admin", "viewer"), true);
  assert.equal(canChangeMemberRole("admin", "member", "viewer"), true);
  assert.equal(canChangeMemberRole("admin", "member", "admin"), false);
  assert.equal(canChangeMemberRole("admin", "admin", "member"), false);
  assert.equal(canChangeMemberRole("member", "viewer", "member"), false);
});

test("the owner role is never changed by a role update", () => {
  assert.equal(canChangeMemberRole("owner", "owner", "admin"), false);
  assert.equal(canChangeMemberRole("owner", "member", "owner"), false);
});

test("removal: owner is never removed; admins remove members and viewers, not admins", () => {
  assert.equal(canRemoveMember("owner", "owner"), false);
  assert.equal(canRemoveMember("owner", "admin"), true);
  assert.equal(canRemoveMember("admin", "admin"), false);
  assert.equal(canRemoveMember("admin", "viewer"), true);
  assert.equal(canRemoveMember("member", "viewer"), false);
});

test("ownership goes from the owner to an admin only", () => {
  assert.equal(canTransferOwnership("owner", "admin"), true);
  assert.equal(canTransferOwnership("owner", "member"), false);
  assert.equal(canTransferOwnership("owner", "owner"), false);
  assert.equal(canTransferOwnership("admin", "admin"), false);
});

test("only the owner can delete the organization", () => {
  assert.equal(canDeleteOrganization("owner"), true);
  assert.equal(canDeleteOrganization("admin"), false);
  assert.equal(canDeleteOrganization(null), false);
});

test("delete confirmation requires the exact organization name", () => {
  assert.equal(deleteConfirmationMatches("Acme", " Acme "), true);
  assert.equal(deleteConfirmationMatches("Acme", "acme"), false);
  assert.equal(deleteConfirmationMatches("Acme", undefined), false);
});

test("organization names are trimmed and bounded", () => {
  assert.deepEqual(validateOrganizationName("  Acme  "), { ok: true, value: "Acme" });
  assert.equal(validateOrganizationName("   ").ok, false);
  assert.equal(validateOrganizationName("x".repeat(61)).ok, false);
  assert.equal(validateOrganizationName(42).ok, false);
});
