import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

// Notebook storage is one claim per Project. The Hub names it from the server name, which is the
// Project id (see stacks/03-hub-app hub-values: pvcNameTemplate "mlbox-{servername}").
const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const HUB_NAMESPACE = "hub";
// The Hub writes the server name into the annotation of the claim. The name of the claim itself
// changed with the Hub release (kubespawner 7 names it "mlbox-x-<server>---<hash>"), so the
// annotation is the only stable way to find the claim of a Project.
const SERVER_NAME_ANNOTATION = "hub.jupyter.org/servername";

export function projectClaimName(projectId: string): string | null {
  // Kubernetes names must be lowercase DNS labels; project ids are lowercase UUIDs.
  if (!/^[a-z0-9][a-z0-9-]{0,50}$/.test(projectId)) return null;
  return `mlbox-${projectId}`;
}

export type ProjectClaim = {
  name: string;
  // The server the claim belongs to; null when the claim carries no annotation.
  serverName: string | null;
};

/**
 * The claims that belong to a Project: the ones the Hub labelled with the Project id as its server
 * name, and the legacy claim that was named after the Project id.
 */
export function claimsOfProject(claims: ProjectClaim[], projectId: string): string[] {
  const legacy = projectClaimName(projectId);
  return claims
    .filter((claim) => claim.serverName === projectId || (legacy !== null && claim.name === legacy))
    .map((claim) => claim.name);
}

function clusterRequest<T>(method: string, path: string): Promise<{ status: number; body: T }> {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  if (!host) throw new Error("Kubernetes API is not configured");
  const token = readFileSync(`${SA_DIR}/token`, "utf8").trim();
  const ca = readFileSync(`${SA_DIR}/ca.crt`);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ host, port: Number(port), path, method, ca, headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout: 10000 }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        raw += chunk;
      });
      res.on("end", () => {
        const status = res.statusCode ?? 500;
        let body: unknown = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = null;
        }
        resolve({ status, body: body as T });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Kubernetes API timeout")));
    req.on("error", reject);
    req.end();
  });
}

function claimServerName(item: { metadata?: { annotations?: Record<string, string> } }): string | null {
  const value = item.metadata?.annotations?.[SERVER_NAME_ANNOTATION];
  return typeof value === "string" && value ? value : null;
}

/**
 * Deletes the notebook storage of a Project. The claims are found by the annotation of the Hub, not
 * by their name: the name of the claim is built by the Hub release and changed without notice.
 * A Project that never ran a sandbox has no claim, which is not an error. The EFS CSI driver
 * removes the access point and its directory with the claim (deleteAccessPointRootDir).
 */
export async function deleteProjectClaim(projectId: string): Promise<string[]> {
  if (!projectClaimName(projectId)) throw new Error("Invalid project id for storage claim");
  const list = await clusterRequest<{ items?: Array<{ metadata?: { name?: string; annotations?: Record<string, string> } }> }>(
    "GET",
    `/api/v1/namespaces/${HUB_NAMESPACE}/persistentvolumeclaims`,
  );
  if (list.status !== 200) throw new Error(`Kubernetes API returned ${list.status} listing claims`);
  const claims: ProjectClaim[] = (list.body?.items ?? [])
    .map((item) => ({ name: String(item.metadata?.name ?? ""), serverName: claimServerName(item) }))
    .filter((claim) => claim.name);
  const names = claimsOfProject(claims, projectId);
  for (const name of names) {
    const deleted = await clusterRequest("DELETE", `/api/v1/namespaces/${HUB_NAMESPACE}/persistentvolumeclaims/${name}`);
    // 404 means the claim was already gone.
    if (deleted.status !== 404 && (deleted.status < 200 || deleted.status >= 300)) {
      throw new Error(`Kubernetes API returned ${deleted.status} deleting ${name}`);
    }
  }
  return names;
}
