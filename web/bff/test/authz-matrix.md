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

## Retry and ambiguous starts

The BFF does **not** automatically retry `POST` start on 502/504. A timeout can happen after Hub accepted the spawn, so replaying the POST is ambiguous without a Hub idempotency guarantee. The UI instead offers a status check (navigate to the sandbox list and perform its safe GET refresh); failed servers expose an explicit user-initiated restart action. No automatic retries are performed for start requests.
