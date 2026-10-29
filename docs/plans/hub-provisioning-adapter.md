# Hub Provisioning Adapter

## Status

- Phase 1: implemented locally; Terraform/deployment pending
- Phase 2: implemented locally; deployment/production verification pending
- Phase 3: implemented locally in compatibility mode; read-only migration dry-run command available; backup, deployment, and production verification pending
- Phase 4: planned

## Architecture decisions

- Keep the current self-hosted JupyterHub.
- Do not fork or modify JupyterHub core in this scope.
- Do not build a replacement Kubernetes orchestrator now.
- Add a thin Hub Provisioning Adapter/orchestration layer in the existing BFF.
- Keep the Hub service token only in the BFF; never expose it to the browser.
- Keep the Hub activation card as a fallback for service-token, permission, mapping, or genuine Hub failures.

## Phase 1 — Provision Hub users in the BFF

1. Add `ensureHubUser()` to the Hub adapter/BFF.
2. Derive the username only from the authenticated Cognito session and the current mapping; never accept an arbitrary client username.
3. Provision with idempotent `POST /hub/api/users/{username}`.
4. Eagerly provision when loading `/sandboxes`; lazily provision on start and retry the start exactly once when the Hub user is missing.
5. Keep app-owned authorization before provisioning so unauthorized requests cannot create Hub users.
6. Grant the BFF service only the required `admin:users`, `servers`, and `admin:servers` scopes.
7. Keep audit and error mapping explicit; never log tokens or secrets.
8. On provisioning failure, return the existing activation metadata/card instead of a generic error.

## Phase 2 — Sandbox lifecycle

1. Distinguish `starting`, `ready`, `stopped`, and `failed`.
2. Preserve and interpret REST start responses `201` (ready) and `202` (pending).
3. Poll progress/user-server state with bounded timeout and backoff.
4. Treat valid pending responses as `starting`, not failures.
5. Add bounded retry for transient errors; never retry indefinitely or duplicate spawns.
6. Audit provisioning, start requested, pending, ready, failed, and retry events as appropriate.
7. Show lifecycle state and actions in the dashboard; keep activation fallback.

## Phase 3 — Stable identity mapping

- Keep the existing email-based Hub records readable during the compatibility rollout.
- Resolve new Hub identities deterministically from the authenticated Cognito `sub` as `cognito-${sub}`.
- Prefer a stored subject mapping, then a verified legacy email/owner-scoped sandbox mapping; email remains mutable metadata/display identity.
- Handle collisions as a manual-review conflict with no overwrite, Hub provisioning, delete, or rename.
- Provide additive schema, dry-run planning, rollback data, and backup requirements before enabling a production migration.
- Keep JupyterHub OAuth `username_claim: email` unchanged in this implementation; reconciliation of remaining Hub email records is a separate rollout step.
- Do not combine identity migration with a destructive Hub-user rename or sandbox ownership reassignment.

## Phase 4 — Optional JupyterHub extension

Build an extension/package only if the adapter still needs deeper Hub integration for profile/plan selection, entitlement/quota enforcement, metadata, lifecycle events, or behavior unavailable through the REST API and service roles. Do not modify core if an extension or service hook is sufficient.

## When to evaluate replacing JupyterHub

Only evaluate a replacement orchestrator after proving JupyterHub is a real limitation for multi-cloud scheduling, non-notebook workloads, scale, custom billing scheduling, or lifecycle/scheduling requirements that REST plus an extension cannot satisfy. A replacement must account for authentication/OAuth, tenant isolation, routing/WebSockets/terminal, spawn/progress, idle culling, CPU/RAM/GPU scheduling, storage, network policy, secrets, quota, audit, recovery, image upgrades, and reverse proxy behavior.

## Acceptance criteria

- A dashboard-authenticated user can be provisioned automatically without opening Hub first in the happy path.
- Starting a sandbox does not fail merely because its Hub user is absent; the flow creates the user and retries at most once.
- Pending spawn is represented as `starting`, not a false error.
- The activation card remains available for permission, token, mapping, and genuine Hub failures.
- The service token remains only in BFF secrets and never appears in browser responses or logs.
- Tests cover existing/new users, create races/idempotency, retry-once, 201/202, timeout/failure, and authorization.
- Local tests/build pass; deployment uses an intended-only Terraform plan, backup/rollback, rollout, and production verification before claiming completion.
