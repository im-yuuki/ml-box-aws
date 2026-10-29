# Project-first WebUI Design

**Status:** Approved design for implementation
**Date:** 2026-10-29
**Product context:** `docs/multi-tenant-product-plan.md`

## Goal

Turn the authenticated dashboard from a sandbox-first top-navigation MVP into a Project-first workspace while preserving existing sandbox, usage, account, authentication, and localization flows.

## Scope

This slice implements the frontend shell and Project workspace entry points. It does not invent backend capabilities for Teams, Artifacts, billing, or runtime collaboration that are not yet exposed by the BFF.

### In scope

- Project-first authenticated application shell.
- Desktop left rail and responsive mobile navigation.
- Space context presentation using the current authenticated Personal Space.
- Project search/filter within the loaded Space.
- `/projects` route backed by `GET /api/bff/projects`.
- New Project creation backed by `POST /api/bff/projects`.
- `/projects/[projectId]` route with durable Project overview and clearly labeled runtime/artifact areas.
- Compatibility links to existing `/sandboxes`, `/usage`, and `/account` routes.
- English and Vietnamese copy.
- Loading, empty, unauthorized, API-error, and disabled/coming-soon states.
- Existing ML Box design tokens, with the documented Ink/Canvas/Blue/Mint direction and technical mono accents.
- Keyboard focus, responsive layout, reduced-motion support, and semantic landmarks.

### Out of scope

- New Team, member, invitation, or permission-management UI.
- Artifact upload/download APIs or storage UI.
- Real subscription checkout or billing.
- Changing BFF authorization semantics.
- Removing or renaming the existing sandbox routes.
- Introducing a second design-token or component system.

## Information architecture

The authenticated shell exposes these destinations:

- **Projects** — default workspace home at `/projects`.
- **Sandboxes** — compatibility runtime view at `/sandboxes`.
- **Usage** — existing usage/quota view at `/usage`.
- **Account** — existing account/security view at `/account`.

The shell header presents:

- ML Box brand mark/wordmark.
- Current Space context: `Personal Space` for this slice, with a non-interactive organization-ready affordance only if it does not imply unsupported switching.
- Search field scoped to the currently loaded Projects list.
- Locale switcher.
- Theme control using the existing `mlbox-theme` behavior.
- Account entry/sign-out affordance consistent with the existing flow.

On narrow screens, the left rail collapses into a menu trigger; the destination labels and current-page state remain accessible without relying on hover.

## Projects home

`/projects` is a server route that renders the workspace shell and a client Project board.

The Project board:

1. Fetches `/api/bff/projects` with `cache: "no-store"` through the existing `bffFetch` helper.
2. Displays the returned Space ID only as context/state, never as an authorization decision.
3. Filters the loaded list by Project name and Team name if available.
4. Shows a clear create action.
5. Creates a Project with a non-empty name through the existing same-origin proxy.
6. Navigates to `/projects/[projectId]` after successful creation.
7. Handles `401` with an unauthenticated state/link to sign in, `403` with an unauthorized state, and other failures with retry.

Project cards show:

- Project name.
- Team name or a Personal Team label based on the current API shape.
- Project identity in a technical mono treatment where useful.
- Runtime status as an honest placeholder when no runtime status is returned by the API.
- Links to Project detail and the compatibility Sandbox view where the relationship is available.

The empty state explains that Projects are durable while Sandboxes are temporary, and provides the first-project action without duplicating the page title.

## Project detail

`/projects/[projectId]` is a client/server-compatible detail surface that receives the route ID and loads the current Project list to resolve the selected Project. It must:

- Never claim access based solely on a URL parameter.
- Show a not-found/unauthorized state when the loaded authorized list does not contain the ID.
- Present Project name, Space/Team context, and durable-workspace framing.
- Reserve clear sections for Runtime and Artifacts.
- Link to `/sandboxes` for the currently supported runtime workflow.
- Mark unsupported Artifact and advanced settings actions as coming soon or omit them; do not create dead controls.

## Visual system

Use the existing `web/dashboard/src/styles/heroui-tokens.css` and HeroUI v3 primitives. Extend `globals.css` only with reusable layout/visual utilities needed by this surface.

Visual intent:

- Canvas background with a quiet grid or layered surface treatment, not a generic flat white dashboard.
- Ink typography with Electric Blue for primary actions and focused navigation.
- Signal Mint for healthy/available states and Warm Amber for attention states.
- Restrained borders, small-radius surfaces, and dense but breathable workspace spacing.
- IBM Plex Sans/Mono if already available through the project’s asset strategy; otherwise use the existing token font stack without adding a network dependency.
- One coherent entrance transition for the workspace and respect `prefers-reduced-motion`.

Do not add gradients as decoration without informational purpose, excessive rounded cards, or a second palette unrelated to the shared token file.

## Component boundaries

Prefer focused components under `web/dashboard/src/components` and the authenticated app route group:

- `AppShell` — navigation landmarks, responsive rail, header context.
- `SpaceContext` — current Space label and metadata.
- `ProjectBoard` — fetch, filter, create, and state handling.
- `ProjectCard` — project summary and actions.
- `ProjectDetail` — selected Project overview and reserved sections.
- Existing `LocaleSwitcher`, `bffFetch`, and auth/session flows remain reusable.

The shell should not own Project data fetching. ProjectBoard and ProjectDetail own their API state and expose explicit loading/error/empty states.

## Localization

Add keys to both `web/dashboard/src/messages/en.json` and `vi.json` for:

- Navigation labels.
- Space and workspace headings.
- Search placeholder and result count.
- Project creation form, validation, success navigation, and failure copy.
- Empty, loading, unauthorized, not-found, unavailable, and retry states.
- Runtime/Artifacts section labels and coming-soon copy.

Do not hard-code user-visible English in new components.

## Accessibility and responsive behavior

- Use `header`, `nav`, `main`, `aside`, and heading hierarchy correctly.
- Every icon-only control has an accessible label.
- Current navigation has `aria-current="page"`.
- Search and create controls are keyboard reachable and have visible focus.
- Do not depend on color alone for status.
- Project cards remain usable at mobile widths without horizontal page overflow.
- At widths below the desktop breakpoint, the rail becomes a menu/drawer or compact top control while preserving all destinations.
- Honor reduced-motion preferences.

## Verification contract

- Read the installed Next.js 16.4.2 guidance before changing App Router code.
- Add tests for any extracted pure UI state/formatting helpers.
- Run dashboard lint and production build.
- Run the Impeccable detector once over changed UI targets.
- Inspect the rendered shell at desktop and mobile widths.
- Verify `/projects`, `/projects/[projectId]`, and existing `/sandboxes`, `/usage`, `/account` routes in the deployed dashboard.
- Deploy using a new immutable image tag only after local checks pass.

## Acceptance criteria

1. An authenticated user lands in a recognizable Project-first workspace at `/projects`.
2. The shell visibly communicates ML Box, current Space, project search, and primary navigation.
3. Projects load from the existing authorized API, can be filtered, and can be created.
4. A created Project opens its detail surface without trusting client-provided authorization context.
5. Existing sandbox, usage, account, auth, English, Vietnamese, light, dark, desktop, and mobile flows remain reachable.
6. Unsupported capabilities are represented honestly rather than as non-functional controls.
7. Local lint/build checks and live route checks provide evidence for the implementation.
