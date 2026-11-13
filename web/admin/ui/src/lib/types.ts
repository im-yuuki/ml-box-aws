// Shapes returned by the console backend (web/admin/src/*). Kept by hand: the backend is a separate package.

export type Section<T> = { ok: true; data: T; fetchedAt: string } | { ok: false; error: string; fetchedAt: string };

export type Status = "ok" | "warn" | "error" | "info";

export type SessionInfo = {
  authenticated: boolean;
  user: string | null;
  features: { database: boolean; actions: boolean; costExplorer: boolean; domain: string; cluster: string; region: string };
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
  project_id: string;
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

export type UserSpace = { alternatives: string[]; space_id: string; space_name: string; space_type: "personal" | "organization"; role: string; status: string; plan: string | null; plan_status: string | null; projects: string; units_this_month: number };
export type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  created_at: string;
  last_seen_at: string | null;
  active_logins: string;
  hub_username: string | null;
  hub_identity_status: string | null;
  cognito: { enabled: boolean; status: string } | null;
  spaces: UserSpace[];
};

export type AuditEvent = { id: string; created_at: string; action: string; target: string; actor_email: string; space_name: string };
export type AdminAction = { at: string; ip: string; action: string; detail?: string };
export type AdminChange = { id: string; created_at: string; ip: string; action: string; target: string; reason: string; outcome: "started" | "succeeded" | "failed"; detail: Record<string, unknown> };
export type AuditResponse = { events: Section<AuditEvent[]>; actions: Section<{ action: string; count: number }[]>; changes: Section<AdminChange[]>; adminActions: AdminAction[] };

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
  unitsLast30Days: number | null;
  computeCost: number | null;
  costPerUnit: number | null;
};

// ---- capacity

export type GpuNode = { name: string; instanceType: string | null; nodePool: string | null; zone: string | null; allocatable: number; requested: number; pods: { namespace: string; name: string; gpu: number }[] };
export type PendingPod = { namespace: string; name: string; reason: string; message: string; gpu: number; ageMinutes: number | null };
export type NodePoolCapacity = { name: string; ready: boolean | null; nodes: number | null; cpu: string | null; gpu: string | null; limits: { cpu: string | null; memory: string | null; gpu: string | null } };
export type NodeClaimSummary = { name: string; nodePool: string | null; instanceType: string | null; ready: boolean; stage: string; message: string; ageMinutes: number | null };
export type CapacitySnapshot = { gpuNodes: GpuNode[]; pending: PendingPod[]; nodePools: NodePoolCapacity[]; nodeClaims: NodeClaimSummary[] };
export type VcpuQuota = { code: string; family: "gvt" | "standard" | "other"; lifecycle: "on-demand" | "spot"; limit: number | null; used: number; level: "ok" | "warn" | "error" };
export type CapacityResponse = { capacity: Section<CapacitySnapshot>; quotas: Section<VcpuQuota[]> };

// ---- storage

export type ClaimStatus = "ok" | "deletedProject" | "unknownProject" | "unlabelled";
export type VolumeRow = { namespace: string; name: string; phase: string; size: string | null; storageClass: string | null; serverName: string | null; status: ClaimStatus; project: { name: string; spaceName: string; deleted: boolean } | null; sizeGiB: number | null };
export type StorageProjectRow = { project_id: string; project_name: string; project_deleted_at: string | null; space_id: string; space_name: string; ready_count: string; ready_bytes: string; pending_count: string; stuck_count: string };
export type StorageSpaceRow = { id: string; name: string; type: "personal" | "organization"; plan: string; bytes: number; limitGb: number | null };
export type StorageResponse = { volumes: Section<VolumeRow[]>; spaces: Section<StorageSpaceRow[]>; projects: Section<StorageProjectRow[]> };

// ---- billing

export type BillingSpace = {
  id: string;
  name: string;
  type: "personal" | "organization";
  plan: string | null;
  status: string | null;
  current_period_end: string | null;
  owner_email: string | null;
  units_this_month: number;
  effectivePlan: string;
  limit: number | null;
  alternatives: string[];
};
export type Payment = { id: string; created_at: string; plan_id: string; amount_cents: number; currency: string; status: string; payment_method: string; failure_code: string | null; space_name: string };
export type BillingResponse = { spaces: Section<BillingSpace[]>; payments: Section<Payment[]> };
