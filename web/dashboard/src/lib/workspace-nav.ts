export type WorkspaceNavigationItem = {
  href: "/projects" | "/sandboxes" | "/usage" | "/account";
  current: boolean;
};

const destinations = ["/projects", "/sandboxes", "/usage", "/account"] as const;

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
