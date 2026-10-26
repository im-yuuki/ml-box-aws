# ingress-dns: ALB + target group + Route53 aliases + LB controller

The ALB is created **here**, not by the hub's Kubernetes Ingress. Persistent DNS and ACM
resources are created by `00-bootstrap`; this module consumes their zone/certificate
outputs and owns only the current ALB, target group, security groups, load balancer
controller and ALB alias records. The hub service is attached to the target group later
from another stack through a `TargetGroupBinding`.

## What the module creates

| Resource | Notes |
|---|---|
| `aws_security_group.alb` | Internet-facing SG for the ALB |
| `aws_vpc_security_group_ingress_rule.alb_http` / `.alb_https` | 80 / 443 from `0.0.0.0/0` |
| `aws_vpc_security_group_egress_rule.alb_egress_proxy` | Egress to the EKS node SG on `proxy_port` |
| `aws_vpc_security_group_ingress_rule.node_proxy_ingress` | Ingress on the node SG from the ALB SG |
| `aws_lb.hub` | Public ALB, shared by notebook and dashboard host rules |
| `aws_lb_target_group.hub` | IP target group for the JupyterHub proxy |
| `aws_route53_record.hub` / `.apex` | Optional A-aliases in the bootstrap-owned zone |
| `aws_iam_role/policy` + `helm_release.lb_controller` | AWS Load Balancer Controller with IRSA |

The module does **not** create a Route53 zone, ACM certificate, ACM validation record,
or `aws_acm_certificate_validation` resource. Those persistent resources belong to
`terraform/stacks/00-bootstrap`.

## DNS and certificate ownership

The intended sequence is:

1. Apply `00-bootstrap` to create the Route53 project zone, ACM certificates and ACM
   validation CNAME records.
2. Publish the Route53 nameservers as an `mlbox` NS delegation in the parent Cloudflare
   zone. Cloudflare remains authoritative for the parent; Route53 is authoritative only
   for `mlbox.june8th.me`.
3. Wait until both bootstrap certificate statuses are `ISSUED`.
4. Apply `01-foundation` and then `02-platform`.

When `manage_route53 = true`, this module creates only the Route53 A-alias records for
`notebook.<domain>` and `<domain>` pointing to the ALB it owns. When false, no aliases
are created; the ALB and certificates still use the externally supplied values.

## Required certificate inputs

The caller supplies:

- `route53_zone_id`: the bootstrap-owned hosted zone ID;
- `certificate_arn`: ACM certificate for `notebook.<domain>`;
- `apex_certificate_arn`: ACM certificate for `<domain>`;
- their statuses and the zone nameservers for stable stack outputs.

The `02-platform` stack discovers these by project tags after bootstrap. The tags prevent
an unrelated zone or certificate in the same account from being selected.

## Important outputs

| Output | Description |
|---|---|
| `alb_arn` | ARN of the internet-facing ALB |
| `alb_dns_name` | Public ALB DNS name |
| `alb_security_group_id` | Security group attached to the ALB |
| `target_group_arn` / `target_group_name` | Target group consumed by `03-hub-app` |
| `certificate_arn` / `apex_certificate_arn` | Bootstrap-owned ACM certificate ARNs |
| `certificate_status` / `apex_certificate_status` | Current ACM statuses |
| `certificate_validation_records` | Empty; validation records are owned by bootstrap |
| `zone_id` / `zone_nameservers` | Bootstrap-owned Route53 zone metadata |
| `lb_controller_role_arn` | IRSA role of the load balancer controller |

## Notes / gotchas

- `subnet_ids` must be public subnets in at least two AZs.
- ALB/node SG rules allow the JupyterHub proxy pod port (`proxy_port`, normally 8000).
  The dashboard stack adds a separate port 3000 rule.
- The node SG is owned by the EKS foundation stack; if it is recreated, these standalone
  rules must be re-applied.
- `idle_timeout = 3600` supports long-lived JupyterHub websockets and terminals.
- This module does not own listeners. The 80-to-443 redirect and HTTPS listener live in
  `03-hub-app`, which waits for the bootstrap ACM certificate to become `ISSUED`.
- Keep `00-bootstrap` state and the Route53 zone separate from the platform lifecycle;
  destroying the platform should not remove the delegated zone or certificates.
