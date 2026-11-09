import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

// Notebook storage is one claim per Project. The Hub names it from the server name, which is the
// Project id (see stacks/03-hub-app hub-values: pvcNameTemplate "mlbox-{servername}").
const SA_DIR = "/var/run/secrets/kubernetes.io/serviceaccount";
const HUB_NAMESPACE = "hub";

export function projectClaimName(projectId: string): string | null {
  // Kubernetes names must be lowercase DNS labels; project ids are lowercase UUIDs.
  if (!/^[a-z0-9][a-z0-9-]{0,50}$/.test(projectId)) return null;
  return `mlbox-${projectId}`;
}

// Deletes the Project's storage claim. A claim that was never created (the sandbox never started) is not an error.
// The EFS CSI driver then removes the access point and its directory (deleteAccessPointRootDir).
export async function deleteProjectClaim(projectId: string): Promise<void> {
  const name = projectClaimName(projectId);
  if (!name) throw new Error("Invalid project id for storage claim");
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
  if (!host) throw new Error("Kubernetes API is not configured");
  const token = readFileSync(`${SA_DIR}/token`, "utf8").trim();
  const ca = readFileSync(`${SA_DIR}/ca.crt`);
  const path = `/api/v1/namespaces/${HUB_NAMESPACE}/persistentvolumeclaims/${name}`;
  return new Promise<void>((resolve, reject) => {
    const req = httpsRequest({ host, port: Number(port), path, method: "DELETE", ca, headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeout: 10000 }, (res) => {
      res.resume();
      res.on("end", () => {
        const status = res.statusCode ?? 500;
        if (status === 404 || (status >= 200 && status < 300)) return resolve();
        reject(new Error(`Kubernetes API returned ${status} deleting ${name}`));
      });
    });
    req.on("timeout", () => req.destroy(new Error("Kubernetes API timeout")));
    req.on("error", reject);
    req.end();
  });
}
