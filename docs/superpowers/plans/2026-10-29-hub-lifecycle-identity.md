# Hub Lifecycle and Stable Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 sandbox lifecycle handling and Phase 3 Cognito-sub Hub identity compatibility without orphaning existing email-mapped users.

**Architecture:** Keep JupyterHub self-hosted and keep the BFF as the only Hub service-token boundary. Add pure, injectable lifecycle and identity modules for deterministic tests; keep Fastify route code responsible only for authorization, orchestration, response mapping, and best-effort audit calls. Roll out identity in compatibility mode first: existing email mappings remain usable, new users receive deterministic Cognito-sub identities, and OAuth claim configuration is not switched in this change.

**Tech Stack:** TypeScript, Node test runner, Fastify, PostgreSQL via `pg`, Next.js/React dashboard, `next-intl`, Terraform/YAML.

**Spec:** `docs/superpowers/specs/2026-10-29-hub-lifecycle-identity-design.md`

## Global Constraints

- Keep the current self-hosted JupyterHub; do not fork or replace it.
- BFF only stores the Hub service token; never expose it to browser responses or logs.
- Never accept a caller-controlled Hub username; derive it from the authenticated Cognito subject and server-side legacy mapping.
- Preserve authorization-before-provisioning and the existing `HubActivationCard` fallback.
- Canonical API states are exactly `starting`, `ready`, `stopped`, and `failed`.
- Polling and retries must have finite attempts/timeouts and must not duplicate a confirmed start.
- Identity migration is additive, collision-safe, dry-run capable, and rollback-capable; email remains display metadata.
- Do not switch JupyterHub OAuth `username_claim` in this implementation.
- Preserve the existing user change in `docs/multi-tenant-product-plan.md`; it may be included in the final commit but must not be overwritten.
- No real payment, quota, usage-ledger, or unrelated product-control changes.

## Review Focus

- A successful Hub `201`/`202` response must not be collapsed into a generic pending/error result; test the exact status-to-state mapping in Task 1.
- A polling timeout must return `starting` without issuing an extra start request; test bounded attempts and injected sleep in Task 1.
- A server-path `404` for an already-existing Hub user must not trigger user creation; test this in Task 2.
- An email change must not change a user's resolved Hub identity or sandbox ownership; test resolver/store behavior in Task 4 and Task 5.
- A canonical username collision must produce a conflict/dry-run report and never overwrite another mapping; test this in Task 5.

---

### Task 1: Build the pure lifecycle adapter

**Files:**
- Modify: `web/bff/src/hub.ts`
- Test: `web/bff/src/hub.test.ts`

**Interfaces:**
- Consumes: Hub server payloads and start responses from the existing BFF routes.
- Produces: `HubLifecycleState = "starting" | "ready" | "stopped" | "failed"`; `HubRequestResponse<T> = { status: number; body: T | null }`; `mapHubServerState(server: HubServerLike | null): HubLifecycleState`; and `resolveHubLifecycle(options): Promise<HubLifecycleState>` for the server integration task.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests for:

- `201` plus a ready server maps to `ready`.
- `202` maps immediately to `starting`.
- Hub `pending`/`spawning` maps to `starting`, ready maps to `ready`, absent server maps to `stopped`, and an explicit failed state maps to `failed`.
- A sequence `starting → starting → ready` polls and returns `ready`.
- A sequence that never becomes ready stops after the configured attempt/timeout limit and returns `starting`.
- A failed status returns `failed` without further polling.
- An injected sleep function records capped increasing delays.
- Existing `startHubSandbox` behavior still provisions only after a confirmed missing user and does not provision an existing user's invalid server path.

Use fake clock/sleep/status callbacks; no real waiting.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd web/bff
npm test -- --test-name-pattern='lifecycle|start provisions|Hub user provisioning'
```

Expected: fail because the canonical lifecycle types/mapping/resolver and status-preserving response seam do not yet exist.

- [ ] **Step 3: Implement the pure adapter**

Add the exact injectable interface:

```ts
export type HubLifecycleState = "starting" | "ready" | "stopped" | "failed";
export type HubServerLike = {
  state?: string | null;
  ready?: boolean;
  pending?: boolean;
  url?: string | null;
};
export type HubLifecycleOptions = {
  read: () => Promise<HubServerLike | null>;
  maxAttempts: number;
  timeoutMs: number;
  backoffMs: number;
  maxBackoffMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};
export function mapHubServerState(server: HubServerLike | null): HubLifecycleState;
export async function resolveHubLifecycle(options: HubLifecycleOptions): Promise<HubLifecycleState>;
```

Use bounded attempts and elapsed time. Treat a missing server as `stopped` during reads, but do not convert an accepted start timeout into `stopped`; the start route will retain `starting` when resolution times out. Keep `startHubSandbox` semantics unchanged unless a test requires a minimal shared error-status helper.

- [ ] **Step 4: Run focused and full BFF tests**

Run:

```bash
cd web/bff
npm test -- --test-name-pattern='lifecycle|start provisions|Hub user provisioning'
npm test
```

Expected: all focused tests and the complete suite pass.

- [ ] **Step 5: Commit the pure lifecycle adapter**

```bash
git add web/bff/src/hub.ts web/bff/src/hub.test.ts
git commit -m "feat: add bounded Hub lifecycle resolver"
```

### Task 2: Preserve Hub status and integrate BFF lifecycle/audit behavior

**Files:**
- Modify: `web/bff/src/server.ts`
- Modify: `web/bff/src/app-store.ts`
- Test: `web/bff/src/app-store.test.ts` or a new `web/bff/src/lifecycle.test.ts`

**Interfaces:**
- Consumes: `HubLifecycleState`, `mapHubServerState`, and `resolveHubLifecycle` from Task 1.
- Produces: an internal `hubRequestResponse<T>(runtime, method, path, body?)` returning `{ status: number; body: T | null }`; app-store `recordAuditEvent(userId, spaceId, action, target, metadata)`; and start/list routes emitting canonical lifecycle states.

- [ ] **Step 1: Write failing request/audit/route-seam tests**

Test the injectable request boundary or extracted helper for:

- successful Hub `201`, `202`, and other 2xx responses preserve status and parsed body;
- non-2xx responses retain the typed HTTP status;
- the Authorization token is only supplied to the internal fetch callback and never included in returned data;
- `recordAuditEvent` inserts the requested action/target/metadata and tolerates a database failure when called as best effort;
- start lifecycle audit actions are emitted in order for requested → starting/ready, and failure emits `sandbox.failed`;
- existing-user server-path `404` is returned as a sandbox/path failure and does not call `ensureHubUser`.

If direct Fastify integration is impractical, extract the route orchestration into an injected pure function and test that function; do not start a production server in unit tests.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd web/bff
npm test -- --test-name-pattern='Hub response|audit|lifecycle route|server path'
```

Expected: fail because `hubRequest` currently discards successful HTTP status, audit lifecycle methods do not exist, and start always returns `pending`.

- [ ] **Step 3: Implement the internal request boundary and audit method**

Refactor the existing helper without changing its token ownership:

```ts
async function hubRequestResponse<T>(runtime: RuntimeConfig, method: string, path: string, body?: unknown): Promise<{ status: number; body: T | null }>;
```

Keep a compatibility `hubRequest<T>` only where existing callers need parsed body, or migrate those callers in the same task. Add `AppStore.recordAuditEvent(userId: string, spaceId: string, action: string, target: string, metadata?: Record<string, unknown>): Promise<void>` using the existing `mlbox_audit_events` table and `randomUUID()`. Metadata must contain only safe identifiers/state values.

- [ ] **Step 4: Integrate start/list/stop routes**

- Keep `requireSession`, app-owned authorization, sandbox mapping, and quota checks before provisioning/start.
- Use the authenticated identity resolver currently available in the route; identity migration integration is Task 5.
- Preserve `201`/`202` from the named-server POST.
- Return `ready` for confirmed ready responses, `starting` for accepted/pending/timeout responses, `stopped` after stop, and `failed` for confirmed lifecycle failures.
- Use the bounded resolver after `202` or an unconfirmed `201`; never issue a second start if status is already `starting` or `ready`.
- Write lifecycle audit events best-effort; audit failure must not trigger another Hub request.
- Preserve activation fallback/error mapping for permission, token, mapping, and genuine Hub failures.

- [ ] **Step 5: Run BFF tests/build**

```bash
cd web/bff
npm test
npm run build
```

Expected: complete suite passes and TypeScript build succeeds.

- [ ] **Step 6: Commit BFF lifecycle integration**

```bash
git add web/bff/src/server.ts web/bff/src/app-store.ts web/bff/src/lifecycle.test.ts web/bff/src/app-store.test.ts
 git commit -m "feat: expose Hub sandbox lifecycle states"
```

### Task 3: Update dashboard lifecycle states and refresh behavior

**Files:**
- Modify: `web/dashboard/src/app/(app)/sandboxes/SandboxList.tsx`
- Modify: `web/dashboard/src/messages/en.json`
- Modify: `web/dashboard/src/messages/vi.json`
- Read before editing: `web/dashboard/node_modules/next/dist/docs/` relevant Next.js guidance

**Interfaces:**
- Consumes: BFF sandbox state union `starting | ready | stopped | failed` and existing `HubActivationCard` fallback.
- Produces: dashboard rendering/actions that do not treat `starting` as failure and refresh while a sandbox is starting.

- [ ] **Step 1: Write/update dashboard tests or type-level test fixtures**

Pin the state behavior used by `SandboxList`:

- `ready` renders open/stop controls.
- `starting` renders a starting label, disables conflicting controls, and schedules refresh.
- `stopped` renders start.
- `failed` renders failure/restart.
- `HubActivationCard` remains rendered when activation is required.

Use the repository's existing dashboard test conventions; if no component harness exists, keep the state/action mapping in an exported pure helper and test it with Node's test runner.

- [ ] **Step 2: Run the focused dashboard test and verify RED**

Run the repository-specific test command for the new helper/component test. Expected: fail because the current union is `running | pending | stopped | failed`.

- [ ] **Step 3: Implement canonical state rendering and bounded refresh**

Replace `running/pending` assumptions with `ready/starting`. Poll the list endpoint only while at least one sandbox is `starting`, using a client-side timer with cleanup and a bounded refresh interval; do not create a tight loop. Keep failed retry as a user action and keep activation fallback unchanged. Add English/Vietnamese strings for `stateStarting`, `stateReady`, and any lifecycle-specific retry/status copy.

- [ ] **Step 4: Run dashboard lint/build/tests**

```bash
cd web/dashboard
npm run lint
npm run build
```

Run any dashboard test command added by the repository conventions; expected all pass.

- [ ] **Step 5: Commit dashboard lifecycle UI**

```bash
git add 'web/dashboard/src/app/(app)/sandboxes/SandboxList.tsx' web/dashboard/src/messages/en.json web/dashboard/src/messages/vi.json
 git commit -m "feat: show sandbox lifecycle states"
```

### Task 4: Add pure stable Cognito-sub identity resolver

**Files:**
- Create: `web/bff/src/hub-identity.ts`
- Create: `web/bff/src/hub-identity.test.ts`

**Interfaces:**
- Consumes: authenticated Cognito `sub`, current verified email, and optional stored legacy mapping.
- Produces:

```ts
export type HubIdentityStatus = "legacy" | "mapped" | "migrated" | "conflict";
export type HubIdentity = {
  userId: string;
  hubUsername: string;
  legacyEmail: string | null;
  previousHubUsername: string | null;
  status: HubIdentityStatus;
};
export function canonicalHubUsername(userId: string): string;
export function resolveHubIdentity(input: { userId: string; email: string; mapping?: HubIdentity | null; legacyHubUsername?: string | null }): HubIdentity;
export function detectHubIdentityCollision(entries: HubIdentity[]): string[];
```

The canonical format is `cognito-${userId}`; validate that it is Hub-safe and deterministic. Existing stored mapping wins, then a confirmed legacy email username becomes `legacy`, otherwise a new canonical mapping is `mapped`. Never use a changed email to replace an existing identity.

- [ ] **Step 1: Write failing identity tests**

Cover deterministic canonical usernames, existing mapping precedence, legacy email compatibility, new-user canonical mapping, email rename preserving `hubUsername`, and collision detection returning conflicting usernames without choosing a winner.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
cd web/bff
npm test -- --test-name-pattern='identity|canonical|collision'
```

Expected: fail because `hub-identity.ts` does not exist.

- [ ] **Step 3: Implement the pure resolver**

Keep the resolver side-effect free. Collision detection must report conflicts only; it must not mutate entries or silently select one mapping.

- [ ] **Step 4: Run identity and full BFF tests**

```bash
cd web/bff
npm test -- --test-name-pattern='identity|canonical|collision'
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit the pure identity module**

```bash
git add web/bff/src/hub-identity.ts web/bff/src/hub-identity.test.ts
git commit -m "feat: add Cognito-sub Hub identity resolver"
```

### Task 5: Add additive identity schema, store operations, and migration safeguards

**Files:**
- Modify: `web/bff/src/app-store.ts`
- Modify: `web/bff/src/app-store.test.ts`
- Create: `web/bff/src/hub-identity-migration.ts`
- Create: `web/bff/src/hub-identity-migration.test.ts`

**Interfaces:**
- Consumes: `HubIdentity` and collision functions from Task 4.
- Produces:

```ts
export type HubIdentityMigrationEntry = {
  userId: string;
  email: string;
  currentHubUsername: string | null;
  canonicalHubUsername: string;
  status: "ready" | "conflict" | "unchanged";
  reason?: string;
};
export function planHubIdentityMigration(entries: HubIdentity[]): HubIdentityMigrationEntry[];
export function rollbackHubIdentity(mapping: HubIdentity): HubIdentity;
```

`AppStore` adds additive schema for `mlbox_hub_identities` with one row per `user_id`, unique `hub_username`, nullable `legacy_email`, status check, optional `previous_hub_username`, and timestamps. Add methods to read/upsert a mapping, list migration candidates, and record migration conflict/rollback state. Existing `mlbox_sandboxes` rows must not be reassigned by these operations.

- [ ] **Step 1: Write failing schema/store/migration tests**

Test:

- `ensureSchema` contains additive identity table/index definitions.
- A legacy email mapping is stored and read for the same Cognito user.
- Email update changes display email only; the Hub username remains unchanged.
- Two entries with the same canonical username produce `conflict` entries and no overwrite.
- A dry-run migration returns a report and performs no writes.
- Rollback returns the previous mapping and does not delete Hub/sandbox data.
- Existing sandbox owner/mapping remains unchanged during identity operations.

Adapt the existing in-memory SQL mock patterns rather than adding a database dependency.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd web/bff
npm test -- --test-name-pattern='Hub identity migration|identity mapping|schema'
```

Expected: fail because the table, store methods, and migration planner do not yet exist.

- [ ] **Step 3: Implement additive schema and store methods**

Use `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, and additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` only. Keep migration writes transactional where multiple mapping rows are applied. Reject conflicts before writes. Never update `hub_username` based solely on a new email.

- [ ] **Step 4: Implement dry-run and rollback planner**

`planHubIdentityMigration` must return deterministic entries and mark collisions/conflicting legacy ownership as `conflict`. `rollbackHubIdentity` restores `previousHubUsername` and the prior status while leaving Hub and sandbox records untouched.

- [ ] **Step 5: Run focused and full tests**

```bash
cd web/bff
npm test -- --test-name-pattern='Hub identity migration|identity mapping|schema'
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit identity persistence and safeguards**

```bash
git add web/bff/src/app-store.ts web/bff/src/app-store.test.ts web/bff/src/hub-identity-migration.ts web/bff/src/hub-identity-migration.test.ts
git commit -m "feat: add safe Hub identity migration"
```

### Task 6: Integrate stable identity compatibility into BFF routes

**Files:**
- Modify: `web/bff/src/server.ts`
- Modify: `web/bff/src/app-store.ts`
- Modify: `web/bff/src/hub.ts` if path helpers need the resolved identity
- Test: `web/bff/src/server.identity.test.ts` or an extracted route orchestration test

**Interfaces:**
- Consumes: `resolveHubIdentity`, `AppStore` mapping methods, and canonical lifecycle adapter.
- Produces: all Hub user/server paths derived from the resolved server-side `HubIdentity`, never directly from `session.email` or request input.

- [ ] **Step 1: Write failing integration-seam tests**

Cover:

- New Cognito subject uses `cognito-${sub}`.
- Existing email-mapped user continues to use the stored legacy email username.
- Changed email continues to use the same legacy/canonical Hub username.
- A collision returns a safe conflict/fallback response and does not provision or overwrite.
- `/sandboxes`, start, and stop use the resolved identity consistently.
- Authorization is completed before identity provisioning.
- No request body/query username can alter the resolved identity.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd web/bff
npm test -- --test-name-pattern='resolved identity|email rename|collision|caller username|authorization before provisioning'
```

Expected: fail because routes currently use `session.username`, which is email-derived, and sandbox creation still stores email in `hub_username`.

- [ ] **Step 3: Integrate compatibility resolution**

For each authenticated request, resolve the mapping by Cognito `session.subject`. During compatibility rollout, use a stored legacy mapping before deriving `cognito-${subject}`. Ensure new sandbox mappings persist the resolved Hub username, while existing `mlbox_sandboxes` ownership and server names remain unchanged. Update `ensureUserBootstrap` only for display email updates; do not use email as identity lookup after a mapping exists.

Keep the OAuth `username_claim: email` Terraform setting unchanged in this task. Do not delete or rename existing Hub users automatically.

- [ ] **Step 4: Add safe conflict/fallback handling**

Map identity conflicts to a stable BFF error/activation fallback without exposing internal mapping details. Audit conflict/rollback actions with safe user and sandbox identifiers where appropriate. Ensure a failed identity lookup cannot fall through to a caller-supplied username.

- [ ] **Step 5: Run full BFF verification**

```bash
cd web/bff
npm test
npm run build
```

Expected: all tests pass and the build succeeds.

- [ ] **Step 6: Commit route integration**

```bash
git add web/bff/src/server.ts web/bff/src/app-store.ts web/bff/src/hub.ts web/bff/src/server.identity.test.ts
git commit -m "feat: resolve Hub identity from Cognito subject"
```

### Task 7: Update project documentation, verify the branch, and finish the release commit

**Files:**
- Modify: `docs/plans/hub-provisioning-adapter.md`
- Modify: `TODO.md`
- Modify or include: `docs/superpowers/specs/2026-10-29-hub-lifecycle-identity-design.md`
- Preserve: `docs/multi-tenant-product-plan.md` exactly as the user provided it

- [ ] **Step 1: Update status documentation**

Mark Phase 2/3 as locally implemented only after their tests pass. Keep deployment, database backup, migration dry-run, Terraform plan/apply, and production E2E as pending until performed. Document that OAuth `username_claim` remains unchanged and that identity rollout is compatibility mode.

- [ ] **Step 2: Run all verification commands**

```bash
cd web/bff
npm test
npm run build

cd ../dashboard
npm run lint
npm run build

cd ../..
terraform fmt -check -recursive terraform/stacks/03-hub-app
git diff --check
git status --short --untracked-files=all
```

Run `terraform validate` only if providers are available; otherwise record the existing provider-cache limitation without claiming validation.

- [ ] **Step 3: Review staged file list and unrelated documentation**

Confirm the lifecycle/identity files are the only implementation changes. Confirm `docs/multi-tenant-product-plan.md` is unchanged from the user's working copy; if intentionally included, include only its existing diff and no lifecycle edits.

- [ ] **Step 4: Commit the completed Phase 2/3 documentation and any intentionally preserved docs change**

```bash
git add TODO.md docs/plans/hub-provisioning-adapter.md docs/superpowers/specs/2026-10-29-hub-lifecycle-identity-design.md
# Add docs/multi-tenant-product-plan.md only if its pre-existing user change is intentionally included.
git commit -m "feat: complete Hub lifecycle and identity phases"
```

- [ ] **Step 5: Final status check**

Run `git status --short --untracked-files=all` and verify no unintended files remain staged or modified. Do not claim production deployment; deployment requires valid AWS credentials, database backup, intended Terraform plan, rollout, and E2E verification.
