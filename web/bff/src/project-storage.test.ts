import assert from "node:assert/strict";
import test from "node:test";
import { projectClaimName } from "./project-storage.js";

test("project storage claim is named after the Project id, the same name the Hub uses", () => {
  assert.equal(projectClaimName("3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f"), "mlbox-3f2a9c1e-7b4d-4e8a-9c0f-1a2b3c4d5e6f");
});

test("ids that are not lowercase DNS labels never produce a claim name", () => {
  assert.equal(projectClaimName("../secrets"), null);
  assert.equal(projectClaimName("Upper-Case"), null);
  assert.equal(projectClaimName(""), null);
});
