#!/usr/bin/env bash
# ML Box — install the prebuilt HeroUI JupyterLab theme extension into a
# single-user notebook image (shared by images/cpu and images/gpu).
#
# Called from the Dockerfiles, never on a developer machine:
#
#   1. makes sure the image ships a JupyterLab the theme is compatible with
#      (the extension declares "@jupyterlab/apputils": "^4.4.2"; an older
#      JupyterLab reports the extension as incompatible and the browser then
#      refuses to load its plugins, so the themes never appear in
#      Settings > Theme);
#   2. pip-installs the theme wheel OFFLINE (--no-index --find-links) — the
#      wheel is vendored in the repository, nothing is fetched from PyPI;
#   3. verifies the extension is enabled AND compatible, and that both theme
#      plugins (heroui-light / heroui-dark) are part of the shipped bundle.
#
# Environment (set as build ARGs in the Dockerfiles):
#   WHEEL_DIR                     directory holding the wheel (default /tmp/wheels)
#   THEME_DIST_NAME               pip distribution name (default jlab-heroui-theme)
#   THEME_VERSION                 theme version (default 0.1.0)
#   THEME_PACKAGE                 labextension package name (default @mlbox/jlab-heroui-theme)
#   JUPYTERLAB_VERSION            minimum JupyterLab version (default 4.4.2)
#   JUPYTERLAB_PYGMENTS_VERSION   jupyterlab-pygments version (default 0.3.0)
#   JUPYTERHUB_VERSION            JupyterHub version the single-user image must
#                                 match (default 5.5.2 = the version shipped by
#                                 the Z2JH hub image quay.io/jupyterhub/k8s-hub:4.4.2)
set -euo pipefail

WHEEL_DIR="${WHEEL_DIR:-/tmp/wheels}"
THEME_DIST_NAME="${THEME_DIST_NAME:-jlab-heroui-theme}"
THEME_VERSION="${THEME_VERSION:-0.1.0}"
THEME_PACKAGE="${THEME_PACKAGE:-@mlbox/jlab-heroui-theme}"
JUPYTERLAB_VERSION="${JUPYTERLAB_VERSION:-4.4.2}"
JUPYTERLAB_PYGMENTS_VERSION="${JUPYTERLAB_PYGMENTS_VERSION:-0.3.0}"
JUPYTERHUB_VERSION="${JUPYTERHUB_VERSION:-5.5.2}"

# version_ge <a> <b> -> exit 0 when a >= b (numeric, tolerant of suffixes).
# Compares major.minor.patch: the theme needs @jupyterlab/apputils ^4.4.2, so
# a JupyterLab 4.4.0/4.4.1 base would still be incompatible.
version_ge() {
  python - "$1" "$2" <<'PY'
import re
import sys

key = lambda v: tuple(int(x) for x in re.findall(r"[0-9]+", v)[:3])
sys.exit(0 if key(sys.argv[1]) >= key(sys.argv[2]) else 1)
PY
}

# 1) JupyterLab -----------------------------------------------------------------
current_lab="$(python -c 'import jupyterlab; print(jupyterlab.__version__)' 2>/dev/null || echo 0.0.0)"
echo "==> JupyterLab in base image: ${current_lab}"
if version_ge "${current_lab}" "${JUPYTERLAB_VERSION}"; then
  echo "    keeping ${current_lab} (>= ${JUPYTERLAB_VERSION})"
else
  echo "==> installing JupyterLab ${JUPYTERLAB_VERSION} (the theme requires @jupyterlab/apputils ^4.4.2)"
  pip install --no-cache-dir "jupyterlab==${JUPYTERLAB_VERSION}"
fi

# jupyterlab-pygments is a prebuilt extension of the base image; its 0.2.x
# release is only compatible with JupyterLab < 4.1 and would be reported as
# incompatible once JupyterLab is upgraded.
current_pygments="$(python -c 'import importlib.metadata as m; print(m.version("jupyterlab-pygments"))' 2>/dev/null || echo 0.0.0)"
if version_ge "${current_pygments}" "${JUPYTERLAB_PYGMENTS_VERSION}"; then
  echo "==> keeping jupyterlab-pygments ${current_pygments}"
else
  echo "==> installing jupyterlab-pygments ${JUPYTERLAB_PYGMENTS_VERSION}"
  pip install --no-cache-dir "jupyterlab-pygments==${JUPYTERLAB_PYGMENTS_VERSION}"
fi

# 1b) JupyterHub ------------------------------------------------------------------
# The single-user server must run the SAME JupyterHub version as the Hub,
# otherwise the Hub refuses the user's request with
# "Redirect loop detected. Notebook has jupyterhub version X, but the Hub
# expects Y". The base image ships an old JupyterHub, so pin it here.
current_hub="$(python -c 'import importlib.metadata as m; print(m.version("jupyterhub"))' 2>/dev/null || echo 0.0.0)"
if [[ "${current_hub}" == "${JUPYTERHUB_VERSION}" ]]; then
  echo "==> keeping jupyterhub ${current_hub}"
else
  echo "==> installing jupyterhub ${JUPYTERHUB_VERSION} (hub image runs this version)"
  pip install --no-cache-dir "jupyterhub==${JUPYTERHUB_VERSION}"
fi

# Make the ML Box themes the fleet defaults. Without this override JupyterLab
# starts with its stock theme even though the HeroUI themes are installed.
JUPYTERLAB_APP_DIR="${JUPYTERLAB_DIR:-$(jupyter lab path | sed -n 's/^Application directory:[[:space:]]*//p')}"
if [[ -z "${JUPYTERLAB_APP_DIR}" ]]; then
  echo "ERROR: could not determine JupyterLab application directory" >&2
  exit 1
fi
mkdir -p "${JUPYTERLAB_APP_DIR}/settings"
cat > "${JUPYTERLAB_APP_DIR}/settings/overrides.json" <<'JSON'
{
  "@jupyterlab/apputils-extension:themes": {
    "adaptive-theme": true,
    "preferred-light-theme": "HeroUI Light",
    "preferred-dark-theme": "HeroUI Dark"
  }
}
JSON
echo "==> configured adaptive HeroUI Light/Dark as the default JupyterLab themes (follows OS preference)"

# 2) Theme wheel (offline) -------------------------------------------------------
echo "==> installing ${THEME_DIST_NAME}==${THEME_VERSION} from ${WHEEL_DIR} (offline, vendored wheel)"
pip install --no-index --find-links="${WHEEL_DIR}" "${THEME_DIST_NAME}==${THEME_VERSION}"
rm -rf "${WHEEL_DIR}"

pip check || echo "WARNING: pip check reported issues (see above) — not fatal for the theme" >&2

# 3) Verification ----------------------------------------------------------------
echo "==> jupyter labextension list"
labextension_list="$(jupyter labextension list 2>&1 | sed -E 's/\x1B\[[0-9;]*m//g')"
echo "${labextension_list}"

if ! echo "${labextension_list}" |
  grep -Eq "^[[:space:]]*${THEME_PACKAGE} v${THEME_VERSION} enabled OK$"; then
  echo "ERROR: ${THEME_PACKAGE} ${THEME_VERSION} is not enabled/compatible in this image" >&2
  echo "       (the browser refuses to load incompatible prebuilt extensions," >&2
  echo "        so the HeroUI themes would never show up in Settings > Theme)" >&2
  exit 1
fi

ext_dir="$(python -c 'import os, sysconfig; print(os.path.join(sysconfig.get_path("data"), "share", "jupyter", "labextensions", "@mlbox", "jlab-heroui-theme"))')"
for theme_plugin in heroui-light heroui-dark; do
  if ! grep -q "${theme_plugin}" "${ext_dir}"/static/*.js; then
    echo "ERROR: theme plugin ${theme_plugin} not found in ${ext_dir}/static" >&2
    exit 1
  fi
done

echo "==> OK: ${THEME_PACKAGE} ${THEME_VERSION} enabled (plugins: heroui-light, heroui-dark)"
