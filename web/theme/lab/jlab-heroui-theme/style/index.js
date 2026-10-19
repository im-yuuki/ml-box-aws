/* ============================================================================
 * ML Box — HeroUI theme for JupyterLab 4 / Notebook 7
 *
 * Registers TWO theme plugins:
 *   - "@mlbox/jlab-heroui-theme:heroui-light" → "HeroUI Light" (isLight: true)
 *   - "@mlbox/jlab-heroui-theme:heroui-dark"  → "HeroUI Dark"  (isLight: false)
 *
 * Both themes are CSS-only (the in-repo CSS files are plain stylesheets; no
 * JS ever touches Lumino DOM). The plugin JS contains no styles of its own.
 *
 * CSS loading follows the stock JupyterLab pattern (same as
 * @jupyterlab/theme-light-extension and jupyterlab-contrib themes):
 * package.json declares `jupyterlab.themePath: "style/theme.css"`, the
 * @jupyterlab/builder build extracts it to
 *   labextension/themes/@mlbox/jlab-heroui-theme/index.css
 * and the ThemeManager loads it as a plain <link> resolved against the
 * application's themes URL when the theme is activated/switched. This is also
 * what makes switching themes (Settings → Theme) work with zero extra code:
 * the manager unloads the previous link and loads the new one.
 *
 * The `isLight` flags give the pair `preferred-theme` semantics identical to
 * the stock JupyterLab light/dark pair: when "adaptive theme"
 * (Synchronize with System Settings) is on, the system color scheme light
 * picks the preferred LIGHT theme (initially "HeroUI Light") and dark picks
 * the preferred DARK one; `lightThemes`/`darkThemes` menus list them
 * correctly. Nothing else is needed — LabApp/Z2JH sets "HeroUI Light" as
 * essentially the active theme whenever the system scheme is light and the
 * user has not chosen otherwise, exactly like "JupyterLab Light".
 * ==========================================================================*/

import { IThemeManager } from '@jupyterlab/apputils';

/**
 * Theme names as shown in Settings → Theme and stored in user settings.
 */
export const LIGHT_THEME_NAME = 'HeroUI Light';
export const DARK_THEME_NAME = 'HeroUI Dark';

/**
 * Path of the theme stylesheet, relative to the application themes URL.
 * Matches the `themePath` build output of @jupyterlab/builder.
 */
const THEME_CSS = '@mlbox/jlab-heroui-theme/index.css';

/**
 * HeroUI Light plugin.
 */
const herouiLight = {
  id: '@mlbox/jlab-heroui-theme:heroui-light',
  description: 'ML Box HeroUI light theme.',
  requires: [IThemeManager],
  autoStart: true,
  activate: (_app, manager) => {
    manager.register({
      name: LIGHT_THEME_NAME,
      displayName: 'HeroUI Light',
      isLight: true,
      themeScrollbars: true,
      load: () => manager.loadCSS(THEME_CSS),
      unload: () => Promise.resolve()
    });
  }
};

/**
 * HeroUI Dark plugin.
 */
const herouiDark = {
  id: '@mlbox/jlab-heroui-theme:heroui-dark',
  description: 'ML Box HeroUI dark theme.',
  requires: [IThemeManager],
  autoStart: true,
  activate: (_app, manager) => {
    manager.register({
      name: DARK_THEME_NAME,
      displayName: 'HeroUI Dark',
      isLight: false,
      themeScrollbars: true,
      load: () => manager.loadCSS(THEME_CSS),
      unload: () => Promise.resolve()
    });
  }
};

export default [herouiLight, herouiDark];
