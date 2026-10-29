export type SandboxLifecycleState = "ready" | "starting" | "stopped" | "failed";

type SandboxLike = { state: SandboxLifecycleState };

export const SANDBOX_REFRESH_INTERVAL_MS = 3000;
export const MAX_STARTING_REFRESHES = 20;

export function getSandboxLifecycleView(state: SandboxLifecycleState): {
  label: "stateReady" | "stateStarting" | "stateStopped" | "stateFailed";
  action: "open" | "start" | "restart" | "none";
  canStop: boolean;
  disabled: boolean;
} {
  switch (state) {
    case "ready":
      return { label: "stateReady", action: "open", canStop: true, disabled: false };
    case "starting":
      return { label: "stateStarting", action: "none", canStop: false, disabled: true };
    case "stopped":
      return { label: "stateStopped", action: "start", canStop: false, disabled: false };
    case "failed":
      return { label: "stateFailed", action: "restart", canStop: false, disabled: false };
  }
}

export function hasStartingSandbox(sandboxes: readonly SandboxLike[]): boolean {
  return sandboxes.some((sandbox) => sandbox.state === "starting");
}
