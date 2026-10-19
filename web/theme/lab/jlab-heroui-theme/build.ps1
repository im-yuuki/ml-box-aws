# ML Box — build script for @mlbox/jlab-heroui-theme (Windows)
#
# 1. npm install            (extension JS/CSS deps; needs node + npm)
# 2. ensure jupyterlab>=4   (pip; scripts/build.js probes its staging dir for
#                            the webpack --core-path)
# 3. build the labextension bundle -> labextension/   (npm run build:labextension)
# 4. python -m build --wheel -> dist/*.whl   (optional, -SkipWheel)
#
# Run: powershell -ExecutionPolicy Bypass -File build.ps1 [-SkipWheel]

param(
  [switch]$SkipWheel
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $here

try {
  Write-Host "==> npm install"
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

  & python -c "import jupyterlab" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "==> pip install jupyterlab (provide `jupyter labextension build` core-path)"
    python -m pip install "jupyterlab>=4,<5"
  }

  Write-Host "==> build labextension bundle (node scripts/build.js)"
  npm run build:labextension
  if ($LASTEXITCODE -ne 0) { throw "labextension build failed" }

  if (-not $SkipWheel) {
    Write-Host "==> python -m build --wheel"
    python -m build --wheel
    if ($LASTEXITCODE -ne 0) { throw "wheel build failed" }
  }
}
finally {
  Pop-Location
}
