# Sandbox authorization isolation matrix

Phase 3 verification is intentionally local and does not create users or call production.

| Operation with session A | Hub path constructed by BFF | Expected isolation |
|---|---|---|
| List (`GET /v1/sandboxes`) | `/hub/api/users/{A.username}` | Only A's Hub user record is read |
| Start (`POST /v1/sandboxes/:name/start`) | `/hub/api/users/{A.username}/servers/{name}` | Name is validated; client cannot supply/replace the username |
| Stop (`DELETE /v1/sandboxes/:name`) | `/hub/api/users/{A.username}/servers/{name}` | Same authenticated-user scope; client cannot select B |

The Hub API token is privileged, so this path construction is the BFF authorization boundary. `src/hub.test.ts` asserts the actual helper used by both start and stop is bound to the session username and rejects path/query injection through the server name. The list route similarly builds its user URL directly from `session.username`.

| Check | Result |
|---|---|
| User A cannot select B's username in start/stop path params | Covered by unit test (invalid server-name path rejected) |
| List path uses authenticated session username | Source inspection; no caller-controlled username parameter exists |
| A's GET list excludes B's servers; A cannot start/delete B's servers | Not executed: requires two real Hub identities and is excluded from safe local verification |

## Project, team, invitation, artifact and usage routes (phase 2–6)

| Operation | Authorization rule | Covered by |
|---|---|---|
| Project list / create | Space membership; create needs owner/admin or team membership (not viewer) | `app-store.test.ts` (SQL predicates) |
| Project list visibility | Owner/admin/viewer see all; others need team membership or a non-blocked direct grant | `app-store.test.ts` |
| Project list Space check | A Space the caller does not belong to returns 403 `FORBIDDEN` (same guard as the usage route) | `usage-scope.test.ts` |
| Team create / member add / member remove | Owner or admin of the Space only | `app-store.test.ts` (denial paths) |
| Last team lead | Removing or demoting the only lead returns 409 `LAST_TEAM_LEAD` | `app-store.test.ts` |
| Project sandbox read / start / stop | Read needs canRead (404 otherwise); start/stop need canOperate (403). Runtime runs under the owner's Hub user | `app-store.test.ts` (runtime creation, fail-closed without owner identity) |
| Artifacts list / create / complete / download | canRead for reads; canOperate for create and complete; keys built server-side under `spaces/{space}/projects/{project}/` | `artifacts.test.ts` (key construction, traversal rejection) |
| Invitations create / list / revoke | Owner or admin of the Space; accept only for the invited email, never downgrading an existing role | `app-store.test.ts` |
| Invitation member limit | A plan with a member limit refuses an invitation with 409 `MEMBER_LIMIT_REACHED`; the seats are the active members plus the pending invitations | `integration/pg-integration.mjs` (seat count) |
| Invitation accept joins the teams | An accepted admin/member also gets a `mlbox_team_members` row (`member`) for the Space's teams; a viewer gets none and stays read-only | `app-store.test.ts`, `integration/pg-integration.mjs` |
| Team membership backfill | `ensureSchema` adds the missing team rows of every active admin/member Space membership, idempotently; viewers are never granted one | `app-store.test.ts`, `integration/pg-integration.mjs` |
| Usage (project / space) | Project canRead; space summary requires active membership | `app-store.test.ts` |
| Usage of a Space the Hub does not know | An empty footprint, not an error: the plan section still runs, so the free tier is reported | `mock-billing.test.ts` |

Not executed: cross-tenant requests against a live cluster with two real identities. Still required before release.

## Retry and ambiguous starts

The BFF does **not** automatically retry `POST` start on 502/504. A timeout can happen after Hub accepted the spawn, so replaying the POST is ambiguous without a Hub idempotency guarantee. The UI instead offers a status check (navigate to the sandbox list and perform its safe GET refresh); failed servers expose an explicit user-initiated restart action. No automatic retries are performed for start requests.
