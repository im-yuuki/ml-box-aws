#!/usr/bin/env bash
# ML Box — build (and optionally push) the CPU / GPU single-user notebook
# images that carry the ML Box JupyterLab theme (@mlbox/jlab-heroui-theme).
#
# Usage:
#   ./scripts/build-images.sh                     # build both, load into local Docker
#   PUSH=1 ./scripts/build-images.sh              # build both and push to ECR
#   ONLY=gpu ./scripts/build-images.sh            # build a single flavour
#   TAG=v1.2.3 PUSH=1 ./scripts/build-images.sh   # explicit tag
#
# Environment variables:
#   AWS_ACCOUNT_ID   AWS account that owns the ECR repos   (default 451058046864)
#   AWS_REGION       region of the ECR repos               (default ap-southeast-2)
#   ECR_REGISTRY     registry host                         (default ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com)
#   IMAGE_NAMESPACE  ECR repo namespace                    (default jhub-gpu-sandbox)
#                    MUST match the ECR repositories created by terraform/modules/ecr
#   TAG              image tag                             (default dev-<gitshortsha>, dev-latest outside a git repo)
#   PUSH             1 = push to ECR, 0 = local only       (default 0)
#   ONLY             all | cpu | gpu                       (default all)
#   PLATFORM         target platform                       (default linux/amd64 — the EKS nodes are x86_64)
#   CACHE_FROM       optional buildx --cache-from value
#   CACHE_TO         optional buildx --cache-to value
#
# Notes:
#   * The ECR repositories must already exist (terraform/stacks/02-platform applies
#     terraform/modules/ecr) before PUSH=1 works.
#   * `aws ecr get-login-password` is only called when PUSH=1, so a local build
#     needs no AWS credentials.
#   * The theme wheel is expected under web/theme/lab/jlab-heroui-theme/dist.
#     If it is missing it is rebuilt with the theme's own build.sh (npm + pip).
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-451058046864}"
AWS_REGION="${AWS_REGION:-ap-southeast-2}"
ECR_REGISTRY="${ECR_REGISTRY:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-jhub-gpu-sandbox}"
PUSH="${PUSH:-0}"
ONLY="${ONLY:-all}"
PLATFORM="${PLATFORM:-linux/amd64}"

THEME_DIR="web/theme/lab/jlab-heroui-theme"
WHEEL_DIR="${THEME_DIR}/dist"

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found in PATH"
docker buildx version >/dev/null 2>&1 || die "docker buildx not available"

# --- tag -------------------------------------------------------------------------
if [[ -z "${TAG:-}" ]]; then
  if git -C "${REPO_ROOT}" rev-parse --git-dir >/dev/null 2>&1; then
    TAG="dev-$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
  else
    TAG="dev-latest"
  fi
fi

# --- theme wheel -----------------------------------------------------------------
find_wheel() {
  # shellcheck disable=SC2012
  ls -1 "${WHEEL_DIR}"/jlab_heroui_theme-*.whl 2>/dev/null | head -n 1
}

WHEEL="$(find_wheel || true)"
if [[ -z "${WHEEL}" ]]; then
  if [[ "${SKIP_WHEEL_BUILD:-0}" == "1" ]]; then
    die "no theme wheel in ${WHEEL_DIR} (SKIP_WHEEL_BUILD=1)"
  fi
  log "theme wheel missing — building it with ${THEME_DIR}/build.sh"
  "${THEME_DIR}/build.sh"
  WHEEL="$(find_wheel || true)"
  [[ -n "${WHEEL}" ]] || die "the theme build produced no wheel in ${WHEEL_DIR}"
fi
log "theme wheel: ${WHEEL}"

# --- ECR login (push only) -------------------------------------------------------
if [[ "${PUSH}" == "1" ]]; then
  command -v aws >/dev/null 2>&1 || die "aws CLI not found in PATH (needed for the ECR login)"
  log "logging in to ${ECR_REGISTRY}"
  aws ecr get-login-password --region "${AWS_REGION}" |
    docker login --username AWS --password-stdin "${ECR_REGISTRY}"
else
  log "PUSH!=1 — building locally, no ECR login"
fi

# --- build -----------------------------------------------------------------------
build_image() {
  local flavour="$1"
  local dockerfile="images/${flavour}/Dockerfile"
  local local_tag="${IMAGE_NAMESPACE}/${flavour}:${TAG}"
  local ecr_tag="${ECR_REGISTRY}/${IMAGE_NAMESPACE}/${flavour}:${TAG}"
  # With --push, buildx pushes EVERY tag in the manifest - so the local
  # (docker.io) tag must only exist in the --load path, otherwise the build
  # fails with "insufficient_scope" against docker.io.
  local -a args=(
    docker buildx build
    --platform "${PLATFORM}"
    --file "${dockerfile}"
    --tag "${ecr_tag}"
    # keep the ECR tag list clean (no extra provenance manifest)
    --provenance=false
  )

  if [[ "${PUSH}" == "1" ]]; then
    args+=(--push)
  else
    args+=(--tag "${local_tag}" --load)
  fi
  [[ -n "${CACHE_FROM:-}" ]] && args+=(--cache-from "${CACHE_FROM}")
  [[ -n "${CACHE_TO:-}" ]] && args+=(--cache-to "${CACHE_TO}")
  args+=("${REPO_ROOT}")

  log "building ${flavour} (${PLATFORM})"
  "${args[@]}"
}

BUILT_FLAVOURS=()
case "${ONLY}" in
  all)
    build_image cpu
    BUILT_FLAVOURS+=(cpu)
    build_image gpu
    BUILT_FLAVOURS+=(gpu)
    ;;
  cpu | gpu)
    build_image "${ONLY}"
    BUILT_FLAVOURS+=("${ONLY}")
    ;;
  *)
    die "ONLY must be one of: all, cpu, gpu (got '${ONLY}')"
    ;;
esac

# --- result ----------------------------------------------------------------------
log "resulting image URIs"
for flavour in "${BUILT_FLAVOURS[@]}"; do
  if [[ "${PUSH}" == "1" ]]; then
    printf '    %s/%s/%s:%s\n' "${ECR_REGISTRY}" "${IMAGE_NAMESPACE}" "${flavour}" "${TAG}"
  else
    printf '    %s/%s:%s  (local)\n' "${IMAGE_NAMESPACE}" "${flavour}" "${TAG}"
    printf '      ECR URI once pushed: %s/%s/%s:%s\n' \
      "${ECR_REGISTRY}" "${IMAGE_NAMESPACE}" "${flavour}" "${TAG}"
  fi
done
