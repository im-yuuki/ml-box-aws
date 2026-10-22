# ingress-dns: ALB + target group + ACM (free, DNS validation) + LB controller.

The ALB is created **here**, not by the hub's Kubernetes Ingress. Reason: the public DNS
name and the TLS certificate must exist *before* DNS is switched over at the registrar /
DNS provider (Cloudflare). The hub service is attached to the target group later, from
another stack, with a `TargetGroupBinding` (the LB controller chart installed below is
what reconciles that CRD).

## What the module creates

| Resource | Notes |
|---|---|
| `aws_security_group.alb` | Internet-facing SG for the ALB |
| `aws_vpc_security_group_ingress_rule.alb_http` / `.alb_https` | 80 / 443 from `0.0.0.0/0` |
| `aws_vpc_security_group_egress_rule.alb_egress_proxy` | Egress to the EKS node SG on `proxy_port` |
| `aws_vpc_security_group_ingress_rule.node_proxy_ingress` | Ingress on the **node** SG: from the ALB SG, `proxy_port` |
| `aws_lb.hub` | Public ALB, `name_prefix = "hub-"` |
| `aws_lb_target_group.hub` | `target_type = "ip"`, health check on `health_check_path` |
| `aws_acm_certificate.hub` | `hub.<domain>`, DNS validation |
| `aws_iam_role/policy` + `helm_release.lb_controller` | aws-load-balancer-controller 3.6.0 (IRSA), for the TargetGroupBinding |

The SG rules are standalone resources, not inline blocks, so the node SG (owned by the
EKS stack) can be edited without rule conflicts. The ALB SG has no inline egress, so
Terraform drops the default allow-all egress: the only outbound path is the node SG on
`proxy_port`.

## DNS modes

### `manage_route53 = false` (default) - DNS managed by hand (Cloudflare)

No Route53 resource is created. Terraform only outputs what the operator must publish:

1. `terraform apply` -> the ALB + the certificate request exist.
2. Read `certificate_validation_records` (output) - a map of
   `_acme-challenge.hub.<domain>` -> TXT value. Add it at the DNS provider
   (Cloudflare: TXT record, name `_acme-challenge.hub`, value = the record value).
3. ACM validates automatically (usually within ~1 minute). `certificate_status` turns
   `ISSUED` (visible in the next `terraform apply`/`refresh`).
4. Add a `CNAME`/`A` record for `hub.<domain>` -> `alb_dns_name` at the DNS provider.
   Or keep a CNAME to the ALB DNS name, plus a `CAA` record if the provider asks for one.

### `manage_route53 = true` - the zone lives in Route53

Terraform owns everything: the zone (created when `route53_zone_id` is empty), the ACM
validation TXT records, the `aws_acm_certificate_validation` (which waits for the
certificate to be issued) and the `A`-alias record `hub.<domain>` -> this module's ALB.
For a newly created zone, point the NS records at the registrar
(see the `zone_nameservers` output).

## Outputs

| Output | Description |
|---|---|
| `alb_arn` | ARN of the ALB |
| `alb_dns_name` | Public DNS name of the ALB (the record to publish) |
| `alb_security_group_id` | SG attached to the ALB |
| `target_group_arn` | Target group ARN for the TargetGroupBinding |
| `target_group_name` | Target group name |
| `certificate_arn` | ACM certificate ARN (usable while `PENDING_VALIDATION`) |
| `certificate_status` | `PENDING_VALIDATION` / `ISSUED` / ... |
| `certificate_validation_records` | Map `record name -> record value` to publish manually |
| `lb_controller_role_arn` | IRSA role of the LB controller |

Also kept from the previous version: `host`, `zone_id`, `zone_nameservers`.

## Notes / gotchas

- The ACM DNS validation record must be published **within 7 days** of the request,
  otherwise ACM fails the request and the certificate has to be re-created.
- ALB/node SG rules allow the JupyterHub proxy pod port (`proxy_port`, 8000). The TargetGroupBinding resolves `proxy-public:80` to the proxy pod target port; the target group's default port remains 8081.
  (`/`). While no pod is registered, the target group is unhealthy - that is expected
  until the TargetGroupBinding is applied.
- `subnet_ids` must be **public** subnets in at least 2 different AZs.
- The node SG ingress rule is created on a security group owned by the EKS stack: if that
  stack recreates the node SG, this rule has to be re-applied.
- `idle_timeout = 60` is the ALB default. JupyterHub keeps long-lived websockets; if
  idle notebooks get disconnected, raise it to `3600`.
- This module does **not** own the listeners. The 80 -> 443 redirect and the 443
  listener live in the `04-hub-app` stack, because ELBv2 only accepts an **ISSUED**
  certificate on an HTTPS listener - and the certificate is only issued after the
  operator publishes the DNS validation record. No other stack may create a listener on
  the same ALB, and the Z2JH `ingress.enabled` in the hub stack must be turned off,
  otherwise the LB controller creates a second ALB.
- The ALB is created with no listener; ELB API allows that, and the ALB answers
  nothing until the hub-app stack attaches one.
