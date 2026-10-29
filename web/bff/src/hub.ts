export type HubError = Error & { status?: number };

export function sandboxPath(username: string, name: string): string {
  const serverName = name === "default" ? "" : /^[a-z0-9][a-z0-9-]{0,62}$/i.test(name) ? encodeURIComponent(name) : null;
  if (serverName === null) throw new Error("Invalid sandbox name");
  return `/hub/api/users/${encodeURIComponent(username)}/servers/${serverName}`;
}

export type HubRequest = (method: string, path: string, body?: unknown) => Promise<{ status: number }>;


export type HubUserProvisioningResult = {
  created: boolean;
};

export async function ensureHubUser(username: string, request: HubRequest): Promise<HubUserProvisioningResult> {
  const userPath = `/hub/api/users/${encodeURIComponent(username)}`;
  try {
    await request("GET", userPath, undefined);
    return { created: false };
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
    if (status !== 404) throw error;
  }

  try {
    await request("POST", userPath, {});
    return { created: true };
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
    if (status === 409) return { created: false };
    throw error;
  }
}

export type HubStartResult = { status: number };
export type HubStartFlow = {
  userExists: boolean;
  ensureUser: () => Promise<void>;
  start: () => Promise<HubStartResult>;
};

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : null;
}

export async function startHubSandbox(flow: HubStartFlow): Promise<HubStartResult> {
  const userWasMissing = !flow.userExists;
  if (userWasMissing) await flow.ensureUser();
  try {
    return await flow.start();
  } catch (error) {
    if (errorStatus(error) !== 404 || !userWasMissing) throw error;
    return flow.start();
  }
}

function publicHubOrigin(publicBase: string): string {
  const base = new URL(publicBase);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) {
    throw new Error("Invalid Hub public URL");
  }
  return base.origin;
}

export function sandboxUrl(publicBase: string, username: string, name: string): string {
  if (name !== "default" && !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(name)) {
    throw new Error("Invalid sandbox name");
  }
  const server = name === "default" ? "" : `${encodeURIComponent(name)}/`;
  return `${publicHubOrigin(publicBase)}/user/${encodeURIComponent(username)}/${server}`;
}

export function hubActivationUrl(publicBase: string): string {
  return `${publicHubOrigin(publicBase)}/hub/login`;
}

export type HubActivationState = {
  userExists: boolean;
  activationRequired: boolean;
  activationUrl: string;
};

export function hubActivationState(publicBase: string, userExists: boolean): HubActivationState {
  return {
    userExists,
    activationRequired: !userExists,
    activationUrl: hubActivationUrl(publicBase),
  };
}

export function hubFailure(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof Error && error.message === "Invalid sandbox name") {
    return { status: 400, code: "INVALID_SANDBOX_NAME", message: "Tên sandbox không hợp lệ." };
  }
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : null;
  if (status !== null && Number.isFinite(status) && status >= 400 && status < 500) {
    if (status === 404) return { status, code: "SANDBOX_NOT_FOUND", message: "Không tìm thấy sandbox." };
    if (status === 401 || status === 403) return { status: 403, code: "FORBIDDEN", message: "Bạn không có quyền thực hiện thao tác này." };
    if (status === 409) return { status, code: "SANDBOX_CONFLICT", message: "Sandbox đang ở trạng thái không thể thực hiện thao tác này." };
    if (status === 429) return { status, code: "QUOTA_EXCEEDED", message: "Đã vượt quá giới hạn sử dụng." };
    return { status, code: "BAD_REQUEST", message: "JupyterHub không chấp nhận yêu cầu này." };
  }
  if (status !== null && Number.isFinite(status) && status >= 500) {
    return { status: 502, code: "HUB_UNAVAILABLE", message: "JupyterHub đang gặp sự cố. Vui lòng thử lại sau." };
  }
  return { status: 504, code: "HUB_TIMEOUT", message: "JupyterHub không phản hồi kịp thời." };
}
