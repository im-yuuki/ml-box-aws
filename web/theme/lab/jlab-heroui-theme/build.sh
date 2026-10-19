#!/usr/bin/env bash
# ML Box — build script for @mlbox/jlab-heroui-theme (Linux/macOS, e.g. the
# cpu/gpu image build). Mirrors build.ps1:
#   npm install → ensure jupyterlab>=4 → npm run build:labextension (needs the
#   pip jupyterlab staging dir as webpack --core-path)
#   → (unless SKIP_WHEEL=1) python -m build --wheel
set -euo pipefail
cd "$(dirname "$0")"

echo "==> npm install"
npm install --no-fund --no-audit

if ! python -c "import jupyterlab" >/dev/null 2>&1; then
  echo "==> pip install jupyterlab (provides 'jupyter labextension build' core-path)"
  python -m pip install "jupyterlab>=4,<5"
fi

echo "==> build labextension bundle (node scripts/build.js)"
npm run build:labextension

if [[ "${SKIP_WHEEL:-0}" != "1" ]]; then
  echo "==> python -m build --wheel"
  python -m build --wheel
fi
