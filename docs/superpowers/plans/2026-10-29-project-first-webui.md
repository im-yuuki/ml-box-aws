# Project-first WebUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated sandbox-first dashboard shell with a responsive Project-first workspace while preserving existing runtime, usage, account, authentication, and localization flows.

**Architecture:** Keep the authenticated route group as the shared workspace frame, but move navigation/context concerns into focused client/server components. Add a client ProjectBoard and ProjectDetail that own their own `bffFetch` state and only display projects returned by the authorized API; the detail route resolves the URL id against that list rather than trusting the parameter. Extend the existing token-driven CSS with scoped workspace layout utilities and use HeroUI primitives without introducing a second component or token system.

**Tech Stack:** Next.js 16.4.2 App Router, React 19, TypeScript, HeroUI v3, Tailwind CSS v4, next-intl, existing `bffFetch`, existing ML Box token CSS.

**Spec:** `docs/superpowers/specs/2026-10-29-project-first-webui-design.md`

## Global Constraints

- Preserve `/sandboxes`, `/usage`, `/account`, authentication, locale switching, and existing sandbox behavior.
- Do not add Team/member/invitation UI, artifact APIs/storage UI, real billing, BFF authorization changes, or a second token/component system.
- Treat the API-returned Space ID as display context only; never use URL/query/project ids as authorization evidence.
- ProjectBoard and ProjectDetail own project fetching/state; AppShell must not fetch projects.
- Add every new user-visible string to both `web/dashboard/src/messages/en.json` and `vi.json`; do not hard-code new English copy.
- Use semantic landmarks, keyboard-visible focus, non-color-only status communication, mobile no-overflow behavior, and reduced-motion support.
- Read Next.js 16.4.2 guidance from `web/dashboard/node_modules/next/dist/docs/` when dependencies are available; this worktree currently has no installed docs, so use the already recorded official Next 16 guidance and do not invent unsupported APIs.
- Use the existing `mlbox-theme` local-storage behavior and `web/dashboard/src/styles/heroui-tokens.css`; no network font or dependency addition.
- Run dashboard lint/build, pure-helper tests, the Impeccable detector, desktop/mobile inspection, and deployed route checks before claiming completion.

## Review Focus

- A crafted `/projects/<id>` URL must not reveal or render an unauthorized Project; detail resolution must use the authorized API list. Test the resolver with found, missing, and duplicate/invalid ids.
- API `401`, `403`, and non-auth failures must render distinct sign-in, unauthorized, and retry states without throwing or leaving stale data. Test the response classifier/state helper.
- Project creation must reject whitespace-only names, preserve the current Space context, and navigate only after a successful response. Test the create payload/validation helper.
- Mobile rail/menu must remain keyboard reachable and not create horizontal overflow; inspect at mobile viewport and verify semantic `aria-current`/labels in rendered markup.
- Existing authenticated routes must retain the new shell without owning or duplicating Project fetch state; verify `/sandboxes`, `/usage`, and `/account` in the build and browser.

---

### Task 1: Project state helpers and localized copy

**Files:**
- Create: `web/dashboard/src/lib/projects.ts`
- Test: `web/dashboard/src/lib/projects.test.ts`
- Modify: `web/dashboard/src/messages/en.json`
- Modify: `web/dashboard/src/messages/vi.json`

**Interfaces:**
- Produces `ProjectRecord`, `ProjectListResponse`, `ProjectLoadState`, `classifyProjectResponse(status)`, `filterProjects(projects, query)`, `resolveProject(projects, projectId)`, and `validateProjectName(name)` for later UI components.

- [ ] **Step 1: Write failing pure-helper tests**

  Add Node-compatible tests for:
  - `filterProjects` matching project name and optional team name case-insensitively and returning all projects for blank query.
  - `resolveProject` returning only an exact authorized id match and `null` for missing/empty ids.
  - `validateProjectName` rejecting whitespace-only names and trimming accepted names.
  - `classifyProjectResponse(401) === "unauthenticated"`, `403 === "unauthorized"`, `>=500 === "unavailable"`, and successful status === `"ready"`.

- [ ] **Step 2: Run `node --experimental-strip-types --test src/lib/projects.test.ts` and verify the tests fail because `projects.ts` is absent**

  The dashboard has no test runner dependency; use Node’s built-in test runner with TypeScript stripping and keep the helper test free of JSX/framework imports. Add no test framework or runtime dependency.

- [ ] **Step 3: Implement the pure helpers in `web/dashboard/src/lib/projects.ts`**

  Keep the API types tolerant of the current response shape: `teamName` is optional, and runtime/artifact fields are optional because the BFF currently returns project identity only. `filterProjects` must not mutate its input; `validateProjectName` returns `{ok: true, value}` or `{ok: false}`.

- [ ] **Step 4: Add all Project-first shell, board, detail, and state copy to both locale files**

  Include keys for Projects, Personal Space, search/results, navigation/menu/theme controls, create/validation/failure, loading/empty/unauthorized/not-found/unavailable/retry, durable workspace framing, Runtime, Artifacts, runtime compatibility, and coming-soon/unsupported states. Keep existing keys unchanged.

- [ ] **Step 5: Run the pure-helper tests and `npm run build`; expected helper assertions pass and no locale/type errors occur**

- [ ] **Step 6: Commit**

  ```bash
  git add web/dashboard/src/lib/projects.ts web/dashboard/src/lib/projects.test.ts web/dashboard/src/messages/en.json web/dashboard/src/messages/vi.json
  git commit -m "feat: add project workspace state helpers"
  ```

### Task 2: Authenticated workspace shell

**Files:**
- Create: `web/dashboard/src/components/AppShell.tsx`
- Create: `web/dashboard/src/components/SpaceContext.tsx`
- Create: `web/dashboard/src/components/ThemeToggle.tsx`
- Modify: `web/dashboard/src/app/(app)/layout.tsx`
- Modify: `web/dashboard/src/app/globals.css`
- Modify: `web/dashboard/src/messages/en.json`
- Modify: `web/dashboard/src/messages/vi.json`

**Interfaces:**
- Consumes localized navigation/context labels and existing `LocaleSwitcher`; reads/writes `mlbox-theme` using the established light/dark bootstrap contract.
- Produces a semantic `<AppShell>{children}</AppShell>` with `header`, `aside`, `nav`, `main`, desktop rail, mobile menu trigger/panel, search slot, current Personal Space context, locale/theme/account affordances, and `aria-current="page"` navigation.

- [ ] **Step 1: Write failing shell navigation-model tests**

  Pin that the shell model exposes the four approved destinations, marks the current pathname as current, labels the mobile menu/theme controls, and renders the Personal Space context without performing a Project request. Test the pure model with Node’s built-in test runner; do not add a React test framework.

- [ ] **Step 2: Run the test and verify it fails for the missing shell/model**

- [ ] **Step 3: Implement `SpaceContext`, `ThemeToggle`, and `AppShell`**

  Use a compact left rail on desktop and a client-side mobile disclosure below the desktop breakpoint. Keep the shell’s search field presentational/controlled by the board page rather than fetching projects. Use a recognizable ML Box mark/wordmark, Personal Space metadata, locale switcher, theme control, account link, and sign-out route/affordance compatible with the current auth flow. Use one entrance animation class and disable it under `prefers-reduced-motion`.

- [ ] **Step 4: Replace the old top-nav implementation in `(app)/layout.tsx` with the shell and add scoped canvas/grid/rail/focus/motion utilities to `globals.css`**

  Keep existing token variables and use Ink/Canvas/Blue/Mint/Amber values through the shared token mappings. Avoid decorative gradients, excessive rounded cards, and hard-coded new copy.

- [ ] **Step 5: Run dashboard lint/build and verify existing sandbox, usage, and account pages still compile inside the shell**

- [ ] **Step 6: Commit**

  ```bash
  git add web/dashboard/src/components/AppShell.tsx web/dashboard/src/components/SpaceContext.tsx web/dashboard/src/components/ThemeToggle.tsx web/dashboard/src/app/'(app)'/layout.tsx web/dashboard/src/app/globals.css web/dashboard/src/messages/en.json web/dashboard/src/messages/vi.json
  git commit -m "feat: add project-first workspace shell"
  ```

### Task 3: Projects board and creation flow

**Files:**
- Create: `web/dashboard/src/components/ProjectBoard.tsx`
- Create: `web/dashboard/src/components/ProjectCard.tsx`
- Create: `web/dashboard/src/app/(app)/projects/page.tsx`
- Modify: `web/dashboard/src/messages/en.json`
- Modify: `web/dashboard/src/messages/vi.json`

**Interfaces:**
- Consumes `ProjectRecord`, `ProjectListResponse`, helper functions from Task 1, `bffFetch`, `useTranslations`, `useRouter`, and the AppShell search slot/context.
- Produces `/projects` with fetch/filter/create behavior, explicit loading/empty/401/403/unavailable/retry states, project cards, and navigation to `/projects/[projectId]`.

- [ ] **Step 1: Extend the pure-helper tests with board-state cases**

  Pin that project cards use only API-returned records, blank names are rejected before POST, a successful create response exposes the new id for navigation, and 401/403/500 map to the corresponding UI state.

- [ ] **Step 2: Run the helper tests and verify the new board-state assertions fail before the board implementation**

- [ ] **Step 3: Implement the board and cards**

  Fetch `/api/bff/projects` with `bffFetch` and `cache: "no-store"`; use the returned `spaceId` only for display. Filter by name/team, show technical ids in mono, honestly label runtime status unavailable, link to detail, and provide a sandbox compatibility link without inventing a sandbox id. Use a clear create form/action and navigate only after a successful `POST /api/bff/projects`.

- [ ] **Step 4: Add `/projects` metadata and render it in the authenticated route group**

- [ ] **Step 5: Run dashboard lint/build and the board/helper test suite**

- [ ] **Step 6: Commit**

  ```bash
  git add web/dashboard/src/components/ProjectBoard.tsx web/dashboard/src/components/ProjectCard.tsx web/dashboard/src/app/'(app)'/projects/page.tsx web/dashboard/src/messages/en.json web/dashboard/src/messages/vi.json
  git commit -m "feat: add project board and creation flow"
  ```

### Task 4: Project detail and compatibility presentation

**Files:**
- Create: `web/dashboard/src/components/ProjectDetail.tsx`
- Create: `web/dashboard/src/app/(app)/projects/[projectId]/page.tsx`
- Modify: `web/dashboard/src/messages/en.json`
- Modify: `web/dashboard/src/messages/vi.json`

**Interfaces:**
- Consumes route `projectId`, `bffFetch`, `resolveProject`, and localized detail/runtime/artifact messages.
- Produces a detail page that resolves the route id against the authorized Project list, shows not-found/unauthorized when absent, and renders durable Project context plus honest Runtime/Artifacts sections.

- [ ] **Step 1: Extend the pure-helper tests with detail-resolution cases**

  Pin that an id present in the fetched authorized list resolves, an unknown id resolves to `null`, and route parameters never create a Project record or bypass list membership.

- [ ] **Step 2: Run the helper tests and verify the new detail assertions fail before the detail implementation**

- [ ] **Step 3: Implement `ProjectDetail` and the dynamic route**

  Fetch the authorized list with `cache: "no-store"`, resolve using `resolveProject`, and render Project name, Space/Team context, technical id, durable-workspace explanation, Runtime status placeholder with `/sandboxes` link, and Artifacts as clearly unavailable/coming soon without dead controls.

- [ ] **Step 4: Run dashboard lint/build and detail/helper tests**

- [ ] **Step 5: Commit**

  ```bash
  git add web/dashboard/src/components/ProjectDetail.tsx web/dashboard/src/app/'(app)'/projects/'[projectId]'/page.tsx web/dashboard/src/messages/en.json web/dashboard/src/messages/vi.json
  git commit -m "feat: add project detail workspace"
  ```

### Task 5: Visual/accessibility verification and deployment

**Files:**
- Modify only if verification finds a concrete defect: changed workspace components, `globals.css`, or locale files.
- Do not modify backend authorization or infrastructure behavior beyond the immutable dashboard image reference required for deployment.

**Interfaces:**
- Consumes the complete Project-first UI from Tasks 1–4 and existing deployment scripts/Terraform variables.
- Produces local verification evidence, desktop/mobile inspection evidence, a new immutable dashboard image, and deployed `/projects`/detail plus compatibility route evidence.

- [ ] **Step 1: Run Impeccable detector once over changed UI targets**

  Run the manual detector against the changed shell, board, detail, and global CSS targets; record findings and fix concrete high-confidence issues in one bounded pass. If the detector reports no automatic hook, use its manual detector output as the review evidence.

- [ ] **Step 2: Run dashboard lint, build, and pure-helper tests**

  Expected: lint has zero errors, production build completes, and all helper/state tests pass.

- [ ] **Step 3: Inspect desktop and mobile rendering**

  Use the browser at desktop and mobile widths. Verify rail/menu behavior, no horizontal overflow, focus-visible controls, `aria-current`, loading/empty/error/unauthorized states where reachable, theme toggle, locale switcher, `/projects`, `/projects/[projectId]`, `/sandboxes`, `/usage`, and `/account`.

- [ ] **Step 4: Build and push a new immutable dashboard image after local checks**

  Use the existing Cognito build args and a unique tag, push only after lint/build and inspection pass. Do not reuse immutable tags or expose secrets.

- [ ] **Step 5: Apply the dashboard image change and verify rollout**

  Inspect Terraform plan for only the intended dashboard image/update, apply with the existing AWS SSO profile and `ap-southeast-2`, then verify both deployments and ALB health.

- [ ] **Step 6: Verify deployed routes and commit any final fixes**

  Check `/`, `/login`, `/projects`, `/projects/[projectId]`, `/sandboxes`, `/usage`, and `/account`; unauthenticated Project access must remain a BFF 401 through the proxy. Run final git diff/status and commit any verification fixes with Conventional Commit messages.
