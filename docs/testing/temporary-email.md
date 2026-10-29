# Temporary email for test accounts

For development and demo registration flows, use the public [Mail.tm API](https://docs.mail.tm/).

## Why Mail.tm

- Free and does not require an API key.
- Supports creating a temporary inbox through REST.
- Supports reading confirmation emails through REST.
- The API is suitable for manual test-account setup and lightweight scripts.
- Mail.tm documents an 8 requests/second per-IP limit; keep polling below that limit.

Do not use temporary inboxes for real users, production customer data, secrets, or long-lived accounts. Public temporary email services can be deleted, rate-limited, or unavailable without notice.

## Reusable workflow

```bash
BASE=https://api.mail.tm

# 1. Find a current domain.
curl -sS "$BASE/domains"

# 2. Create an inbox. Replace the domain and use a unique address/password.
curl -sS -X POST "$BASE/accounts" \
  -H 'Content-Type: application/json' \
  -d '{"address":"mlbox-test-<unique>@<domain>","password":"<strong-temporary-password>"}'

# 3. Get an inbox token.
curl -sS -X POST "$BASE/token" \
  -H 'Content-Type: application/json' \
  -d '{"address":"mlbox-test-<unique>@<domain>","password":"<strong-temporary-password>"}'

# 4. List messages.
curl -sS "$BASE/messages" \
  -H 'Authorization: Bearer <MAIL_TM_TOKEN>'

# 5. Read a message and extract the confirmation code.
curl -sS "$BASE/messages/<MESSAGE_ID>" \
  -H 'Authorization: Bearer <MAIL_TM_TOKEN>'
```

Use a polling interval of at least 2 seconds when waiting for an email. Keep the token and password in environment variables or a local ignored file; never commit them or paste them into logs.

## Manual ML Box test flow

1. Fetch a Mail.tm domain and create a unique inbox.
2. Register the inbox on the ML Box dev/demo site.
3. Poll `GET /messages` until `Your verification code` arrives.
4. Read that message and enter the code on `/verify`.
5. Sign in and use `/account` to exercise mock billing.
6. Remove local credentials/token after the test if they are no longer needed.

This is a test convenience, not an application dependency. Production registration must continue to use normal email delivery and should not rely on Mail.tm.
