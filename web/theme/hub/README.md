# ML Box — JupyterHub hub-pages theme

HeroUI-styled overrides for the JupyterHub 5 hub UI (Z2JH chart 4.4.2,
JupyterHub 5.x, Bootstrap 5.3). All colors/radius/motion come from
[`../../tokens/heroui-tokens.css`](../tokens/heroui-tokens.css) — read that
file and [`../README.md`](../README.md) (the binding contract) before
changing anything here.

```
web/theme/hub/
  build/           Tailwind v4 build source (input.css, package.json, scripts/)
  templates/       Jinja overrides: page / login / home / spawn_pending
  static/          build outputs, served by the Hub: heroui.css, motion.js,
                   logo.svg, logo-white.svg, logo-wordmark.svg
```

## Build

```powershell
cd web/theme/hub/build
npm install
npm run build          # CSS (tailwindcss -i input.css -o ../static/heroui.css --minify)
                       # + motion.js (copies node_modules/motion/dist/motion.js)
npm run watch          # rebuild CSS on change
```

- Old packages require npm — no yarn.
- Output is **self-contained**: `input.css` inlines `../../tokens/heroui-tokens.css`
  at build time (`@import` is resolved by Tailwind v4), so the published
  `static/heroui.css` has **zero network references** (no `@import`/`url()`
  to the network) and works offline behind the Hub.
- Semantic tokens are mapped into `@theme inline`, so the utilities generated
  from the templates (scanned via `@source "../templates/**/*.html"`)
  resolve through the runtime `var(--…)` and follow light/dark switching.
- Tailwind preflight/base is intentionally NOT imported: the hub already
  ships Bootstrap 5.3. Only `theme.css` + `utilities.css` are used, kept in
  `@layer` so our unlayered rules can win the cascade (Bootstrap ships
  unlayered, and unlayered always beats layered rules regardless of
  specificity — this matters for elements that must keep Bootstrap classes
  for upstream JS, e.g. `.form-control`, `.btn`).
- `motion` (the framer-motion team's vanilla package) is vendored as an
  IIFE — `node_modules/motion/dist/motion.js` is copied verbatim to
  `static/motion.js`, so a plain `<script>` tag exposes `window.Motion`
  (`animate`, `stagger`, …). No bundler, no React.

## Deploy mounts (verified against Z2JH 4.4.2)

- **Templates** → container path `/etc/jupyterhub/custom/templates`
  (ConfigMap or extraVolumes), loaded via `c.JupyterHub.template_paths`.
  The hub packs its loader as
  `ChoiceLoader([PrefixLoader({'templates': FileSystemLoader([stock])}, '/'),
  FileSystemLoader(template_paths)])` with the custom dir **first** and the
  stock dir appended last (see `jupyterhub/app.py`, `init_tornado_settings`,
  5.x). That is why:
  - our `page.html` extends the stock one via the prefix:
    `{% extends "templates/page.html" %}` (extending the bare `"page.html"`
    would recurse into our own override);
  - our child templates extend `{% extends "page.html" %}` which resolves to
    our themed `page.html`, which itself chains into the stock one.
- **Static** → container path `/usr/local/share/jupyterhub/static/heroui/`
  (this `static/` dir). Tornado serves it at
  `{{ base_url }}hub/static/heroui/…`.
  NOTE: `c.JupyterHub.extra_static_paths` does **not** exist on the Hub —
  that traitlet belongs to jupyter_server / the single-user image. Do not
  reference it in hub values.
- Referenced by `deploy/hub-values-theme.patch.md` (Patch A) — check that
  file for the exact values snippet; see "Reported gaps" below if it is
  not present yet.

## Template strategy — exact upstream block names

Every override extends upstream and touches only these blocks (verified by
re-rendering the real extends chain — see `_upstream_test/validate.py`,
which reproduces JupyterHub's loader block-for-block; upstream sources
fetched from `jupyterhub/jupyterhub@5.x share/jupyterhub/templates/`):

| Override            | Extends                | Blocks overridden (all upstream names)                                                                                  |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `templates/page.html` | `templates/page.html` | `title`, `stylesheet`, `favicon`, `scripts` (adds `motion.js`), `meta` (adds the `data-theme` seed script), `logo`, `footer`, `script` (adds the fade-up init snippet) |
| `templates/login.html` | `page.html`          | `login_widget`, `main` → `login` → `login_container`, `username_input`(+`_attrs`), `password_input`(+`_attrs`), `otp_input`(+`_attrs`), `login_terms`(+`_text`), `script` (upstream submit-wiring kept verbatim) |
| `templates/home.html`  | `page.html`          | `main`, `script` (upstream `require(["home"])` kept verbatim)                                                              |
| `templates/spawn_pending.html` | `page.html`   | `main` (incl. upstream's inner `message` block), `script` (upstream EventSource wiring kept verbatim)                       |

DOM **ids/classes the upstream JS depends on are preserved**: hidden `_xsrf`,
`#username_input`/`#password_input`/`#login_submit` + `.feedback-container`/
`.feedback-widget`, `#start`/`#stop`, `.home-server-row`/`data-server-name`/
`.new-server-name`/`.new-server-btn`/`.start-server`/`.stop-server`/
`.delete-server`/`.server-link`/`.time-col`, `#progress-bar`/`#sr-progress`/
`#progress-message`/`#progress-log`/`#progress-details`, `.hidden` (defined
globally in upstream `page.scss`).

New markup uses `mlb-`-prefixed classes (card, buttons, floating-label
field, spinner, progress + shimmer, logos) defined unlayered in
`static/heroui.css`.

## Progressive enhancement & motion budget

- Entrance/exit animation never hides anything if JS dies: the CSS keyframes
  (`mlb-fade-up`, gated by `prefers-reduced-motion: no-preference`) run by
  themselves; the inline snippet in page.html's `script` block switches to
  `Motion.animate`-style takeover (`animation: none` via `.mlb-motion-on`)
  only after `window.Motion.animate` is confirmed callable, and removes the
  class (restoring the CSS path) if the try/catch trips.
- The `data-theme` seed script mirrors upstream `darkmode.js`:
  `jupyterhub-bs-theme` (localStorage) wins, otherwise
  `prefers-color-scheme: dark`; a `MutationObserver` on `data-bs-theme`
  follows the navbar toggle without touching `darkmode.js`.
- Spinner, shimmer and stagger (`--anim-i` × 60ms) are pure CSS, all inside
  the `no-preference` media query.

## Verification checklist

1. `npm run build` exits 0; `static/heroui.css` regenerated
   (~14 kB minified).
2. `Select-String` the built CSS for `@import`/`http://`/`https://` —
   must find 0 (only the three vendored static files are used by templates).
3. Tokens present: `--accent`, `--spacing`, `--surface-shadow`,
   `[data-theme=dark]`, `prefers-color-scheme` fallback,
   `prefers-reduced-motion` gates.
4. `cd build; python _upstream_test/validate.py` → `ALL CHECKS PASSED`
   (renders login/home/spawn_pending (both server states) through the real
   PrefixLoader chain and asserts upstream block names, ids, static URLs).
5. Manual on a deployed hub: light/dark toggle in navbar, login form,
   home server card, spawn page progress; `motion.js` and icons degrade
   with JS off.

## Reported gaps (do not edit `tokens/` here)

- No `--card-radius` token — we derive `--radius-card: calc(var(--radius) * 1.5)`.
- No `--font-sans` token — brand font stack is defined locally as `--font-hub`
  in the build input (README contract: Inter / ui-sans / system-ui).
- If more spacing/shadow levels are needed later, add them to
  `tokens/heroui-tokens.css` first, then reference `var(--token)` here.
