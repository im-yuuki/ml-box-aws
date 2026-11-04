import assert from "node:assert/strict";
import test from "node:test";

import {
  getWorkspaceNavigation,
  workspaceControls,
  type WorkspaceNavigationItem,
} from "./workspace-nav.ts";

test("workspace navigation exposes the four approved destinations", () => {
  const items = getWorkspaceNavigation("/projects/alpha");
  assert.deepEqual(items.map((item) => item.href), ["/projects", "/teams", "/usage", "/account"]);
  assert.equal(items.find((item) => item.href === "/projects")?.current, true);
  assert.equal(items.find((item) => item.href === "/teams")?.current, false);
});

test("navigation marks only the exact section current", () => {
  const items: WorkspaceNavigationItem[] = getWorkspaceNavigation("/teams/new");
  assert.equal(items.find((item) => item.href === "/teams")?.current, true);
  assert.equal(items.find((item) => item.href === "/projects")?.current, false);
});

test("workspace controls provide accessible labels without project fetching", () => {
  assert.deepEqual(workspaceControls, {
    menuLabel: "workspace.menu",
    closeMenuLabel: "workspace.closeMenu",
    themeLabel: "workspace.toggleTheme",
    personalSpaceLabel: "workspace.personalSpace",
  });
});
