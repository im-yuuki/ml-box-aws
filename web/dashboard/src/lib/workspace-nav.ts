export type WorkspaceNavigationItem = {
  href: "/projects" | "/teams" | "/usage" | "/account";
  current: boolean;
};

// Sandboxes live inside a Project now; /sandboxes redirects to /projects (next.config.ts).
const destinations = ["/projects", "/teams", "/usage", "/account"] as const;

export const workspaceControls = {
  menuLabel: "workspace.menu",
  closeMenuLabel: "workspace.closeMenu",
  themeLabel: "workspace.toggleTheme",
  personalSpaceLabel: "workspace.personalSpace",
} as const;

export function getWorkspaceNavigation(pathname: string): WorkspaceNavigationItem[] {
  return destinations.map((href) => ({
    href,
    current: pathname === href || pathname.startsWith(`${href}/`),
  }));
}
