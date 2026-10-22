# 03-hub-app — JupyterHub (Z2JH) application stack

This stack owns the **JupyterHub application** only: the Z2JH helm release, the
TargetGroupBinding that points the pre-created ALB at the hub Service, and the
ALB listeners (HTTP → HTTPS redirect, HTTPS → target group).

Everything infra-shaped lives in **`02-platform`** and is consumed read-only
through `data "terraform_remote_state" "platform"`:

| 02-platform output | used for |
| --- | --- |
| `db_url` (sensitive) | `hub.db.url` in the Z2JH values |
| `cognito_issuer`, `cognito_client_id`, `cognito_client_secret`, `cognito_authorize_url`, `cognito_token_url`, `cognito_userdata_url` | `GenericOAuthenticator` |
| `hub_role_arn` | `hub.serviceAccount.annotations` (IRSA → S3 workspace) |
| `alb_arn` | `aws_lb_listener` |
| `target_group_arn` | `aws_lb_listener` + `TargetGroupBinding` |
| `vpc_id` | `TargetGroupBinding.spec.vpcID` |
| `certificate_arn` | HTTPS listener + cert wait |
| `certificate_validation_records` | (operator input) ACM TXT records to publish at Cloudflare |

The stack also creates **no** S3 bucket, RDS instance, Cognito pool, ECR repo,
ALB or ACM certificate — those are all in `02-platform`.

---

## Order of operations (important)

1. **`02-platform` must be applied first.** This stack reads its state object;
   if `02-platform` has never been applied the read fails immediately.
2. **The operator publishes the DNS records at Cloudflare** — both
   - the CNAME/ALIAS for `notebook.<domain>` → the ALB, and
   - the ACM **validation TXT record** for the certificate.

   Both come from `02-platform`:

   ```bash
   terraform -chdir=terraform/stacks/02-platform output alb_dns_name
   terraform -chdir=terraform/stacks/02-platform output certificate_validation_records
   ```

   Publishing them in one sitting is the whole point of the split: the ALB
   exists before the hub is deployed, so the operator never has to come back
   for a second DNS round-trip.
3. **Then apply this stack.** It waits (up to 15 min) for the ACM certificate
   to reach `ISSUED` before creating the HTTPS listener. If the TXT record is
   missing, the wait fails with an explicit message instead of hanging.
4. **Then apply the theme** (see below).

---

## GPU profiles are OFF by default

`enable_gpu_profiles = false` (default) hides both GPU profiles
(*GPU shared L4* and *GPU dedicated*) from the profile list. The account has no
GPU quota yet, so a GPU profile would only produce confusing node-scaling
errors.

The **CPU profile stays available and is the default profile**. It targets the
existing `karpenter.sh/nodepool: cpu-user` NodePool, which needs no GPU quota.

Flip the flag once the GPU quota is in place:

```hcl
# terraform.tfvars
enable_gpu_profiles = true
```

then `terraform apply` (the helm release is re-rendered from the values
template).

---

## Image pinning

`cpu_image` / `gpu_image` point at the ECR repositories created by
`02-platform`. The tag follows the image-pipeline convention **`dev-<gitshortsha>`**,
currently `dev-fa3b6fa`:

```
451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/cpu:dev-fa3b6fa
451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/gpu:dev-fa3b6fa
```

Bump the tag when the pipeline produces a new image. The EKS nodes pull from
ECR through the node role, so the image must be pushed before the first spawn.

---

## Follow-up steps after `terraform apply`

```bash
# 1. ML Box theme (two ConfigMaps the hub Deployment mounts)
./deploy/apply-hub-theme.sh

# 2. Verify
kubectl get svc -n hub                       # confirm the Service name/port
kubectl get targetgroupbinding -n hub
kubectl get pods -n hub
kubectl logs -n hub deploy/hub -c hub --tail=50

# 3. Browser
#    https://notebook.<domain>/hub/login   -> Cognito hosted UI
#    https://notebook.<domain>/hub/home    -> JupyterHub
#    https://notebook.<domain>/hub/logo    -> ML Box logo
```

The `target_service_name` / `target_service_port` variables feed the
TargetGroupBinding. Its defaults (`proxy-public` / `80`) match what Z2JH creates;
the ALB target group forwards to the proxy pod on port `8000`.
but confirm with `kubectl get svc -n hub` after the first deploy and adjust
the two variables if your chart version differs.

---

## Files

| File | Purpose |
| --- | --- |
| `main.tf` | remote state read, helm release, TargetGroupBinding, cert wait, listeners |
| `versions.tf` | providers (`aws`, `helm`, `kubectl`) + EKS cluster data source |
| `variables.tf` | inputs (region/domain/images/flags/state coordinates/service ref) |
| `values/hub-values.yaml.tpl` | Z2JH values (Cognito, spawn hook, profiles, scheduling, cull) |
| `values/10-spawn-hook.py` | reference copy of the spawn hook (not consumed by Terraform) |

## Notes / gotchas

- The chart's `ingress:` block was **removed** from the values template on
  purpose — the ALB already exists in `02-platform`, and a second Ingress
  would create a second ALB. Traffic flows via the `TargetGroupBinding`
  (`networking.k8s.aws/v1beta1`, `targetType: ip`).
- Terraform template directives use HCL syntax (`%{ if }` / `%{ endif }`).
  Go-style `{{ if }}` is emitted verbatim and breaks the YAML.
- The certificate wait runs `aws acm describe-certificate` through the AWS
  **CLI**, so the CLI must be able to authenticate with the same account
  (e.g. `AWS_PROFILE` / `AWS_REGION` exported, or `~/.aws/credentials`
  pointing at the right profile). If the CLI cannot authenticate, the poll
  reports `UNKNOWN` and the wait times out after 15 minutes.
- If the HTTPS listener fails with a "target group is not associated with the
  load balancer" error, the LB controller had not finished attaching the
  target group yet — just re-run `terraform apply` (the resource is idempotent).
