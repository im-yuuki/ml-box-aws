import { readFileSync } from "node:fs";
import { Pool } from "pg";

export type UsageSample = {
  sampledAt: string;
  runningServers: number;
  cpuCoresAllocated: number | null;
  ramGbAllocated: number | null;
};

export class UsageStore {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: { ca: readFileSync("/etc/ssl/certs/rds-ca-bundle.pem", "utf8"), rejectUnauthorized: true },
      max: 3,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30_000,
    });
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS mlbox_usage_samples (
      user_id text NOT NULL, sampled_at timestamptz NOT NULL,
      running_servers integer NOT NULL, cpu_cores double precision, ram_gb double precision,
      PRIMARY KEY (user_id, sampled_at))`);
  }

  async sample(userId: string, sample: Omit<UsageSample, "sampledAt">): Promise<void> {
    await this.pool.query(`INSERT INTO mlbox_usage_samples (user_id, sampled_at, running_servers, cpu_cores, ram_gb)
      SELECT $1, date_trunc('hour', now()), $2, $3, $4
      WHERE NOT EXISTS (SELECT 1 FROM mlbox_usage_samples WHERE user_id = $1 AND sampled_at >= date_trunc('hour', now()))
      ON CONFLICT (user_id, sampled_at) DO NOTHING`, [userId, sample.runningServers, sample.cpuCoresAllocated, sample.ramGbAllocated]);
  }

  async history(userId: string, limit: number): Promise<UsageSample[]> {
    const result = await this.pool.query(`SELECT sampled_at, running_servers, cpu_cores, ram_gb
      FROM mlbox_usage_samples WHERE user_id = $1 ORDER BY sampled_at DESC LIMIT $2`, [userId, limit]);
    return result.rows.map((row) => ({ sampledAt: new Date(row.sampled_at).toISOString(), runningServers: Number(row.running_servers), cpuCoresAllocated: row.cpu_cores === null ? null : Number(row.cpu_cores), ramGbAllocated: row.ram_gb === null ? null : Number(row.ram_gb) }));
  }

  async close(): Promise<void> { await this.pool.end(); }
}
