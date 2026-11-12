import { readFileSync } from "node:fs";
import https from "node:https";

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
  spec?: { nodeName?: string; containers?: { name: string; image: string }[] };
  status?: {
    phase?: string;
    reason?: string;
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

export async function loadVolumeClaims(): Promise<{ namespace: string; name: string; phase: string; size: string | null; storageClass: string | null }[]> {
  const list = await kubeGet<KubeList<{ metadata: Meta; spec?: { storageClassName?: string; resources?: { requests?: { storage?: string } } }; status?: { phase?: string } }>>("/api/v1/persistentvolumeclaims");
  return list.items.map((claim) => ({
    namespace: claim.metadata.namespace ?? "",
    name: claim.metadata.name,
    phase: claim.status?.phase ?? "Unknown",
    size: claim.spec?.resources?.requests?.storage ?? null,
    storageClass: claim.spec?.storageClassName ?? null,
  }));
}
