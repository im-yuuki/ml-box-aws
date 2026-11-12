import { readFileSync } from "node:fs";
import https from "node:https";

import { podGpuRequest, unschedulableReason, type VolumeClaimRow } from "./capacity.js";

const TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

export class KubeUnavailableError extends Error {
  constructor() {
    super("Not running inside a Kubernetes cluster");
    this.name = "KubeUnavailable";
  }
}

/** Minimal in-cluster read-only client. The ServiceAccount token is re-read on every call because it rotates. */
export async function kubeGet<T>(path: string): Promise<T> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  if (!host) throw new KubeUnavailableError();
  const token = readFileSync(TOKEN_PATH, "utf8").trim();
  const ca = readFileSync(CA_PATH);
  return new Promise<T>((resolve, reject) => {
    const request = https.request(
      { host, port: Number(port), path, method: "GET", ca, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, timeout: 8000 },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((response.statusCode ?? 500) >= 400) {
            reject(new Error(`Kubernetes API ${response.statusCode} for ${path}: ${text.slice(0, 160)}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(new Error(`Kubernetes API returned invalid JSON for ${path}`));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`Kubernetes API timeout for ${path}`)));
    request.on("error", reject);
    request.end();
  });
}

type KubeList<T> = { items: T[] };
type Meta = { name: string; namespace?: string; creationTimestamp?: string; labels?: Record<string, string> };

type RawNode = {
  metadata: Meta;
  spec?: { taints?: { key: string; effect: string }[] };
  status?: {
    conditions?: { type: string; status: string }[];
    allocatable?: Record<string, string>;
    nodeInfo?: { kubeletVersion?: string; osImage?: string };
  };
};

type RawPod = {
  metadata: Meta;
  spec?: { nodeName?: string; containers?: { name: string; image: string; resources?: { requests?: Record<string, string>; limits?: Record<string, string> } }[] };
  status?: {
    phase?: string;
    reason?: string;
    conditions?: { type: string; status: string; reason?: string; message?: string }[];
    containerStatuses?: { name: string; ready: boolean; restartCount: number; state?: { waiting?: { reason?: string }; terminated?: { reason?: string } } }[];
  };
};

type RawWorkload = {
  kind?: string;
  metadata: Meta;
  spec?: { replicas?: number; template?: { spec?: { containers?: { name: string; image: string }[] } } };
  status?: { readyReplicas?: number; availableReplicas?: number; desiredNumberScheduled?: number; numberReady?: number };
};

type RawEvent = {
  metadata: Meta;
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  lastTimestamp?: string;
  eventTime?: string;
  involvedObject?: { kind?: string; name?: string; namespace?: string };
};

export type NodeSummary = {
  name: string;
  ready: boolean;
  instanceType: string | null;
  nodePool: string | null;
  capacityType: string | null;
  zone: string | null;
  kubelet: string | null;
  gpu: number;
  taints: string[];
  createdAt: string | null;
};

export type PodProblem = { namespace: string; name: string; phase: string; reason: string; restarts: number; node: string | null };

export type DeploymentSummary = {
  namespace: string;
  name: string;
  kind: "Deployment" | "StatefulSet" | "DaemonSet";
  desired: number;
  ready: number;
  images: string[];
  createdAt: string | null;
};

export type EventSummary = { namespace: string; object: string; reason: string; message: string; count: number; at: string | null };

export type ClusterSnapshot = {
  nodes: NodeSummary[];
  podCount: number;
  podPhases: Record<string, number>;
  problems: PodProblem[];
  nodePools: { name: string; ready: boolean | null; nodes: number | null }[];
  events: EventSummary[];
};

const SYSTEM_NAMESPACES = new Set(["kube-system", "kube-public", "kube-node-lease"]);

export async function loadNodes(): Promise<NodeSummary[]> {
  const list = await kubeGet<KubeList<RawNode>>("/api/v1/nodes");
  return list.items.map((node) => {
    const labels = node.metadata.labels ?? {};
    const ready = node.status?.conditions?.find((condition) => condition.type === "Ready")?.status === "True";
    return {
      name: node.metadata.name,
      ready,
      instanceType: labels["node.kubernetes.io/instance-type"] ?? null,
      nodePool: labels["karpenter.sh/nodepool"] ?? labels["eks.amazonaws.com/nodegroup"] ?? null,
      capacityType: labels["karpenter.sh/capacity-type"] ?? labels["eks.amazonaws.com/capacityType"]?.toLowerCase() ?? null,
      zone: labels["topology.kubernetes.io/zone"] ?? null,
      kubelet: node.status?.nodeInfo?.kubeletVersion ?? null,
      gpu: Number(node.status?.allocatable?.["nvidia.com/gpu"] ?? 0),
      taints: (node.spec?.taints ?? []).map((taint) => `${taint.key}:${taint.effect}`),
      createdAt: node.metadata.creationTimestamp ?? null,
    };
  });
}

function podProblem(pod: RawPod): PodProblem | null {
  const phase = pod.status?.phase ?? "Unknown";
  const statuses = pod.status?.containerStatuses ?? [];
  const restarts = statuses.reduce((sum, status) => sum + status.restartCount, 0);
  const waiting = statuses.map((status) => status.state?.waiting?.reason).find((reason) => reason && reason !== "ContainerCreating");
  const failed = phase === "Failed" || phase === "Pending";
  if (!waiting && !failed && restarts < 5) return null;
  return {
    namespace: pod.metadata.namespace ?? "",
    name: pod.metadata.name,
    phase,
    reason: waiting ?? pod.status?.reason ?? (restarts >= 5 ? "Restarting" : phase),
    restarts,
    node: pod.spec?.nodeName ?? null,
  };
}

export async function loadCluster(): Promise<ClusterSnapshot> {
  const [nodes, pods, events, nodePools] = await Promise.all([
    loadNodes(),
    kubeGet<KubeList<RawPod>>("/api/v1/pods"),
    kubeGet<KubeList<RawEvent>>("/api/v1/events?fieldSelector=type%3DWarning&limit=200").catch(() => ({ items: [] as RawEvent[] })),
    kubeGet<KubeList<{ metadata: Meta; status?: { conditions?: { type: string; status: string }[]; resources?: { nodes?: string } } }>>("/apis/karpenter.sh/v1/nodepools").catch(() => null),
  ]);
  const podPhases: Record<string, number> = {};
  const problems: PodProblem[] = [];
  for (const pod of pods.items) {
    const phase = pod.status?.phase ?? "Unknown";
    podPhases[phase] = (podPhases[phase] ?? 0) + 1;
    const problem = podProblem(pod);
    if (problem) problems.push(problem);
  }
  const recent = events.items
    .map<EventSummary>((event) => ({
      namespace: event.metadata.namespace ?? "",
      object: `${event.involvedObject?.kind ?? ""}/${event.involvedObject?.name ?? ""}`,
      reason: event.reason ?? "",
      message: (event.message ?? "").slice(0, 240),
      count: event.count ?? 1,
      at: event.lastTimestamp ?? event.eventTime ?? event.metadata.creationTimestamp ?? null,
    }))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))
    .slice(0, 25);
  return {
    nodes,
    podCount: pods.items.length,
    podPhases,
    problems: problems.slice(0, 50),
    nodePools: (nodePools?.items ?? []).map((pool) => ({
      name: pool.metadata.name,
      ready: pool.status?.conditions?.find((condition) => condition.type === "Ready")?.status === "True" ? true : pool.status?.conditions ? false : null,
      nodes: pool.status?.resources?.nodes ? Number(pool.status.resources.nodes) : null,
    })),
    events: recent,
  };
}

export async function loadDeployments(): Promise<DeploymentSummary[]> {
  const [deployments, statefulSets, daemonSets] = await Promise.all([
    kubeGet<KubeList<RawWorkload>>("/apis/apps/v1/deployments"),
    kubeGet<KubeList<RawWorkload>>("/apis/apps/v1/statefulsets"),
    kubeGet<KubeList<RawWorkload>>("/apis/apps/v1/daemonsets"),
  ]);
  const summarize = (item: RawWorkload, kind: DeploymentSummary["kind"]): DeploymentSummary => ({
    namespace: item.metadata.namespace ?? "",
    name: item.metadata.name,
    kind,
    desired: kind === "DaemonSet" ? item.status?.desiredNumberScheduled ?? 0 : item.spec?.replicas ?? 0,
    ready: kind === "DaemonSet" ? item.status?.numberReady ?? 0 : item.status?.readyReplicas ?? 0,
    images: (item.spec?.template?.spec?.containers ?? []).map((container) => container.image),
    createdAt: item.metadata.creationTimestamp ?? null,
  });
  return [
    ...deployments.items.map((item) => summarize(item, "Deployment")),
    ...statefulSets.items.map((item) => summarize(item, "StatefulSet")),
    ...daemonSets.items.map((item) => summarize(item, "DaemonSet")),
  ].sort((a, b) => Number(SYSTEM_NAMESPACES.has(a.namespace)) - Number(SYSTEM_NAMESPACES.has(b.namespace)) || a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
}

export async function loadVolumeClaims(): Promise<VolumeClaimRow[]> {
  const list = await kubeGet<KubeList<{ metadata: Meta & { annotations?: Record<string, string> }; spec?: { storageClassName?: string; resources?: { requests?: { storage?: string } } }; status?: { phase?: string } }>>("/api/v1/persistentvolumeclaims");
  return list.items.map((claim) => ({
    namespace: claim.metadata.namespace ?? "",
    name: claim.metadata.name,
    phase: claim.status?.phase ?? "Unknown",
    size: claim.spec?.resources?.requests?.storage ?? null,
    storageClass: claim.spec?.storageClassName ?? null,
    // The Hub writes the Project id here; the name of the claim changed with the Hub release.
    serverName: claim.metadata.annotations?.["hub.jupyter.org/servername"] ?? null,
  }));
}

export type GpuNode = { name: string; instanceType: string | null; nodePool: string | null; zone: string | null; allocatable: number; requested: number; pods: { namespace: string; name: string; gpu: number }[] };
export type PendingPod = { namespace: string; name: string; reason: string; message: string; gpu: number; ageMinutes: number | null };
export type NodePoolCapacity = { name: string; ready: boolean | null; nodes: number | null; cpu: string | null; gpu: string | null; limits: { cpu: string | null; memory: string | null; gpu: string | null } };
export type NodeClaimSummary = { name: string; nodePool: string | null; instanceType: string | null; ready: boolean; stage: string; message: string; ageMinutes: number | null };
export type CapacitySnapshot = { gpuNodes: GpuNode[]; pending: PendingPod[]; nodePools: NodePoolCapacity[]; nodeClaims: NodeClaimSummary[] };

type RawNodePool = { metadata: Meta; spec?: { limits?: Record<string, string> }; status?: { conditions?: { type: string; status: string }[]; resources?: Record<string, string> } };
type RawNodeClaim = { metadata: Meta; status?: { conditions?: { type: string; status: string; reason?: string; message?: string }[] } };

const minutesAgo = (iso: string | undefined, now = Date.now()): number | null => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000)) : null);

/** What the cluster has to run notebooks on: GPUs per node against what pods hold, pods that wait, and what Karpenter is launching. */
export async function loadCapacity(): Promise<CapacitySnapshot> {
  const [nodes, pods, nodePools, nodeClaims] = await Promise.all([
    kubeGet<KubeList<RawNode>>("/api/v1/nodes"),
    kubeGet<KubeList<RawPod>>("/api/v1/pods"),
    kubeGet<KubeList<RawNodePool>>("/apis/karpenter.sh/v1/nodepools").catch(() => ({ items: [] as RawNodePool[] })),
    kubeGet<KubeList<RawNodeClaim>>("/apis/karpenter.sh/v1/nodeclaims").catch(() => ({ items: [] as RawNodeClaim[] })),
  ]);

  const gpuNodes: GpuNode[] = [];
  for (const node of nodes.items) {
    const allocatable = Number(node.status?.allocatable?.["nvidia.com/gpu"] ?? 0);
    if (!(allocatable > 0)) continue;
    const labels = node.metadata.labels ?? {};
    const held = pods.items
      .filter((pod) => pod.spec?.nodeName === node.metadata.name && pod.status?.phase !== "Succeeded" && pod.status?.phase !== "Failed")
      .map((pod) => ({ namespace: pod.metadata.namespace ?? "", name: pod.metadata.name, gpu: podGpuRequest(pod.spec?.containers) }))
      .filter((pod) => pod.gpu > 0);
    gpuNodes.push({
      name: node.metadata.name,
      instanceType: labels["node.kubernetes.io/instance-type"] ?? null,
      nodePool: labels["karpenter.sh/nodepool"] ?? null,
      zone: labels["topology.kubernetes.io/zone"] ?? null,
      allocatable,
      requested: held.reduce((sum, pod) => sum + pod.gpu, 0),
      pods: held,
    });
  }

  const pending: PendingPod[] = [];
  for (const pod of pods.items) {
    if (pod.status?.phase !== "Pending") continue;
    const reason = unschedulableReason(pod.status?.conditions);
    if (!reason) continue;
    pending.push({ namespace: pod.metadata.namespace ?? "", name: pod.metadata.name, ...reason, gpu: podGpuRequest(pod.spec?.containers), ageMinutes: minutesAgo(pod.metadata.creationTimestamp) });
  }

  return {
    gpuNodes,
    pending: pending.slice(0, 30),
    nodePools: nodePools.items.map((pool) => ({
      name: pool.metadata.name,
      ready: pool.status?.conditions?.find((condition) => condition.type === "Ready")?.status === "True" ? true : pool.status?.conditions ? false : null,
      nodes: pool.status?.resources?.nodes ? Number(pool.status.resources.nodes) : null,
      cpu: pool.status?.resources?.cpu ?? null,
      gpu: pool.status?.resources?.["nvidia.com/gpu"] ?? null,
      limits: { cpu: pool.spec?.limits?.cpu ?? null, memory: pool.spec?.limits?.memory ?? null, gpu: pool.spec?.limits?.["nvidia.com/gpu"] ?? null },
    })),
    nodeClaims: nodeClaims.items.map((claim) => {
      const conditions = claim.status?.conditions ?? [];
      const failing = conditions.find((condition) => condition.status !== "True" && condition.type !== "Ready");
      const ready = conditions.find((condition) => condition.type === "Ready")?.status === "True";
      return {
        name: claim.metadata.name,
        nodePool: claim.metadata.labels?.["karpenter.sh/nodepool"] ?? null,
        instanceType: claim.metadata.labels?.["node.kubernetes.io/instance-type"] ?? null,
        ready,
        stage: ready ? "Ready" : failing?.type ?? "Pending",
        message: (failing?.message ?? failing?.reason ?? "").slice(0, 240),
        ageMinutes: minutesAgo(claim.metadata.creationTimestamp),
      };
    }),
  };
}
