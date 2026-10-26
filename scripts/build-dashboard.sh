#!/usr/bin/env bash
# Build the Next.js dashboard and the internal BFF image.
#
# Usage:
#   NEXT_PUBLIC_COGNITO_USER_POOL_ID=... NEXT_PUBLIC_COGNITO_CLIENT_ID=... \
#     ./scripts/build-dashboard.sh
#   PUSH=1 NEXT_PUBLIC_COGNITO_USER_POOL_ID=... \
#     NEXT_PUBLIC_COGNITO_CLIENT_ID=... ./scripts/build-dashboard.sh
#
# The dashboard receives public Cognito identifiers at build time. The BFF
# receives all secrets at runtime from the Kubernetes Secret created by the
# 04-dashboard stack; no secret is passed as a Docker build argument.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-451058046864}"
AWS_REGION="${AWS_REGION:-ap-southeast-2}"
ECR_REGISTRY="${ECR_REGISTRY:-${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:-jhub-gpu-sandbox}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUSH="${PUSH:-0}"
NEXT_PUBLIC_BFF_BASE_URL="${NEXT_PUBLIC_BFF_BASE_URL:-https://mlbox.june8th.me/api/bff}"

if [[ -z "${TAG:-}" ]]; then
  TAG="dev-$(git rev-parse --short HEAD)"
fi

: "${NEXT_PUBLIC_COGNITO_USER_POOL_ID:?set NEXT_PUBLIC_COGNITO_USER_POOL_ID from 02-platform output}"
: "${NEXT_PUBLIC_COGNITO_CLIENT_ID:?set NEXT_PUBLIC_COGNITO_CLIENT_ID from 02-platform output}"

command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found in PATH" >&2; exit 1; }
docker buildx version >/dev/null 2>&1 || { echo "ERROR: docker buildx not available" >&2; exit 1; }

if [[ "${PUSH}" == "1" ]]; then
  command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI not found in PATH" >&2; exit 1; }
  aws ecr get-login-password --region "${AWS_REGION}" |
    docker login --username AWS --password-stdin "${ECR_REGISTRY}"
fi

build_image() {
  local name="$1"
  local dockerfile="$2"
  local image="${ECR_REGISTRY}/${IMAGE_NAMESPACE}/${name}:${TAG}"
  local local_image="${IMAGE_NAMESPACE}/${name}:${TAG}"
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
    args+=(--tag "${local_image}" --load)
  fi

  if [[ "${name}" == "dashboard" ]]; then
    args+=(
      --build-arg "NEXT_PUBLIC_COGNITO_REGION=${AWS_REGION}"
      --build-arg "NEXT_PUBLIC_COGNITO_USER_POOL_ID=${NEXT_PUBLIC_COGNITO_USER_POOL_ID}"
      --build-arg "NEXT_PUBLIC_COGNITO_CLIENT_ID=${NEXT_PUBLIC_COGNITO_CLIENT_ID}"
      --build-arg "NEXT_PUBLIC_BFF_BASE_URL=${NEXT_PUBLIC_BFF_BASE_URL}"
    )
  fi

  args+=("${REPO_ROOT}")
  echo "==> building ${name}:${TAG}"
  "${args[@]}"
  echo "    ${image}"
}

build_image dashboard web/dashboard/Dockerfile
build_image bff web/bff/Dockerfile
