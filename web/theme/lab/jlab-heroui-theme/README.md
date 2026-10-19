# @mlbox/jlab-heroui-theme

Prebuilt **JupyterLab 4 / Notebook 7 theme extension** implementing the
[HeroUI](https://heroui.com) v3 design language for **ML Box**.
CSS-only — it registers two ThemeManager themes and never touches Lumino DOM.

| Theme (Settings → Theme) | Plugin ID | isLight |
| ------------------------ | --------- | ------- |
| `HeroUI Light`           | `@mlbox/jlab-heroui-theme:heroui-light` | `true`  |
| `HeroUI Dark`            | `@mlbox/jlab-heroui-theme:heroui-dark`  | `false` |

Both themes load the same extracted stylesheet
(`labextension/themes/@mlbox/jlab-heroui-theme/index.css`); the active theme is
selected by `body[data-jp-theme-name='…']`, which JupyterLab's ThemeManager
sets automatically — light and dark blocks cannot leak into each other.

## Install

The wheel is a pure-data prebuilt labextension (no Python code). It installs
`labextension/` to `share/jupyter/labextensions/@mlbox/jlab-heroui-theme` (the
directory mirrors the npm package name because jupyterlab_server builds the
runtime extension URL from it), which both
JupyterLab 4 and Notebook 7 (via `jupyterlab` >= 4 packages) pick up
automatically on the next server start.

```bash
# inside the cpu/gpu image build (after jupyterlab is installed)
pip install <path-to>/jlab_heroui_theme-0.1.0-py3-none-any.whl
```

Or point the wheel at Z2JH via `singleuser.extraLabExtensions`:

```yaml
singleuser:
  extraLabExtensions:
    - <path-to>/jlab_heroui_theme-0.1.0-py3-none-any.whl
```

## Theme switching

In JupyterLab 4 / Notebook 7: **Settings → Theme → HeroUI Light / HeroUI
Dark** (or the command palette, "Use Theme: …").

Because each theme carries the correct `isLight` flag, standard behavior
applies — exactly like the stock `JupyterLab Light` / `JupyterLab Dark` pair:

- **Settings → Synchronize with System Settings** (adaptive theme): when the
  system color scheme is light, the *preferred light theme*
  (`HeroUI Light` by default) is applied; dark → preferred dark theme.
- Set via `overrides.json` to make HeroUI the fleet-wide default in images:

```json
{
  "@jupyterlab/apputils-extension:themes": {
    "theme": "HeroUI Dark",
    "preferred-light-theme": "HeroUI Light",
    "preferred-dark-theme": "HeroUI Dark"
  }
}
```

## Build

```bash
npm install
npm run build          # = clean + jupyter labextension build .
```

`jupyter labextension build .` requires `jupyterlab >= 4` (the wheel provides
the core package + `--core-path`). Or, in one line:

```bash
pip install jupyterlab && jlpm install && jupyter labextension build .
```

There is no `jlpm` on this machine — plain `npm install` works the same.

Then optionally build the wheel (pure data; needs any Python >= 3.9):

```bash
python -m pip install build
python -m build --wheel        # → dist/jlab_heroui_theme-*.whl
```

`build.ps1` / `build.sh` wrap the whole chain (npm → labextension → wheel).

## Token mapping

Single source of truth: `web/theme/tokens/heroui-tokens.css`. Inside the
extension, HeroUI tokens are consumed as `var(--token)` and mapped onto
JupyterLab's public `--jp-*` API. Only token references and
`color-mix()`/`rgba()` mixes of token colors are used — no new raw colors.

| HeroUI token(s) | → `--jp-*` variable(s) |
| --------------- | ---------------------- |
| `--background`, `--surface`, `--surface-secondary`, `--surface-tertiary` | `--jp-layout-color0` … `--jp-layout-color3` (`color4` = token mix) |
| `--foreground` (+ alpha mixes) | `--jp-inverse-layout-color0..4`, `--jp-ui-font-color0..3`, `--jp-content-font-color0..3` |
| `--accent-foreground`, `--eclipse` | `--jp-ui-inverse-font-color0..3` |
| `--link`, `--accent` | `--jp-content-link-color`, `--jp-content-link-hover-color`, hover/visited mixes |
| `--border`, `--separator`, `--field-border` | `--jp-border-color0..3`, `--jp-inverse-border-color` |
| `--accent` family | `--jp-brand-color0..4`, `--jp-accent-color`, `--jp-accent-color0..3`, `--jp-accept-color-*`, editor cursor/focus/selection tints |
| `--success` / `--warning` / `--danger` | `--jp-success-color0..3` / `--jp-warn-color0..3` / `--jp-error-color0..3` |
| — (`--info` does not exist in the tokens file) | `--jp-info-color0..3` mapped onto the accent family (documented fallback — HeroUI's "info" is the same blue as the accent) |
| `--field-background`, `--field-border`, `--field-shadow`, `--focus` | `--jp-input-*`, `--jp-cell-editor-*`, active cell accent left border |
| `--backdrop` | `--jp-dialog-background` |
| `--surface-shadow`, `--overlay-shadow` | `--jp-elevation-z0..z24`, `--jp-toolbar-box-shadow` |
| `--radius`, `--field-radius` | `--jp-border-radius` (loaders/cards), scrollbar radius |
| `--border-width` | `--jp-border-width` |
| `--muted`/`--foreground` + `color-mix` | scrollbars (`scrollbar-*`, `::-webkit-scrollbar-*`), search matches, collaborator colors, CodeMirror syntax palette |

Fonts (documented constants — the tokens file has no font tokens):

| Constant | → `--jp-*` variable(s) |
| -------- | ---------------------- |
| HeroUI sans stack (`Inter`, ui-sans-serif, system-ui…) | `--jp-ui-font-family`, `--jp-content-font-family` |
| HeroUI mono stack (ui-monospace, SFMono, Menlo, Consolas…) | `--jp-code-font-family(-default)` |

Component styling is intentionally light-touch (colors/borders/transitions
only, Lumino layout untouched): command palette (accent left border on the
active/hovered item), launcher cards, status bar (surface + hairline),
cell editor backgrounds, active-cell accent border, scrollbars.

## Self-contained duplication note

JupyterLab themes must run wherever the built stylesheet lands (a single
extracted `<link>` under `labextension/themes/…` — and, for a wheel install,
inside `site-packages`), so the extension **cannot `@import` the repo-level
`web/theme/tokens/heroui-tokens.css`**: that path does not exist for an
installed labextension.

Therefore each theme file declares its own copy of the HeroUI primitives and
its mode's semantic tokens, copied **verbatim** from the tokens file:

- `style/light/theme.css` — primitives + `2a. Semantic — LIGHT` block
- `style/dark/theme.css`  — primitives + `2b. Semantic — DARK` block
- `style/index.css`       — non-color primitives (`--radius`, `--field-radius`,
  `--border-width`) and motion (`--ease-out`, `--duration-fast`)

When `web/theme/tokens/heroui-tokens.css` changes, update these three places
together. `style/theme.css` is only the build entry (`jupyterlab.themePath`)
that inlines all three into one self-contained stylesheet for the build.

Only tokens actually referenced by `--jp-*` mappings are duplicated (the
tokens file's unused entries are not copied); `--info` colors are an
accent-family fallback as noted in the mapping table.

## Motion

All transitions go through one plumbing token (`--heroui-transition`:
`color/background-color/border-color, 150ms, ease-out`) and are disabled
under `prefers-reduced-motion: reduce`. No layout-affecting animation.
