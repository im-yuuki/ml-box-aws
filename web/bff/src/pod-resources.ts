import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { parseCpuCores, parseMemoryGb } from "./usage.js";

// Reads the resource requests/limits of a user's notebook pods from the Kubernetes API.
// JupyterHub's user record does not carry resource figures, so the footprint needs the pod spec.
// The hub's modify_pod_hook labels each pod with the safe username ("user"), and Z2JH labels
// named servers with "hub.jupyter.org/servername" (absent for the default server).

const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";

export type PodResources = { cpuCores: number | null; ramGb: number | null };

type PodLike = {
  metadata?: { labels?: Record<string, string> };
  spec?: { containers?: Array<{ resources?: { limits?: Record<string, unknown>; requests?: Record<string, unknown> } }> };
};

export function safeLabelValue(name: string): string {
  // Mirrors the notebook hook's _label_safe_username: [A-Za-z0-9._-], trimmed, max 63 characters.
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  return (safe.slice(0, 63)) || "anonymous";
}

export function podResources(pod: PodLike): PodResources {
  const container = pod.spec?.containers?.[0];
  const source = container?.resources?.limits ?? container?.resources?.requests ?? {};
  return {
    cpuCores: parseCpuCores(source.cpu),
    ramGb: parseMemoryGb(source.memory),
  };
}

export function resourcesByServer(pods: PodLike[]): Map<string, PodResources> {
  const byServer = new Map<string, PodResources>();
  for (const pod of pods) {
    const server = pod.metadata?.labels?.["hub.jupyter.org/servername"] ?? "";
    byServer.set(server || "default", podResources(pod));
  }
  return byServer;
}

export async function listSingleuserPods(username: string): Promise<PodLike[]> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  if (!host) throw new Error("Kubernetes API is not configured");
  const token = readFileSync(`${SA_DIR}/token`, "utf8").trim();
  const ca = readFileSync(`${SA_DIR}/ca.crt`);
  const selector = encodeURIComponent(`component=singleuser-server,user=${safeLabelValue(username)}`);
  const path = `/api/v1/namespaces/hub/pods?labelSelector=${selector}`;
  return new Promise<PodLike[]>((resolve, reject) => {
    const req = httpsRequest({ host, port: Number(port), path, method: "GET", ca, headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout: 5000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if ((res.statusCode ?? 500) >= 300) return reject(new Error(`Kubernetes API returned ${res.statusCode}`));
        try {
          resolve((JSON.parse(body) as { items?: PodLike[] }).items ?? []);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Kubernetes API timeout")));
    req.on("error", reject);
    req.end();
  });
}
