# Hub Lifecycle and Stable Identity Design

## Status

- Design approved in conversation on 2026-10-29.
- Phase 2 and Phase 3 are implemented locally in compatibility mode; deployment, migration dry-run, backup, and production verification remain pending.
- The existing self-hosted JupyterHub remains the runtime; this design does not fork or replace it.

## Goals

1. Expose truthful sandbox lifecycle states from the BFF: `starting`, `ready`, `stopped`, and `failed`.
2. Preserve JupyterHub start response status (`201` or `202`) inside the BFF adapter without exposing Hub credentials.
3. Bound polling and retries so a request cannot spawn duplicate servers or wait forever.
4. Record lifecycle transitions in the app-owned audit log.
5. Move Hub identity toward Cognito `sub` without orphaning existing email-mapped Hub users.
6. Make email mutable display metadata rather than the long-term identity key.
7. Preserve authorization-before-provisioning and the existing Hub activation fallback.

## Non-goals

- No JupyterHub core fork or replacement orchestrator.
- No caller-controlled Hub username.
- No destructive deletion or automatic overwrite during identity migration.
- No real payment, quota, or usage-ledger changes.
- No change to the OAuth username claim until the migration safeguards and rollout verification are complete.

## Phase 2 — Lifecycle adapter

### Hub request boundary

The BFF Hub request helper will return an internal response containing the HTTP status and parsed body. Non-2xx responses remain typed errors with their status. The response type is internal to the BFF; service-token headers, raw fetch responses, and secrets never leave the BFF or appear in logs.

The adapter will preserve the status of the named-server start request:

- `201`: the server was created and is considered `ready` when the returned/current server state confirms readiness; otherwise it is `starting` and is checked through the bounded lifecycle resolver.
- `202`: the request is accepted and is immediately represented as `starting`.
- Other successful responses: resolve the current server state before returning; do not assume readiness from a generic 2xx.

### Canonical state mapping

The BFF API and dashboard use these states:

- `starting`: Hub reports pending/spawning, or a start request was accepted but readiness is not confirmed.
- `ready`: Hub reports the server ready and exposes a usable server URL.
- `stopped`: the named server is absent or explicitly stopped.
- `failed`: Hub reports a failed spawn/error state, or bounded lifecycle resolution ends in a confirmed failure.

The adapter may accept legacy Hub fields (`ready`, `pending`, `state`) but emits the canonical state. Existing `running`/`pending` consumers are migrated in the same change or receive a compatibility mapping at the BFF boundary; the dashboard must not display a false failure for a valid pending spawn.

### Bounded lifecycle resolution

A pure lifecycle resolver will be tested independently from Fastify. It will poll a supplied status callback only while the server remains `starting` and only within fixed limits:

- finite maximum attempts and total timeout;
- increasing, capped backoff between attempts;
- injectable sleep/clock for deterministic tests;
- return `starting` when the deadline expires without a confirmed failure;
- return `ready`, `stopped`, or `failed` as soon as the corresponding state is observed.

The start route uses the resolver after an accepted start when configured for bounded waiting. A timeout is not converted into a generic Hub error: the response remains a successful lifecycle response with `state: "starting"`, allowing dashboard refresh to observe progress.

### Retry policy

- Authorization and app-owned sandbox mapping happen before any provisioning or start request.
- A missing Hub user may be provisioned once, then the start request may be retried once for a confirmed propagation race.
- A 404 from a server path when the user was already confirmed to exist is treated as a sandbox/path error and is not converted into user provisioning.
- Transient Hub failures may be retried only through a bounded, idempotency-aware policy; no indefinite retry and no repeated spawn POST without a status check.
- The adapter must not issue a second start when the status resolver already observes `starting` or `ready`.

### Audit events

Lifecycle operations write app-owned audit records with the authenticated Cognito subject and sandbox/application identifiers, but no tokens or sensitive Hub response data. The event vocabulary is:

- `sandbox.start_requested`
- `sandbox.starting`
- `sandbox.start_retry`
- `sandbox.ready`
- `sandbox.failed`
- `sandbox.stopped`

Audit writes are best-effort only when the existing app database is unavailable; a database outage must not cause a duplicate Hub spawn or leak credentials. The implementation will preserve existing audit error handling conventions and test the recorded action and safe metadata.

### Dashboard behavior

`SandboxList` will consume canonical states:

- `starting`: show a starting label, disable conflicting actions, and refresh while any sandbox remains starting;
- `ready`: show the lab/open action and stop action;
- `stopped`: show the start action;
- `failed`: show a failure label and allow a bounded retry action.

Existing `HubActivationCard` behavior remains the fallback for authentication, permission, mapping, token, and genuine Hub failures. English and Vietnamese copy must cover the canonical states and retry/failure messaging.

## Phase 3 — Stable Cognito-sub identity

### Identity model

Cognito `sub` is the immutable application identity. `mlbox_users.id` remains the source of truth for the authenticated application user. Email is updated from the verified session and is display/contact metadata only.

Add an app-owned Hub identity mapping with one canonical row per Cognito user and a unique canonical Hub username. The mapping stores:

- Cognito `user_id`;
- canonical `hub_username`;
- optional `legacy_email`;
- migration status (`legacy`, `mapped`, `migrated`, or `conflict`);
- optional previous Hub username for rollback;
- creation and migration timestamps.

The migration is additive and must not overwrite existing sandbox ownership or mappings.

### Resolver and rollout

The server-side resolver follows this order:

1. Use an existing canonical mapping for the authenticated Cognito `sub`.
2. During compatibility rollout, resolve an existing legacy email mapping for that same user and record it as `legacy`.
3. For a new user with no legacy mapping, derive a deterministic canonical Hub username from the Cognito `sub` using the documented Hub-safe encoding/format.
4. Never accept a username from request parameters, query strings, or request bodies.

A changed email updates `mlbox_users.email` and any display metadata but does not change the resolved Hub username.

The first migration stage is dual-read/compatibility: existing email-based Hub users continue to work through their stored mapping, while new users can receive canonical `sub` identities. JupyterHub OAuth `username_claim` is not switched until a migration report is clean and production backup/rollback steps have been verified.

### Migration safeguards

The migration tool/service must support dry-run reporting before writes and must detect:

- two Cognito users resolving to one canonical Hub username;
- a canonical username already belonging to a different Hub user;
- a legacy email mapping that belongs to a different app user;
- sandbox mappings that would be reassigned by the migration.

Conflicts are recorded and skipped; migration never silently overwrites a mapping, Hub user, or sandbox owner. Existing email-based Hub users are retained during the first rollout. Rollback restores the previous app mapping from the stored previous username and does not delete Hub data automatically.

### Identity tests

Tests must cover:

- deterministic canonical username generation from Cognito `sub`;
- legacy email lookup for existing users;
- email rename without identity change;
- collision detection and non-overwrite behavior;
- dry-run reporting;
- rollback to the previous mapping;
- authorization preventing a user from selecting another user's mapping;
- preserving existing sandbox ownership during mapping migration.

## Verification and rollout

Before deployment:

1. Run BFF build and full tests, including lifecycle and identity migration tests.
2. Run dashboard lint/build and dashboard tests when dashboard code changes.
3. Run Terraform formatting and validation where provider packages are available.
4. Run `git diff --check` and inspect the staged file list.
5. Back up the app database before applying additive identity schema changes.
6. Verify the Terraform plan contains only intended lifecycle/identity configuration changes.
7. Deploy BFF/dashboard, verify rollout, then exercise start/pending/ready/failure, email rename, collision, and rollback scenarios.

The unrelated existing change in `docs/multi-tenant-product-plan.md` may be committed if it is intentionally included, but it must remain separate from lifecycle/identity behavior in the review and must not be overwritten.
