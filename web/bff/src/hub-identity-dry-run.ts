import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AppStore } from "./app-store.js";
import type { HubIdentityMigrationReport } from "./hub-identity-migration.js";

type DryRunStore = {
  planHubIdentityMigration: () => Promise<HubIdentityMigrationReport>;
  close: () => Promise<void>;
};

type Output = {
  write: (chunk: string) => boolean;
};

export type HubIdentityDryRunOptions = {
  env?: NodeJS.ProcessEnv;
  createStore?: (connectionString: string) => DryRunStore;
  stdout?: Output;
  stderr?: Output;
};

export async function runHubIdentityDryRun({
  env = process.env,
  createStore = (connectionString) => new AppStore(connectionString),
  stdout = process.stdout,
  stderr = process.stderr,
}: HubIdentityDryRunOptions = {}): Promise<number> {
  const connectionString = env.APP_DATABASE_URL ?? env.DATABASE_URL;
  if (!connectionString) {
    stderr.write("APP_DATABASE_URL or DATABASE_URL is required\n");
    return 1;
  }

  let store: DryRunStore | undefined;
  try {
    store = createStore(connectionString);
    const report = await store.planHubIdentityMigration();
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.canApply ? 0 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Hub identity dry-run failed: ${message}\n`);
    return 1;
  } finally {
    await store?.close();
  }
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  runHubIdentityDryRun().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
