# Agent context: ML Box UI/theme direction

Extracted from the archived OpenCode history on 2026-10-20. This is a concise
handoff, not a replacement for the current implementation contract. Read
`web/theme/README.md`, `web/theme/tokens/heroui-tokens.css`, and the current
project README before making changes; those files are authoritative where this
note is abbreviated.

## User intent

- The UI is the user-experience layer of the ML Box GPU notebook product, not
  merely cosmetic JupyterHub styling.
- The long-term product may add a launcher, account management, quota and
  subscription management, and multi-user collaboration on a notebook.
- The first requested increment is the theme for JupyterHub and the notebook
  workspace, using HeroUI's native design language and the shared HeroUI tokens.
- Product brand: **ML Box**; tagline: “GPU notebooks for teams”.

## Current implementation boundaries

- `web/theme/hub/`: JupyterHub server-rendered pages. Keep upstream Jinja
  templates extended with small block overrides; do not copy full templates.
  Use the existing verified Z2JH static/template mount paths in the theme
  README.
- `web/theme/lab/jlab-heroui-theme/`: prebuilt, CSS-only JupyterLab light/dark
  theme. Do not manipulate Lumino DOM.
- `web/theme/tokens/heroui-tokens.css` is the color/radius/motion source of
  truth. Do not introduce hard-coded colors or a second token set.
- The Hub has no React runtime: use the vendored vanilla `motion` package only
  for progressive-enhancement entrance motion. Keep CSS transitions/animation
  minimal and honor `prefers-reduced-motion`.
- Keep hub theme classes prefixed `mlb-`. The detailed file layout, token
  contract, theme behavior, and mounting constraints are in
  `web/theme/README.md`.

## Archived source threads

- Main design discussion: `ses_eab7b8c34ffeaj4TLhd6IoIbIQ` (“Thiết kế theme
  JupyterHub với HeroUI”). User first asked for a JupyterHub and notebook web
  UI theme using the HeroUI component kit, then clarified the wider product UX
  ambition and asked to build the Hub/workspace theme first.
- Build handoffs: `ses_eab729667ffeTCSsnoasPSeC7d` (Hub pages) and
  `ses_eab729666ffeGZRDaKVZ2Nkqrv` (JupyterLab extension). These archived
  prompts contain implementation requirements; reconcile them with the
  current README/tokens rather than copying them blindly.

## Safe continuation

The repository already has user changes and untracked work. Preserve all of it;
inspect `git status` before editing. Continue the theme work in small, focused
changes and verify the affected theme/build only. Do not expand into launcher,
accounts, quotas, subscriptions, or collaboration unless requested; those are
future product direction, not current scope.
