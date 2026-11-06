import { NextResponse, type NextRequest } from "next/server";

type MockProject = {
  id: string;
  spaceId: string;
  teamId: string;
  teamName: string;
  name: string;
};

type MockTeam = {
  id: string;
  spaceId: string;
  name: string;
};

type MockMember = {
  userId: string;
  role: "lead" | "member";
  email?: string;
};

const PERSONAL_SPACE = "personal:demo-user";
const ORGANIZATION_SPACE = "org:demo-lab";
const DEMO_EMAIL = "demo@mlbox.local";

const spaces = [
  { id: PERSONAL_SPACE, type: "personal", name: "Demo's Space", role: "owner" },
  { id: ORGANIZATION_SPACE, type: "organization", name: "Demo Lab", role: "admin" },
] as const;

const projects: MockProject[] = [
  { id: "project-vision", spaceId: PERSONAL_SPACE, teamId: "team-personal", teamName: "Personal team", name: "Vision experiments" },
  { id: "project-llm", spaceId: PERSONAL_SPACE, teamId: "team-personal", teamName: "Personal team", name: "LLM fine-tuning" },
  { id: "project-shared", spaceId: ORGANIZATION_SPACE, teamId: "team-ml", teamName: "ML team", name: "Shared model lab" },
];

const teams: MockTeam[] = [
  { id: "team-personal", spaceId: PERSONAL_SPACE, name: "Personal team" },
  { id: "team-ml", spaceId: ORGANIZATION_SPACE, name: "ML team" },
  { id: "team-research", spaceId: ORGANIZATION_SPACE, name: "Research" },
];

const members = new Map<string, MockMember[]>([
  ["team-ml", [{ userId: "demo-user", email: DEMO_EMAIL, role: "lead" }, { userId: "alex", email: "alex@mlbox.local", role: "member" }]],
  ["team-research", [{ userId: "demo-user", email: DEMO_EMAIL, role: "lead" }]],
]);

const runtimeState = new Map<string, "ready" | "stopped">([
  ["project-vision", "ready"],
  ["project-llm", "stopped"],
  ["project-shared", "stopped"],
]);

const artifacts = new Map<string, Array<Record<string, unknown>>>([
  ["project-vision", [{ id: "artifact-readme", projectId: "project-vision", name: "README.md", contentType: "text/markdown", sizeBytes: 1842, status: "ready", createdBy: "demo-user" }]],
]);

const plans = [
  { id: "personal_free", spaceType: "personal", name: "Personal Free", amountCents: 0, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 1, storageGb: 5, cpuHours: 10, gpuHours: 0 } },
  { id: "personal_plus", spaceType: "personal", name: "Personal Plus", amountCents: 800, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 5, storageGb: 25, cpuHours: 50, gpuHours: 0 } },
  { id: "personal_pro", spaceType: "personal", name: "Personal Pro", amountCents: 1900, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 20, storageGb: 100, cpuHours: 200, gpuHours: 0 } },
  { id: "org_team", spaceType: "organization", name: "Organization Team", amountCents: 1900, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 10, storageGb: 100, cpuHours: 300, gpuHours: 0, members: 3 } },
  { id: "org_growth", spaceType: "organization", name: "Organization Growth", amountCents: 800, currency: "USD", billingInterval: "month", status: "active", quotas: { projects: 50, storageGb: 500, cpuHours: 1000, gpuHours: 0, members: null } },
  { id: "personal_power", spaceType: "personal", name: "Personal Power", amountCents: 3900, currency: "USD", billingInterval: "month", status: "coming_soon", quotas: { projects: null, storageGb: null, cpuHours: null, gpuHours: null } },
];

const payments: Array<Record<string, unknown>> = [
  { id: "payment-demo", spaceId: PERSONAL_SPACE, planId: "personal_plus", subscriptionId: "subscription-demo", amountCents: 800, currency: "USD", paymentMethod: "mock_card", status: "failed", failureCode: "mock_declined", createdAt: "2026-11-06T10:00:00.000Z" },
];

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function pathParts(path: string) {
  return path.split("?")[0].split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
}

async function readBody(body: string | undefined): Promise<Record<string, unknown>> {
  if (!body) return {};
  try {
    const value: unknown = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

function projectFor(id: string) {
  return projects.find((project) => project.id === id);
}

function projectResponse(project: MockProject) {
  const state = runtimeState.get(project.id) ?? "stopped";
  return { projectId: project.id, canOperate: true, sandbox: { name: `${project.id}-runtime`, state, url: state === "ready" ? `http://localhost:8888/user/demo/${project.id}` : null } };
}

function usageResponse() {
  return {
    generatedAt: "2026-11-07T10:00:00.000Z",
    historyAvailable: true,
    history: [
      { sampledAt: "2026-11-05T10:00:00.000Z", runningServers: 1, cpuCoresAllocated: 2, ramGbAllocated: 4 },
      { sampledAt: "2026-11-06T10:00:00.000Z", runningServers: 1, cpuCoresAllocated: 2, ramGbAllocated: 4 },
      { sampledAt: "2026-11-07T10:00:00.000Z", runningServers: 1, cpuCoresAllocated: 2, ramGbAllocated: 4 },
    ],
    quota: {
      cpuHours: { limit: 50, unit: "cpu-hours", usage: null, tracking: "not-tracked" },
      ramGb: { limit: 16, unit: "GB", usage: 4, tracking: "allocated-footprint" },
      storageGb: { limit: 25, unit: "GB", usage: null, tracking: "not-available" },
      gpuHours: { limit: 0, unit: "gpu-hours", usage: null, tracking: "disabled" },
    },
    footprint: {
      runningServers: 1,
      pendingServers: 0,
      cpuCoresAllocated: 2,
      ramGbAllocated: 4,
      servers: [{ name: "project-vision-runtime", state: "running", url: "http://localhost:8888/user/demo/project-vision", lastActivity: "2026-11-07T09:45:00.000Z", cpuCoresAllocated: 2, ramGbAllocated: 4 }],
    },
  };
}

export async function mockBff(request: NextRequest, path: string, method: string, body?: string) {
  const parts = pathParts(path);
  const input = await readBody(body);
  const verb = method.toUpperCase();

  if (parts[0] !== "v1") return response({ error: "MOCK_NOT_FOUND", message: "Mock endpoint not found." }, 404);

  if (parts[1] === "auth") {
    if (parts[2] === "csrf" && verb === "GET") return response({ csrfToken: "mock-csrf-token" }, 200, { "set-cookie": "mlbox-csrf=mock-csrf-token; Path=/; SameSite=Lax" });
    if (parts[2] === "session" && verb === "GET") return response({ user: { email: DEMO_EMAIL } });
    if (["login", "register", "confirm", "resend-confirmation", "forgot-password", "reset-password", "change-password", "refresh"].includes(parts[2] ?? "")) return response({ ok: true, user: { email: DEMO_EMAIL } });
    if (parts[2] === "logout") return response({ ok: true }, 200, { "set-cookie": "mlbox-session=; Max-Age=0; Path=/; SameSite=Lax" });
  }

  if (parts[1] === "spaces" && parts.length === 2 && verb === "GET") return response({ spaces });

  if (parts[1] === "projects") {
    const projectId = parts[2];
    if (!projectId && verb === "GET") {
      const query = new URL(request.url).searchParams;
      const spaceId = query.get("spaceId") ?? PERSONAL_SPACE;
      return response({ spaceId, projects: projects.filter((project) => project.spaceId === spaceId) });
    }
    if (!projectId && verb === "POST") {
      const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : "Untitled project";
      const spaceId = typeof input.spaceId === "string" ? input.spaceId : PERSONAL_SPACE;
      const team = teams.find((item) => item.spaceId === spaceId) ?? teams[0];
      const project = { id: `project-${projects.length + 1}`, spaceId, teamId: typeof input.teamId === "string" ? input.teamId : team.id, teamName: team.name, name };
      projects.push(project);
      runtimeState.set(project.id, "stopped");
      return response({ project }, 201);
    }
    if (projectId && parts[3] === "usage" && verb === "GET") return response({ projectId, usage: { hours: 3.5, sessions: 4, openSession: runtimeState.get(projectId) === "ready", windowDays: 30 }, note: "Demo data" });
    if (projectId && parts[3] === "sandbox") {
      if (parts[4] === "profiles" && verb === "GET") return response({ projectId, profiles: [
        { slug: "cpu-small", label: "CPU Small", description: "2 vCPU · 4 GB RAM", kind: "cpu", cpuCores: 2, ramGb: 4, gpu: null, available: true },
        { slug: "cpu-medium", label: "CPU Medium", description: "4 vCPU · 8 GB RAM", kind: "cpu", cpuCores: 4, ramGb: 8, gpu: null, available: true },
      ] });
      if (parts[4] === "start" && verb === "POST") { runtimeState.set(projectId, "ready"); return response({ ok: true, projectId, state: "ready" }); }
      if (parts[4] === "stop" && verb === "POST") { runtimeState.set(projectId, "stopped"); return response({ ok: true, projectId, state: "stopped" }); }
      if (verb === "GET") return response(projectResponse(projectFor(projectId) ?? { id: projectId, spaceId: PERSONAL_SPACE, teamId: "team-personal", teamName: "Personal team", name: projectId }));
    }
    if (projectId && parts[3] === "artifacts") {
      const list = artifacts.get(projectId) ?? [];
      if (parts.length === 4 && verb === "GET") return response({ projectId, canOperate: true, artifacts: list });
      if (parts.length === 4 && verb === "POST") {
        const artifact = { id: `artifact-${list.length + 1}`, projectId, name: typeof input.name === "string" ? input.name : "upload.bin", contentType: typeof input.contentType === "string" ? input.contentType : "application/octet-stream", sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : 1, status: "ready", createdBy: "demo-user" };
        list.push(artifact); artifacts.set(projectId, list);
        return response({ artifact, upload: { url: new URL("/api/mock-upload", request.url).toString(), method: "PUT", headers: { "content-type": artifact.contentType } } }, 201);
      }
      if (parts[5] === "complete" && verb === "POST") return response({ ok: true });
      if (parts[5] === "download" && verb === "GET") return response({ url: "data:text/plain;charset=utf-8,ML%20Box%20demo%20artifact" });
    }
  }

  if (parts[1] === "spaces" && parts[2] && parts[3] === "teams") {
    const spaceId = parts[2];
    const teamId = parts[4];
    if (!teamId && verb === "GET") return response({ spaceId, teams: teams.filter((team) => team.spaceId === spaceId) });
    if (!teamId && verb === "POST") { const team = { id: `team-${teams.length + 1}`, spaceId, name: typeof input.name === "string" ? input.name : "New team" }; teams.push(team); members.set(team.id, []); return response({ team }, 201); }
    if (teamId && parts[5] === "members") {
      const list = members.get(teamId) ?? [];
      if (!parts[6] && verb === "GET") return response({ teamId, members: list });
      if (!parts[6] && verb === "POST") { list.push({ userId: typeof input.userId === "string" ? input.userId : "new-member", role: input.role === "lead" ? "lead" : "member" }); members.set(teamId, list); return response({ ok: true }, 201); }
      if (parts[6] && verb === "DELETE") { members.set(teamId, list.filter((member) => member.userId !== parts[6])); return response({ ok: true }); }
    }
  }

  if (parts[1] === "spaces" && parts[2] && parts[3] === "invitations") {
    if (!parts[4] && verb === "GET") return response({ spaceId: parts[2], invitations: [] });
    if (!parts[4] && verb === "POST") {
      return response({ invitation: { id: `invitation-${Date.now()}`, email: String(input.email ?? DEMO_EMAIL), role: input.role === "admin" || input.role === "viewer" ? input.role : "member", status: "pending" } }, 201);
    }
    if (parts[4] && verb === "DELETE") return response({ ok: true });
  }

  if (parts[1] === "invitations") {
    if (parts.length === 2 && verb === "GET") return response({ invitations: [] });
    if (parts[3] === "accept" && verb === "POST") return response({ ok: true });
  }

  if (parts[1] === "usage" && verb === "GET") return response(usageResponse());

  if (parts[1] === "subscriptions" && parts[2] === "plans" && verb === "GET") {
    const type = new URL(request.url).searchParams.get("spaceType");
    return response({ plans: plans.filter((plan) => !type || plan.spaceType === type) });
  }
  if (parts[1] === "subscription" && parts[2] === "cancel" && verb === "POST") {
    return response({ subscription: { spaceId: PERSONAL_SPACE, plan: "Personal Free", status: "cancelled", provider: "mock" } });
  }
  if (parts[1] === "subscription" && !parts[2]) {
    if (verb === "GET") return response({ spaceId: PERSONAL_SPACE, spaceType: "personal", subscription: { spaceId: PERSONAL_SPACE, plan: "Personal Free", status: "active", provider: "mock", paymentId: null, currentPeriodEnd: "2026-12-07T00:00:00.000Z" }, entitlements: [{ resource: "projects", limitValue: 1, sourcePlan: "personal_free" }, { resource: "storage_gb", limitValue: 5, sourcePlan: "personal_free" }, { resource: "cpu_hours", limitValue: 10, sourcePlan: "personal_free" }, { resource: "gpu_hours", limitValue: 0, sourcePlan: "personal_free" }] });
  }
  if (parts[1] === "payments" && verb === "GET") return response({ spaceId: PERSONAL_SPACE, payments });
  if (parts[1] === "subscriptions" && parts[2] === "mock" && parts[3] === "checkout" && verb === "POST") return response({ payment: null, subscription: { spaceId: PERSONAL_SPACE, plan: String(input.planId ?? "Demo plan"), status: input.mockOutcome === "succeeded" ? "active" : "past_due", provider: "mock" }, entitlements: [] });
  if (parts[1] === "payments" && parts[2] === "mock" && parts[4] === "retry" && verb === "POST") return response({ payment: { id: parts[3], status: input.mockOutcome ?? "succeeded" }, subscription: { spaceId: PERSONAL_SPACE, plan: "Personal Plus", status: input.mockOutcome === "succeeded" ? "active" : "past_due", provider: "mock" }, entitlements: [] });

  return response({ error: "MOCK_NOT_FOUND", message: `No mock response for ${verb} ${path}` }, 404);
}
