# ML Box — Dashboard

Next.js + HeroUI v3 web app that replaces the JupyterHub hub pages.
The dashboard is deployed at `https://mlbox.june8th.me`; the hub remains
API-only/user-facing at `https://notebook.mlbox.june8th.me`. Auth, sandbox
management and usage/quota tracking are the target product areas, but several
flows are still scaffold/mock until the BFF is deployed.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing — sign in or create account. |
| `/login` | Email + password sign in. |
| `/register` | Create an account (Cognito sign-up + email confirmation). |
| `/verify` | Email confirmation code. (scaffold/TODO) |
| `/sandboxes` | List of the user's notebook servers. (mock data currently) |
| `/sandboxes/new` | Start a new sandbox. (TODO) |
| `/usage` | Quota dashboard (mock data currently). |
| `/account` | Email, password, sessions (placeholder UI). |
| `/api/bff/*` | Server-side BFF proxy routes (currently stubbed). |

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

The form pages will surface a "Cognito is not configured yet" banner
until the env is populated, so the layout can be reviewed end-to-end
without standing up Cognito.

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

Implemented infrastructure and scaffolding:

- Cognito pool and public dashboard app client are provisioned by `02-platform`.
- The `04-dashboard` Terraform stack is applied: ECR repositories, dashboard
  Deployment/Service, TargetGroupBinding, apex listener rule and certificate.
- The dashboard image is built from the repository root and is intended to use
  `https://mlbox.june8th.me/api/bff` as its same-origin BFF base URL.

Known production blocker:

- The deployed dashboard currently returns HTTP 500 with `DYNAMIC_SERVER_USAGE`
  from the Next.js production runtime. Development mode returns 200. Do not
  treat the dashboard as production-ready until this is fixed and the ALB
  target is healthy. See [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) and
  [`docs/OPERATIONS.md`](../../docs/OPERATIONS.md).

Still TODO:

- Implement the BFF service (`web/bff/`) for Cognito JWT verification, session
  handling and proxying JupyterHub REST API. No BFF source/service is currently
  present in this repository.
- Replace the `/api/bff/*` `501 BFF_NOT_DEPLOYED` stubs with the real BFF.
- Complete Cognito sign-up, confirmation, sign-in, sign-out and recovery flows.
- Wire sandbox list/spawn/stop/status to real Hub state.
- Complete `/verify`, `/sandboxes/new`, account and usage/quota behavior.
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
- The root layout wraps `NextIntlClientProvider` in `<Suspense>` because
  `getLocale()` reads cookies at request time, which would otherwise
  block route prerendering under `cacheComponents`.
