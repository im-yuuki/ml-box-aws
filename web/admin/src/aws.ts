import { ACMClient, DescribeCertificateCommand, ListCertificatesCommand } from "@aws-sdk/client-acm";
import { AdminDisableUserCommand, AdminEnableUserCommand, AdminGetUserCommand, AdminUserGlobalSignOutCommand, CognitoIdentityProviderClient, DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import { DescribeInstancesCommand, DescribeInstanceTypesCommand, DescribeNatGatewaysCommand, DescribeSubnetsCommand, EC2Client } from "@aws-sdk/client-ec2";
import { DescribeFileSystemsCommand, EFSClient } from "@aws-sdk/client-efs";
import { DescribeAddonCommand, DescribeClusterCommand, EKSClient, ListAddonsCommand } from "@aws-sdk/client-eks";
import { DescribeLoadBalancersCommand, DescribeTargetGroupsCommand, DescribeTargetHealthCommand, ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeDBInstancesCommand, RDSClient } from "@aws-sdk/client-rds";
import { ListHostedZonesByNameCommand, ListResourceRecordSetsCommand, Route53Client } from "@aws-sdk/client-route-53";
import { ListBucketsCommand, S3Client } from "@aws-sdk/client-s3";
import { GetServiceQuotaCommand, ServiceQuotasClient } from "@aws-sdk/client-service-quotas";

import type { CognitoAdmin } from "./actions.js";
import { quotaFamily, type QuotaUsage } from "./capacity.js";
import type { AdminConfig } from "./config.js";

export type Status = "ok" | "warn" | "error" | "info";

export type Resource = {
  id: string;
  name: string;
  kind: string;
  status: Status;
  statusText: string;
  details: [string, string][];
};

export type Layer = "edge" | "network" | "compute" | "data";

/**
 * Layer ids. The console translates the titles by id; `title` is the English fallback.
 *
 * Resource details are `[key, value]` pairs where `key` is a stable identifier that the console turns into a label in the
 * language of the operator (an unknown key is shown as it is). A key may carry a parameter after a colon, as in
 * `targetGroup:dashtg-dev:3000`. Values are language-neutral: AWS state words, numbers, or `yes`/`no`.
 */
export const LAYERS: { id: Layer; title: string }[] = [
  { id: "edge", title: "Edge: DNS, certificates, load balancer" },
  { id: "network", title: "Network" },
  { id: "compute", title: "Cluster and machines" },
  { id: "data", title: "Data and identity" },
];

const ownedBy = (config: AdminConfig, name: string | undefined): boolean => Boolean(name && name.startsWith(config.projectPrefix));

export function minutesSince(iso: Date | string | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? Math.floor((now - time) / 60000) : null;
}

export function certificateStatus(status: string | undefined, notAfter: Date | undefined, now = Date.now()): { status: Status; text: string; daysLeft: number | null } {
  if (status !== "ISSUED") return { status: status === "PENDING_VALIDATION" ? "warn" : "error", text: status ?? "UNKNOWN", daysLeft: null };
  if (!notAfter) return { status: "ok", text: "ISSUED", daysLeft: null };
  const days = Math.floor((notAfter.getTime() - now) / 86400000);
  if (days < 0) return { status: "error", text: "EXPIRED", daysLeft: days };
  if (days < 30) return { status: "warn", text: "ISSUED", daysLeft: days };
  return { status: "ok", text: "ISSUED", daysLeft: days };
}

export function targetHealthStatus(states: string[]): { status: Status; text: string } {
  if (states.length === 0) return { status: "error", text: "no targets" };
  const healthy = states.filter((state) => state === "healthy").length;
  if (healthy === states.length) return { status: "ok", text: `${healthy}/${states.length} healthy` };
  return { status: healthy === 0 ? "error" : "warn", text: `${healthy}/${states.length} healthy` };
}

export class AwsInventory {
  private readonly eks: EKSClient;
  private readonly ec2: EC2Client;
  private readonly elb: ElasticLoadBalancingV2Client;
  private readonly rds: RDSClient;
  private readonly efs: EFSClient;
  private readonly s3: S3Client;
  private readonly route53: Route53Client;
  private readonly acm: ACMClient;
  private readonly cognito: CognitoIdentityProviderClient;
  private readonly costExplorer: CostExplorerClient;
  private readonly quotas: ServiceQuotasClient;
  private clusterPromise: ReturnType<AwsInventory["fetchCluster"]> | null = null;

  constructor(private readonly config: AdminConfig) {
    const region = config.region;
    this.eks = new EKSClient({ region });
    this.ec2 = new EC2Client({ region });
    this.elb = new ElasticLoadBalancingV2Client({ region });
    this.rds = new RDSClient({ region });
    this.efs = new EFSClient({ region });
    this.s3 = new S3Client({ region });
    this.route53 = new Route53Client({ region: "us-east-1" });
    this.acm = new ACMClient({ region });
    this.cognito = new CognitoIdentityProviderClient({ region });
    // Cost Explorer is served from us-east-1 only.
    this.costExplorer = new CostExplorerClient({ region: "us-east-1" });
    this.quotas = new ServiceQuotasClient({ region });
  }

  private async fetchCluster() {
    const response = await this.eks.send(new DescribeClusterCommand({ name: this.config.clusterName }));
    if (!response.cluster) throw new Error(`Cluster ${this.config.clusterName} not found`);
    return response.cluster;
  }

  /** The cluster is the anchor for the VPC and the node tags, so it is fetched once per process start and retried on failure. */
  private cluster() {
    if (!this.clusterPromise) {
      this.clusterPromise = this.fetchCluster().catch((error) => {
        this.clusterPromise = null;
        throw error;
      });
    }
    return this.clusterPromise;
  }

  async compute(): Promise<Resource[]> {
    const cluster = await this.cluster();
    const addonNames = (await this.eks.send(new ListAddonsCommand({ clusterName: this.config.clusterName }))).addons ?? [];
    const addons = await Promise.all(
      addonNames.map(async (addonName) => {
        const { addon } = await this.eks.send(new DescribeAddonCommand({ clusterName: this.config.clusterName, addonName }));
        return `${addonName} ${addon?.addonVersion ?? "?"} (${addon?.status ?? "?"})`;
      }),
    );
    const resources: Resource[] = [
      {
        id: cluster.arn ?? this.config.clusterName,
        name: this.config.clusterName,
        kind: "EKS cluster",
        status: cluster.status === "ACTIVE" ? "ok" : "warn",
        statusText: cluster.status ?? "UNKNOWN",
        details: [
          ["kubernetesVersion", cluster.version ?? "?"],
          ["publicEndpoint", cluster.resourcesVpcConfig?.endpointPublicAccess ? "yes" : "no"],
          ["addons", addons.join(", ") || "—"],
          ["createdAt", cluster.createdAt?.toISOString() ?? "?"],
        ],
      },
    ];
    const instances = await this.ec2.send(
      new DescribeInstancesCommand({
        Filters: [
          { Name: "tag:aws:eks:cluster-name", Values: [this.config.clusterName] },
          { Name: "instance-state-name", Values: ["pending", "running", "stopping", "stopped"] },
        ],
      }),
    );
    const karpenter = await this.ec2.send(
      new DescribeInstancesCommand({
        Filters: [
          { Name: "tag:eks:eks-cluster-name", Values: [this.config.clusterName] },
          { Name: "instance-state-name", Values: ["pending", "running", "stopping", "stopped"] },
        ],
      }),
    );
    const seen = new Set<string>();
    for (const reservation of [...(instances.Reservations ?? []), ...(karpenter.Reservations ?? [])]) {
      for (const instance of reservation.Instances ?? []) {
        if (!instance.InstanceId || seen.has(instance.InstanceId)) continue;
        seen.add(instance.InstanceId);
        const tag = (key: string) => instance.Tags?.find((item) => item.Key === key)?.Value;
        const state = instance.State?.Name ?? "unknown";
        resources.push({
          id: instance.InstanceId,
          name: tag("Name") ?? instance.InstanceId,
          kind: "EC2 instance",
          status: state === "running" ? "ok" : "warn",
          statusText: state,
          details: [
            ["instanceType", instance.InstanceType ?? "?"],
            ["lifecycle", instance.InstanceLifecycle === "spot" ? "Spot" : "On-Demand"],
            ["nodePool", tag("karpenter.sh/nodepool") ?? tag("eks:nodegroup-name") ?? "managed node group"],
            ["zone", instance.Placement?.AvailabilityZone ?? "?"],
            ["uptimeHours", String(Math.floor((minutesSince(instance.LaunchTime) ?? 0) / 60))],
          ],
        });
      }
    }
    return resources;
  }

  async network(): Promise<Resource[]> {
    const cluster = await this.cluster();
    const vpcId = cluster.resourcesVpcConfig?.vpcId;
    if (!vpcId) return [];
    const [subnets, nats] = await Promise.all([
      this.ec2.send(new DescribeSubnetsCommand({ Filters: [{ Name: "vpc-id", Values: [vpcId] }] })),
      this.ec2.send(new DescribeNatGatewaysCommand({ Filter: [{ Name: "vpc-id", Values: [vpcId] }, { Name: "state", Values: ["available", "pending"] }] })),
    ]);
    const zones = new Set((subnets.Subnets ?? []).map((subnet) => subnet.AvailabilityZone));
    const publicCount = (subnets.Subnets ?? []).filter((subnet) => subnet.MapPublicIpOnLaunch).length;
    const resources: Resource[] = [
      {
        id: vpcId,
        name: vpcId,
        kind: "VPC",
        status: "ok",
        statusText: "available",
        details: [
          ["subnets", `${subnets.Subnets?.length ?? 0} (${publicCount} public)`],
          ["zones", [...zones].filter(Boolean).sort().join(", ")],
        ],
      },
    ];
    for (const nat of nats.NatGateways ?? []) {
      resources.push({
        id: nat.NatGatewayId ?? "nat",
        name: nat.NatGatewayId ?? "nat",
        kind: "NAT gateway",
        status: nat.State === "available" ? "ok" : "warn",
        statusText: nat.State ?? "unknown",
        details: [["subnet", nat.SubnetId ?? "?"]],
      });
    }
    return resources;
  }

  async edge(): Promise<Resource[]> {
    const cluster = await this.cluster();
    const vpcId = cluster.resourcesVpcConfig?.vpcId;
    const resources: Resource[] = [];

    const balancers = (await this.elb.send(new DescribeLoadBalancersCommand({}))).LoadBalancers ?? [];
    for (const balancer of balancers.filter((item) => item.VpcId === vpcId)) {
      const groups = balancer.LoadBalancerArn
        ? (await this.elb.send(new DescribeTargetGroupsCommand({ LoadBalancerArn: balancer.LoadBalancerArn }))).TargetGroups ?? []
        : [];
      const groupSummaries = await Promise.all(
        groups.map(async (group) => {
          const health = await this.elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn }));
          const summary = targetHealthStatus((health.TargetHealthDescriptions ?? []).map((item) => item.TargetHealth?.State ?? "unknown"));
          return { name: group.TargetGroupName ?? "?", port: group.Port, ...summary };
        }),
      );
      const worst: Status = groupSummaries.some((group) => group.status === "error") ? "error" : groupSummaries.some((group) => group.status === "warn") ? "warn" : "ok";
      resources.push({
        id: balancer.LoadBalancerArn ?? "alb",
        name: balancer.LoadBalancerName ?? "alb",
        kind: `Load balancer (${balancer.Type ?? "?"})`,
        status: balancer.State?.Code === "active" ? worst : "warn",
        statusText: balancer.State?.Code ?? "unknown",
        details: [
          ["dns", balancer.DNSName ?? "?"],
          ["scheme", balancer.Scheme ?? "?"],
          ...groupSummaries.map((group): [string, string] => [`targetGroup:${group.name}:${group.port ?? "?"}`, group.text]),
        ],
      });
    }

    const certificates = (await this.acm.send(new ListCertificatesCommand({}))).CertificateSummaryList ?? [];
    for (const summary of certificates) {
      if (!summary.DomainName || !summary.CertificateArn) continue;
      if (this.config.domain && !summary.DomainName.endsWith(this.config.domain)) continue;
      const { Certificate: certificate } = await this.acm.send(new DescribeCertificateCommand({ CertificateArn: summary.CertificateArn }));
      const state = certificateStatus(certificate?.Status, certificate?.NotAfter);
      resources.push({
        id: summary.CertificateArn,
        name: summary.DomainName,
        kind: "ACM certificate",
        status: state.status,
        statusText: state.text,
        details: [
          ...(state.daysLeft === null ? [] : [["daysLeft", String(state.daysLeft)] as [string, string]]),
          ["usedBy", String(certificate?.InUseBy?.length ?? 0)],
          ["renewal", certificate?.RenewalEligibility ?? "?"],
        ],
      });
    }

    if (this.config.domain) {
      const zones = (await this.route53.send(new ListHostedZonesByNameCommand({ DNSName: this.config.domain, MaxItems: 1 }))).HostedZones ?? [];
      const zone = zones.find((item) => item.Name?.replace(/\.$/, "") === this.config.domain);
      if (zone?.Id) {
        const records = (await this.route53.send(new ListResourceRecordSetsCommand({ HostedZoneId: zone.Id }))).ResourceRecordSets ?? [];
        const routed = records.filter((record) => ["A", "AAAA", "CNAME"].includes(record.Type ?? "") && !record.Name?.startsWith("_"));
        resources.push({
          id: zone.Id,
          name: this.config.domain,
          kind: "Route 53 zone",
          status: "ok",
          statusText: `${zone.ResourceRecordSetCount ?? records.length} records`,
          details: routed.map((record): [string, string] => [
            `record:${record.Type} ${record.Name?.replace(/\.$/, "")}`,
            record.AliasTarget?.DNSName?.replace(/\.$/, "") ?? record.ResourceRecords?.map((item) => item.Value).join(", ") ?? "?",
          ]),
        });
      }
    }
    return resources;
  }

  async data(): Promise<Resource[]> {
    const cluster = await this.cluster();
    const vpcId = cluster.resourcesVpcConfig?.vpcId;
    const resources: Resource[] = [];

    const databases = (await this.rds.send(new DescribeDBInstancesCommand({}))).DBInstances ?? [];
    for (const database of databases.filter((item) => item.DBSubnetGroup?.VpcId === vpcId)) {
      resources.push({
        id: database.DBInstanceIdentifier ?? "rds",
        name: database.DBInstanceIdentifier ?? "rds",
        kind: "RDS PostgreSQL",
        status: database.DBInstanceStatus === "available" ? "ok" : "warn",
        statusText: database.DBInstanceStatus ?? "unknown",
        details: [
          ["engine", `${database.Engine ?? "?"} ${database.EngineVersion ?? ""}`.trim()],
          ["instanceClass", database.DBInstanceClass ?? "?"],
          ["storage", `${database.AllocatedStorage ?? "?"} GB`],
          ["multiAz", database.MultiAZ ? "yes" : "no"],
          ["encrypted", database.StorageEncrypted ? "yes" : "no"],
        ],
      });
    }

    const filesystems = (await this.efs.send(new DescribeFileSystemsCommand({}))).FileSystems ?? [];
    for (const filesystem of filesystems.filter((item) => ownedBy(this.config, item.Name) || item.Tags?.some((tag) => tag.Key === "Project" && tag.Value === this.config.projectPrefix))) {
      resources.push({
        id: filesystem.FileSystemId ?? "efs",
        name: filesystem.Name ?? filesystem.FileSystemId ?? "efs",
        kind: "EFS",
        status: filesystem.LifeCycleState === "available" ? "ok" : "warn",
        statusText: filesystem.LifeCycleState ?? "unknown",
        details: [
          ["stored", `${((filesystem.SizeInBytes?.Value ?? 0) / 1024 ** 3).toFixed(2)} GB`],
          ["mountTargets", String(filesystem.NumberOfMountTargets ?? 0)],
          ["encrypted", filesystem.Encrypted ? "yes" : "no"],
        ],
      });
    }

    const buckets = (await this.s3.send(new ListBucketsCommand({}))).Buckets ?? [];
    for (const bucket of buckets.filter((item) => ownedBy(this.config, item.Name))) {
      resources.push({
        id: bucket.Name ?? "s3",
        name: bucket.Name ?? "s3",
        kind: bucket.Name?.includes("tfstate") ? "S3 (Terraform state)" : "S3",
        status: "ok",
        statusText: "available",
        details: [["createdAt", bucket.CreationDate?.toISOString() ?? "?"]],
      });
    }

    if (this.config.cognitoUserPoolId) {
      const { UserPool: pool } = await this.cognito.send(new DescribeUserPoolCommand({ UserPoolId: this.config.cognitoUserPoolId }));
      resources.push({
        id: this.config.cognitoUserPoolId,
        name: pool?.Name ?? this.config.cognitoUserPoolId,
        kind: "Cognito user pool",
        status: "ok",
        statusText: pool?.Status ?? "ACTIVE",
        details: [
          ["users", String(pool?.EstimatedNumberOfUsers ?? "?")],
          ["mfa", pool?.MfaConfiguration ?? "OFF"],
        ],
      });
    }
    return resources;
  }

  /**
   * EC2 vCPU quotas against what is running in the account. A node that cannot start because a quota is full looks like
   * a capacity problem, so this is the first thing to read when a GPU notebook does not come up.
   */
  async vcpuQuotas(): Promise<QuotaUsage[]> {
    const definitions = [
      { code: "L-DB2E81BA", family: "gvt", lifecycle: "on-demand" },
      { code: "L-3819A6DF", family: "gvt", lifecycle: "spot" },
      { code: "L-1216C47A", family: "standard", lifecycle: "on-demand" },
      { code: "L-34B43A08", family: "standard", lifecycle: "spot" },
    ] as const;

    const running = await this.ec2.send(new DescribeInstancesCommand({ Filters: [{ Name: "instance-state-name", Values: ["pending", "running"] }] }));
    const instances = (running.Reservations ?? []).flatMap((reservation) => reservation.Instances ?? []);
    const types = [...new Set(instances.map((instance) => instance.InstanceType).filter((type): type is NonNullable<typeof type> => Boolean(type)))];
    const vcpus = new Map<string, number>();
    for (let index = 0; index < types.length; index += 100) {
      const page = await this.ec2.send(new DescribeInstanceTypesCommand({ InstanceTypes: types.slice(index, index + 100) }));
      for (const item of page.InstanceTypes ?? []) if (item.InstanceType) vcpus.set(item.InstanceType, item.VCpuInfo?.DefaultVCpus ?? 0);
    }

    return Promise.all(
      definitions.map(async (definition) => {
        const used = instances
          .filter((instance) => instance.InstanceType && quotaFamily(instance.InstanceType) === definition.family && (instance.InstanceLifecycle === "spot") === (definition.lifecycle === "spot"))
          .reduce((sum, instance) => sum + (vcpus.get(instance.InstanceType as string) ?? 0), 0);
        let limit: number | null = null;
        try {
          limit = (await this.quotas.send(new GetServiceQuotaCommand({ ServiceCode: "ec2", QuotaCode: definition.code }))).Quota?.Value ?? null;
        } catch {
          limit = null;
        }
        return { code: definition.code, family: definition.family, lifecycle: definition.lifecycle, limit, used };
      }),
    );
  }

  /** The Cognito calls the account actions need, or null when no user pool is configured. */
  cognitoAdmin(): CognitoAdmin | null {
    const poolId = this.config.cognitoUserPoolId;
    if (!poolId) return null;
    return {
      disable: async (username) => void (await this.cognito.send(new AdminDisableUserCommand({ UserPoolId: poolId, Username: username }))),
      enable: async (username) => void (await this.cognito.send(new AdminEnableUserCommand({ UserPoolId: poolId, Username: username }))),
      signOut: async (username) => void (await this.cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: poolId, Username: username }))),
    };
  }

  /** The Cognito state of a user: a disabled account cannot sign in. The Cognito username of a user is the id the BFF stores. */
  async cognitoUserState(username: string): Promise<{ enabled: boolean; status: string } | null> {
    if (!this.config.cognitoUserPoolId) return null;
    const user = await this.cognito.send(new AdminGetUserCommand({ UserPoolId: this.config.cognitoUserPoolId, Username: username }));
    return { enabled: user.Enabled !== false, status: user.UserStatus ?? "UNKNOWN" };
  }

  async cost() {
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86400000);
    const day = (date: Date) => date.toISOString().slice(0, 10);
    const response = await this.costExplorer.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: day(start), End: day(end) },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
      }),
    );
    const byService = new Map<string, number>();
    const daily: { date: string; amount: number }[] = [];
    for (const period of response.ResultsByTime ?? []) {
      let total = 0;
      for (const group of period.Groups ?? []) {
        const amount = Number(group.Metrics?.UnblendedCost?.Amount ?? 0);
        total += amount;
        const name = group.Keys?.[0] ?? "Other";
        byService.set(name, (byService.get(name) ?? 0) + amount);
      }
      daily.push({ date: period.TimePeriod?.Start ?? "", amount: Math.round(total * 100) / 100 });
    }
    const services = [...byService.entries()]
      .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
      .filter((item) => item.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    return {
      currency: response.ResultsByTime?.[0]?.Groups?.[0]?.Metrics?.UnblendedCost?.Unit ?? "USD",
      total: Math.round(services.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
      services: services.slice(0, 12),
      daily,
      period: { start: day(start), end: day(end) },
    };
  }
}
