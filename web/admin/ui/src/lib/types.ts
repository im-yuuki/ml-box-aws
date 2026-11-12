// Shapes returned by the console backend (web/admin/src/*). Kept by hand: the backend is a separate package.

export type Section<T> = { ok: true; data: T; fetchedAt: string } | { ok: false; error: string; fetchedAt: string };

export type Status = "ok" | "warn" | "error" | "info";

export type SessionInfo = {
  authenticated: boolean;
  user: string | null;
  features: { database: boolean; costExplorer: boolean; domain: string; cluster: string; region: string };
};

export type HealthResult = { name: string; url: string; ok: boolean; status: number | null; latencyMs: number | null; error?: string };

export type NodeSummary = {
  name: string;
  ready: boolean;
  instanceType: string | null;
  nodePool: string | null;
  capacityType: string | null;
  zone: string | null;
  kubelet: string | null;
  gpu: number;
};

export type PodProblem = { namespace: string; name: string; phase: string; reason: string; restarts: number; node: string | null };
export type EventSummary = { namespace: string; object: string; reason: string; message: string; count: number; at: string | null };

export type ClusterSnapshot = {
  nodes: NodeSummary[];
  podCount: number;
  podPhases: Record<string, number>;
  problems: PodProblem[];
  events: EventSummary[];
};

export type DbOverview = {
  users: number;
  spaces: number;
  organizationSpaces: number;
  projects: number;
  sandboxesByState: Record<string, number>;
  openSessions: number;
  plans: Record<string, number>;
  unitsThisMonth: number;
};

export type Overview = { health: Section<HealthResult[]>; cluster: Section<ClusterSnapshot>; summary: Section<DbOverview> };

export type SandboxRow = {
  id: string;
  profile: string | null;
  state: string;
  hub_username: string;
  project_name: string;
  deleted_at: string | null;
  space_name: string;
  space_type: "personal" | "organization";
  owner_email: string;
  session_started_at: string | null;
  units_per_hour: string | null;
};

export type OpenSession = { id: string; started_at: string; units_per_hour: string; project_name: string; space_name: string; started_by: string; age_seconds: string };
export type SandboxesResponse = { sandboxes: Section<SandboxRow[]>; sessions: Section<OpenSession[]> };

export type UserSpace = { space_id: string; space_name: string; space_type: "personal" | "organization"; role: string; status: string; plan: string | null; plan_status: string | null; projects: string; units_this_month: number };
export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_seen_at: string | null;
  active_logins: string;
  hub_username: string | null;
  hub_identity_status: string | null;
  spaces: UserSpace[];
};

export type AuditEvent = { id: string; created_at: string; action: string; target: string; actor_email: string; space_name: string };
export type AdminAction = { at: string; ip: string; action: string; detail?: string };
export type AuditResponse = { events: Section<AuditEvent[]>; actions: Section<{ action: string; count: number }[]>; adminActions: AdminAction[] };

export type Workload = { namespace: string; name: string; kind: string; desired: number; ready: number; images: string[] };
export type VolumeClaim = { namespace: string; name: string; phase: string; size: string | null; storageClass: string | null };
export type DeploymentsResponse = { workloads: Section<Workload[]>; volumes: Section<VolumeClaim[]> };

export type AwsResource = { id: string; name: string; kind: string; status: Status; statusText: string; details: [string, string][] };
export type AwsResponse = { region: string; cluster: string; layers: { id: "edge" | "network" | "compute" | "data"; title: string; section: Section<AwsResource[]> }[] };

export type CostResponse = {
  currency: string;
  total: number;
  services: { name: string; amount: number }[];
  daily: { date: string; amount: number }[];
  period: { start: string; end: string };
};
