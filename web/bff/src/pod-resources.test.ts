import assert from "node:assert/strict";
import { test } from "node:test";
import { podResources, resourcesByServer, safeLabelValue } from "./pod-resources.js";

test("safe label value matches the notebook hook rules", () => {
  assert.equal(safeLabelValue("cognito-d9ce4478-00c1"), "cognito-d9ce4478-00c1");
  assert.equal(safeLabelValue("user@example.com"), "user-example.com");
  assert.equal(safeLabelValue("...."), "anonymous");
});

test("pod limits are read before requests, with cpu and memory units", () => {
  assert.deepEqual(
    podResources({ spec: { containers: [{ resources: { limits: { cpu: "2", memory: "4G" }, requests: { cpu: "500m", memory: "1G" } } }] } }),
    { cpuCores: 2, ramGb: 4 },
  );
  assert.deepEqual(
    podResources({ spec: { containers: [{ resources: { requests: { cpu: "500m", memory: "1Gi" } } }] } }),
    { cpuCores: 0.5, ramGb: 1 },
  );
  assert.deepEqual(podResources({ spec: { containers: [{}] } }), { cpuCores: null, ramGb: null });
});

test("servers are keyed by the Z2JH server label, with the default server as \"default\"", () => {
  const byServer = resourcesByServer([
    { metadata: { labels: { "hub.jupyter.org/servername": "" } }, spec: { containers: [{ resources: { limits: { cpu: "1", memory: "2G" } } }] } },
    { metadata: { labels: { "hub.jupyter.org/servername": "proj-1" } }, spec: { containers: [{ resources: { limits: { cpu: "4", memory: "16G" } } }] } },
  ]);
  assert.deepEqual(byServer.get("default"), { cpuCores: 1, ramGb: 2 });
  assert.deepEqual(byServer.get("proj-1"), { cpuCores: 4, ramGb: 16 });
});
