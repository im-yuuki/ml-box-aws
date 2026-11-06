import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactKeyPrefix,
  buildArtifactObjectKey,
  sanitizeArtifactName,
  validateArtifactSize,
  ARTIFACT_MAX_BYTES,
} from "./artifacts.js";

test("artifact file names are reduced to a safe basename", () => {
  assert.equal(sanitizeArtifactName("  report.csv "), "report.csv");
  assert.equal(sanitizeArtifactName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeArtifactName("C:\\data\\model v2.bin"), "model_v2.bin");
  assert.equal(sanitizeArtifactName("..hidden"), "hidden");
  assert.equal(sanitizeArtifactName("   "), null);
  assert.equal(sanitizeArtifactName("x".repeat(121)), null);
});

test("artifact object keys stay under the Space and Project prefix", () => {
  const key = buildArtifactObjectKey("personal-u1", "proj-1", "art-1", "../notes.md");
  assert.equal(key, "spaces/personal-u1/projects/proj-1/artifacts/art-1/notes.md");
  assert.ok(key.startsWith(artifactKeyPrefix("personal-u1", "proj-1")));
});

test("artifact keys reject identifiers that could escape the prefix", () => {
  assert.throws(() => buildArtifactObjectKey("s1", "../p2", "a1", "f.txt"), /Invalid identifier/);
  assert.throws(() => buildArtifactObjectKey("s1", "p2", "a/1", "f.txt"), /Invalid identifier/);
  assert.throws(() => artifactKeyPrefix("s 1", "p2"), /Invalid identifier/);
});

test("artifact sizes must be positive safe integers within the limit", () => {
  assert.equal(validateArtifactSize(1024), 1024);
  assert.equal(validateArtifactSize(0), null);
  assert.equal(validateArtifactSize(-1), null);
  assert.equal(validateArtifactSize(1.5), null);
  assert.equal(validateArtifactSize("10"), null);
  assert.equal(validateArtifactSize(ARTIFACT_MAX_BYTES + 1), null);
});

test("personal Space ids with a type prefix produce valid artifact keys", () => {
  const spaceId = "personal:d9ce4478-00c1-70ae-b4d5-f90a34e3ed0a";
  const key = buildArtifactObjectKey(spaceId, "5fabd252-b6be-4216-93ea-32512370087b", "a-1", "e2e-note.txt");
  assert.equal(key, "spaces/personal:d9ce4478-00c1-70ae-b4d5-f90a34e3ed0a/projects/5fabd252-b6be-4216-93ea-32512370087b/artifacts/a-1/e2e-note.txt");
  assert.throws(() => buildArtifactObjectKey("personal:../x", "p1", "a1", "f.txt"), /Invalid identifier/);
  assert.throws(() => buildArtifactObjectKey("personal:a/b", "p1", "a1", "f.txt"), /Invalid identifier/);
});
