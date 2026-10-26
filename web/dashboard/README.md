# ML Box — Dashboard

Next.js + HeroUI v3 web app that replaces the JupyterHub hub pages.
The dashboard is intended for `https://mlbox.june8th.me`; the hub remains
API-only/user-facing at `https://notebook.mlbox.june8th.me`. Auth and existing
sandbox actions are wired through the internal BFF; usage/quota and some account
flows remain scaffold/mock until their APIs are implemented.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing — sign in or create account. |
| `/login` | Email + password sign in. |
| `/register` | Create an account (Cognito sign-up + email confirmation). |
| `/verify` | Email confirmation code. (confirmation is currently inline in `/register`) |
| `/sandboxes` | List and start/stop the user's notebook servers through the BFF. |
| `/sandboxes/new` | Start a new sandbox. (TODO) |
| `/usage` | Quota dashboard (mock data currently). |
| `/account` | Email, password, sessions (placeholder UI). |
| `/api/bff/*` | Same-origin server-side proxy to the internal BFF. |

## Environment

The dashboard is a public client, so only `NEXT_PUBLIC_*` variables are
needed at build time. They are inlined into the JS bundle by Next.js.

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_COGNITO_REGION` | Region of the Cognito user pool. |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | The pool the dashboard authenticates against. |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | The public (no secret) dashboard app client. |
| `NEXT_PUBLIC_BFF_BASE_URL` | Where the BFF is reachable. Same origin in prod. |

## Develop

```bash
cd web/dashboard
npm install
npm run dev
# open http://localhost:3000
```

Authentication requests are sent to the same-origin BFF proxy. The public Cognito
identifiers are still build-time metadata for the dashboard image; passwords and
session tokens are handled server-side by the BFF.

## Build the image

```bash
docker buildx build --platform linux/amd64 \
  -f web/dashboard/Dockerfile \
  --build-arg NEXT_PUBLIC_COGNITO_REGION=ap-southeast-2 \
  --build-arg NEXT_PUBLIC_COGNITO_USER_POOL_ID=<...> \
  --build-arg NEXT_PUBLIC_COGNITO_CLIENT_ID=<...> \
  --build-arg NEXT_PUBLIC_BFF_BASE_URL=https://mlbox.june8th.me/api/bff \
  --tag 451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/dashboard:dev-<sha> \
  .
```

## Current implementation status

Code and deployment wiring currently prepared:

- Cognito pool and public dashboard app client are created by `02-platform`; the
  dashboard client enables the BFF's `USER_PASSWORD_AUTH` flow.
- `web/bff/` implements Cognito sign-up/confirm/login/logout, encrypted HttpOnly
  sessions, JWT/JWKS verification and per-user JupyterHub list/start/stop proxying.
- `04-dashboard` defines immutable ECR images, dashboard and BFF Deployments,
  the BFF Kubernetes Secret/Service, TargetGroupBinding and apex listener rule.
- The dashboard image is built from repository root and uses
  `https://mlbox.june8th.me/api/bff` as its same-origin proxy base URL.

The required stacks `00-bootstrap` through `04-dashboard` have been freshly
recreated and rolled out. The production `DYNAMIC_SERVER_USAGE` fix is verified
through the ALB: `/` and `/login` return `200`, and the dashboard target is healthy.
BFF readiness is also healthy; authenticated Cognito and real JupyterHub user
flows still require a test user.

Still TODO:

- Test Cognito registration/confirmation/login/logout and a real JupyterHub user.
- Add refresh-token rotation, CSRF protection, forgot-password and stronger logout
  handling to the BFF.
- Complete `/sandboxes/new`, rename, account and usage/quota APIs/UI.
- Add GPU-hour accounting after the GPU stack and quota policy are ready.

For the deployment sequence and operational commands, see the repository
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md), [`docs/OPERATIONS.md`](../../docs/OPERATIONS.md),
and [`TODO.md`](../../TODO.md).

## Internationalization

- Library: `next-intl` (v4).
- Locales: English (`en`) and Vietnamese (`vi`). Add a new locale by
  dropping another file in `src/messages/` and adding it to
  `src/i18n/config.ts`.
- Resolution: cookie `mlbox-locale` (1 year, `SameSite=Lax`). The header
  switcher in the app shell POSTs to `/api/locale` and reloads.
- Messages live in `src/messages/<locale>.json` and are imported
  statically in `src/i18n/request.ts` (Turbopack rejects dynamic JSON
  imports).
- The root layout keeps the locale provider inside `<Suspense>` because
  `getLocale()` reads the `mlbox-locale` cookie at request time. Cache Components
  and partial prefetching are disabled because this cookie-based model uses the
  standard dynamic rendering path.
