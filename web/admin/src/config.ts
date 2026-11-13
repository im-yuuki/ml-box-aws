export type HealthTarget = { name: string; url: string };

export type AdminConfig = {
  port: number;
  host: string;
  username: string;
  passwordHash: string;
  sessionSecret: string;
  sessionTtlSeconds: number;
  secureCookies: boolean;
  region: string;
  clusterName: string;
  /** Prefix that every resource of the project carries in its name, used to filter AWS listings. */
  projectPrefix: string;
  domain: string;
  cognitoUserPoolId: string | null;
  databaseUrl: string | null;
  databaseCaPath: string | null;
  costExplorerEnabled: boolean;
  /** Changes (stop a sandbox, lock an account, change a plan) are refused unless this is on. Off by default. */
  actionsEnabled: boolean;
  hubUrl: string | null;
  hubApiToken: string | null;
  healthTargets: HealthTarget[];
};

/** "name=url;name=url" -> list. Entries without a valid http(s) URL are dropped. */
export function parseHealthTargets(raw: string | undefined): HealthTarget[] {
  if (!raw) return [];
  const targets: HealthTarget[] = [];
  for (const entry of raw.split(";")) {
    const index = entry.indexOf("=");
    if (index <= 0) continue;
    const name = entry.slice(0, index).trim();
    const url = entry.slice(index + 1).trim();
    if (name && /^https?:\/\//.test(url)) targets.push({ name, url });
  }
  return targets;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const missing = ["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "ADMIN_SESSION_SECRET"].filter((key) => !env[key]);
  if (missing.length > 0) throw new Error(`Missing required environment: ${missing.join(", ")}`);
  const sessionSecret = env.ADMIN_SESSION_SECRET as string;
  if (sessionSecret.length < 32) throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters");
  return {
    port: Number(env.PORT ?? 5000),
    host: env.HOST ?? "0.0.0.0",
    username: env.ADMIN_USERNAME as string,
    passwordHash: env.ADMIN_PASSWORD_HASH as string,
    sessionSecret,
    sessionTtlSeconds: Number(env.ADMIN_SESSION_TTL_SECONDS ?? 8 * 60 * 60),
    secureCookies: (env.SECURE_COOKIES ?? "true") !== "false",
    region: env.AWS_REGION ?? "ap-southeast-2",
    clusterName: env.CLUSTER_NAME ?? "jhub-gpu-sandbox-dev-apse2",
    projectPrefix: env.PROJECT_PREFIX ?? "jhub-gpu-sandbox",
    domain: env.DOMAIN ?? "",
    cognitoUserPoolId: env.COGNITO_USER_POOL_ID || null,
    databaseUrl: env.APP_DATABASE_URL || null,
    databaseCaPath: env.DATABASE_CA_PATH || null,
    costExplorerEnabled: env.ENABLE_COST_EXPLORER === "true",
    actionsEnabled: env.ADMIN_ACTIONS_ENABLED === "true",
    hubUrl: env.HUB_URL || null,
    hubApiToken: env.HUB_API_TOKEN || null,
    healthTargets: parseHealthTargets(env.HEALTH_TARGETS),
  };
}
