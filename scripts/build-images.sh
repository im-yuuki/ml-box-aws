#!/usr/bin/env bash
# MLBox — build (and optionally push to GHCR) the four images:
#   dashboard  web/dashboard/Dockerfile   (Next.js dashboard)
#   bff        web/bff/Dockerfile         (Cognito / JupyterHub BFF)
#   cpu        images/cpu/Dockerfile      (single-user notebook, CPU)
#   gpu        images/gpu/Dockerfile      (single-user notebook, GPU)
#
# Usage:
#   ./scripts/build-images.sh                      # all four, loaded into local Docker
#   ONLY=cpu ./scripts/build-images.sh             # one image
#   PUSH=1 CR_PAT=<token> GHCR_USER=<you> ./scripts/build-images.sh
#   TAG=v1.2.3 PUSH=1 ./scripts/build-images.sh    # explicit tag
#
# Environment variables:
#   IMAGE_PREFIX  image name prefix      (default ghcr.io/<owner>/mlbox-, owner from the git remote)
#   TAG           image tag              (default dev-<gitshortsha>, dev-latest outside a git repo)
#   PUSH          1 = push to GHCR, 0 = local only                    (default 0)
#   ONLY          all | dashboard | bff | cpu | gpu                   (default all)
#   PLATFORM      target platform        (default linux/amd64 — the EKS nodes are x86_64)
#   CR_PAT        GitHub token with write:packages (only with PUSH=1; optional if
#                 `docker login ghcr.io` was already run)
#   GHCR_USER     GitHub username used with CR_PAT
#   SKIP_WHEEL_BUILD  1 = fail instead of building the theme wheel when it is missing
#
# Notes:
#   * Images contain no account-specific configuration. Runtime settings come
#     from Terraform (Kubernetes env / Secrets), never from build arguments.
#   * The cpu/gpu images install the JupyterLab theme from a wheel that is not
#     committed. It is rebuilt with the theme's own build.sh when missing.
#   * The GitHub Actions pipeline (.github/workflows/images.yml) publishes the
#     same images on master and on v*.*.* tags; use this script for local builds.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

PUSH="${PUSH:-0}"
ONLY="${ONLY:-all}"
PLATFORM="${PLATFORM:-linux/amd64}"

THEME_DIR="web/theme/lab/jlab-heroui-theme"
WHEEL_DIR="${THEME_DIR}/dist"

# name:dockerfile — every image uses the repository root as build context.
IMAGES=(
  "dashboard:web/dashboard/Dockerfile"
  "bff:web/bff/Dockerfile"
  "cpu:images/cpu/Dockerfile"
  "gpu:images/gpu/Dockerfile"
)

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found in PATH"
docker buildx version >/dev/null 2>&1 || die "docker buildx not available"

# --- image prefix and tag --------------------------------------------------------
if [[ -z "${IMAGE_PREFIX:-}" ]]; then
  owner="$(git -C "${REPO_ROOT}" config --get remote.origin.url 2>/dev/null |
    sed -E 's#^.*[:/]([^/:]+)/[^/]+$#\1#' | tr '[:upper:]' '[:lower:]')"
  [[ -n "${owner}" ]] || die "cannot infer the GitHub owner; set IMAGE_PREFIX=ghcr.io/<owner>/mlbox-"
  IMAGE_PREFIX="ghcr.io/${owner}/mlbox-"
fi

if [[ -z "${TAG:-}" ]]; then
  if git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
    TAG="dev-$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
  else
    TAG="dev-latest"
  fi
fi

# --- theme wheel (cpu/gpu only) --------------------------------------------------
find_wheel() {
  # shellcheck disable=SC2012
  ls -1 "${WHEEL_DIR}"/jlab_heroui_theme-*.whl 2>/dev/null | head -n 1
}

ensure_wheel() {
  local wheel
  wheel="$(find_wheel || true)"
  if [[ -z "${wheel}" ]]; then
    [[ "${SKIP_WHEEL_BUILD:-0}" == "1" ]] && die "no theme wheel in ${WHEEL_DIR} (SKIP_WHEEL_BUILD=1)"
    log "theme wheel missing — building it with ${THEME_DIR}/build.sh"
    bash "${THEME_DIR}/build.sh"
    wheel="$(find_wheel || true)"
    [[ -n "${wheel}" ]] || die "the theme build produced no wheel in ${WHEEL_DIR}"
  fi
  log "theme wheel: ${wheel}"
}

# --- GHCR login (push only) ------------------------------------------------------
if [[ "${PUSH}" == "1" ]]; then
  if [[ -n "${CR_PAT:-}" ]]; then
    : "${GHCR_USER:?set GHCR_USER to your GitHub username}"
    log "logging in to ghcr.io as ${GHCR_USER}"
    printf '%s' "${CR_PAT}" | docker login ghcr.io --username "${GHCR_USER}" --password-stdin
  else
    log "CR_PAT not set — relying on an existing 'docker login ghcr.io'"
  fi
fi

# --- build -----------------------------------------------------------------------
build_image() {
  local name="$1" dockerfile="$2"
  local image="${IMAGE_PREFIX}${name}:${TAG}"
  local -a args=(
    docker buildx build
    --platform "${PLATFORM}"
    --file "${dockerfile}"
    --tag "${image}"
    --provenance=false
  )
  if [[ "${PUSH}" == "1" ]]; then
    args+=(--push)
  else
    args+=(--load)
  fi
  args+=("${REPO_ROOT}")

  log "building ${name} (${PLATFORM}) -> ${image}"
  "${args[@]}"
}

selected=0
for entry in "${IMAGES[@]}"; do
  name="${entry%%:*}"
  dockerfile="${entry#*:}"
  [[ "${ONLY}" == "all" || "${ONLY}" == "${name}" ]] || continue
  selected=$((selected + 1))
  if [[ "${name}" == "cpu" || "${name}" == "gpu" ]]; then
    ensure_wheel
  fi
  build_image "${name}" "${dockerfile}"
done
[[ "${selected}" -gt 0 ]] || die "ONLY must be one of: all, dashboard, bff, cpu, gpu (got '${ONLY}')"

# --- result ----------------------------------------------------------------------
log "image references"
for entry in "${IMAGES[@]}"; do
  name="${entry%%:*}"
  [[ "${ONLY}" == "all" || "${ONLY}" == "${name}" ]] || continue
  printf '    %s%s:%s\n' "${IMAGE_PREFIX}" "${name}" "${TAG}"
done
