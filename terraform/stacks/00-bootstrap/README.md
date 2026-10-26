# 00-bootstrap — persistent state backend + DNS/ACM boundary

Run this stack first with local state. It creates:

- the encrypted/versioned S3 bucket and DynamoDB lock table used by all other stacks;
- the delegated Route53 hosted zone for `mlbox.june8th.me`;
- ACM DNS-validation certificates for `notebook.mlbox.june8th.me` and the dashboard apex;
- ACM validation CNAME records inside that Route53 zone;
- generated `backend.hcl` files for `01-foundation`, `02-platform`, `03-hub-app`,
  `04-dashboard` and `99-unverified-gpu`.

Cloudflare remains authoritative for the parent zone. After bootstrap, publish the
Route53 nameservers as an NS delegation for `mlbox` in the parent Cloudflare zone.
The foundation and platform stacks may be applied while ACM is still pending; wait
for both certificates to become `ISSUED` before applying the hub/listener stack.

## First apply

```bash
terraform init
terraform plan
terraform apply
terraform output route53_zone_nameservers
terraform output notebook_certificate_status
terraform output dashboard_certificate_status
```

The default `validate_certificates = false` lets bootstrap finish while ACM waits for
DNS delegation. The validation CNAME records are still created automatically. After
publishing the NS delegation and confirming ACM is `ISSUED`, the explicit validation
resources are optional; do not destroy the zone or state backend when iterating on later
stacks. Apply `01-foundation` and `02-platform` next, then wait for ACM before
`03-hub-app`. The bootstrap state (`terraform.tfstate`) is local and must be backed up securely.

## Outputs used by the next phase

- `state_bucket` / `lock_table`: generated into consuming backend files;
- `route53_zone_id` / `route53_zone_nameservers`: DNS delegation and platform aliases;
- `notebook_certificate_arn` / `dashboard_certificate_arn`: consumed by `02-platform`.

Never commit `terraform.tfstate`, `backend.hcl`, plans, or secrets.
