# ML Box — Dashboard

Next.js + HeroUI v3 web app that replaces the JupyterHub hub pages.
Auth, sandbox management and usage/quota tracking all live here; the hub
itself is now API-only and is driven through the BFF.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing — sign in or create account. |
| `/login` | Email + password sign in. |
| `/register` | Create an account (Cognito sign-up + email confirmation). |
| `/verify` | Email confirmation code. (TODO) |
| `/sandboxes` | List of the user's notebook servers. |
| `/sandboxes/new` | Start a new sandbox. (TODO) |
| `/usage` | Quota dashboard (CPU/RAM/storage/GPU-hours). |
| `/account` | Email, password, sessions. |
| `/api/bff/*` | Server-side proxy to the BFF service. |

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
  --build-arg NEXT_PUBLIC_BFF_BASE_URL=https://app.mlbox.june8th.me/api/bff \
  --tag 451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/dashboard:dev-<sha> \
  .
```

## What is still TODO

- The BFF service (`web/bff/`). It will own the SRP computation,
  session cookies, and the proxy to the JupyterHub REST API.
- A `04-dashboard` Terraform stack: ECR repo, Deployment, Service, ALB
  listener rule for `app.<domain>`, ACM cert, DNS.
- Wire the sandboxes page to the BFF for real server state.
- GPU-hour accounting (after the GPU stack comes online).

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
