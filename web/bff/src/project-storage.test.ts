import assert from "node:assert/strict";
import test from "node:test";
import { claimsOfProject, projectClaimName } from "./project-storage.js";

test("project storage claim is named after the Project id, the same name the Hub uses", () => {
  assert.equal(projectClaimName("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"), "mlbox-3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f");
});

test("ids that are not lowercase DNS labels never produce a claim name", () => {
  assert.equal(projectClaimName("../secrets"), null);
  assert.equal(projectClaimName("Upper-Case"), null);
  assert.equal(projectClaimName(""), null);
});

test("the claim of a Project is found by the annotation of the Hub, not by its name", () => {
  // kubespawner 7 names the claim "mlbox-x-<server>---<hash>", so the name says nothing about
  // the Project it belongs to.
  const claims = [
    { name: "mlbox-x-3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f---87ff134b", serverName: "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f" },
    { name: "mlbox-x-11111111-2222-3333-4444-555555555555---aaaaaaaa", serverName: "11111111-2222-3333-4444-555555555555" },
    { name: "mlbox-unrelated", serverName: null },
  ];
  assert.deepEqual(claimsOfProject(claims, "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"), [
    "mlbox-x-3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f---87ff134b",
  ]);
});

test("the legacy claim that is named after the Project id is deleted as well", () => {
  const claims = [
    { name: "mlbox-b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0", serverName: "b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0" },
  ];
  assert.deepEqual(claimsOfProject(claims, "b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0"), [
    "mlbox-b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0",
  ]);
  // The name alone is enough for the legacy claim, even without the annotation.
  const withoutAnnotation = [{ name: "mlbox-b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0", serverName: null }];
  assert.deepEqual(claimsOfProject(withoutAnnotation, "b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0"), [
    "mlbox-b2d1bb61-46ba-4a5f-9c80-45e5e57c95f0",
  ]);
});

test("a Project without a claim has nothing to delete", () => {
  const claims = [{ name: "mlbox-x-11111111-2222-3333-4444-555555555555---aaaaaaaa", serverName: "11111111-2222-3333-4444-555555555555" }];
  assert.deepEqual(claimsOfProject(claims, "3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"), []);
});
