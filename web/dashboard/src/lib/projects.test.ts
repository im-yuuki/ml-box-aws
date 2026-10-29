import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyProjectResponse,
  filterProjects,
  resolveProject,
  validateProjectName,
  type ProjectRecord,
} from "./projects.ts";

const projects: ProjectRecord[] = [
  { id: "project-a", name: "Vision Lab", teamName: "Research" },
  { id: "project-b", name: "Forecasting", teamName: "Platform" },
  { id: "project-c", name: "Personal Sandbox" },
];

test("filterProjects matches names and team names without mutating input", () => {
  assert.deepEqual(filterProjects(projects, "vision"), [projects[0]]);
  assert.deepEqual(filterProjects(projects, "PLATFORM"), [projects[1]]);
  assert.deepEqual(filterProjects(projects, ""), projects);
  assert.deepEqual(projects, [
    { id: "project-a", name: "Vision Lab", teamName: "Research" },
    { id: "project-b", name: "Forecasting", teamName: "Platform" },
    { id: "project-c", name: "Personal Sandbox" },
  ]);
});

test("resolveProject only returns an exact match from the authorized list", () => {
  assert.deepEqual(resolveProject(projects, "project-b"), projects[1]);
  assert.equal(resolveProject(projects, "project"), null);
  assert.equal(resolveProject(projects, "missing"), null);
  assert.equal(resolveProject(projects, ""), null);
});

test("validateProjectName rejects whitespace and trims accepted names", () => {
  assert.deepEqual(validateProjectName("  "), { ok: false });
  assert.deepEqual(validateProjectName("  Vision Lab  "), { ok: true, value: "Vision Lab" });
});

test("classifyProjectResponse distinguishes authentication and availability states", () => {
  assert.equal(classifyProjectResponse(200), "ready");
  assert.equal(classifyProjectResponse(401), "unauthenticated");
  assert.equal(classifyProjectResponse(403), "unauthorized");
  assert.equal(classifyProjectResponse(500), "unavailable");
  assert.equal(classifyProjectResponse(503), "unavailable");
});
