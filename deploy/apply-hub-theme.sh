#!/usr/bin/env bash
# Deploy the ML Box theme into the running JupyterHub.
#
# Creates/updates the two ConfigMaps the hub Deployment mounts (see
# terraform/stacks/03-hub-app/values/hub-values.yaml.tpl -> hub.extraVolumes):
#   hub-theme-templates -> /etc/jupyterhub/custom/templates  (Jinja overrides)
#   hub-theme-static    -> /usr/local/share/jupyterhub/static/heroui  (served at
#                                                                  /hub/static/heroui/...)
#
# Usage:
#   deploy/apply-hub-theme.sh [--context <kube-context>] [--namespace hub] [--no-restart]
#
# The hub Deployment reads ConfigMap volumes at pod start, so a rollout restart is
# needed after the ConfigMaps change. The script restarts it unless --no-restart.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
THEME_DIR="$REPO_ROOT/web/theme/hub"
CONTEXT=""
NAMESPACE="hub"
RESTART=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --context)   CONTEXT="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --no-restart) RESTART=0; shift ;;
    -h|--help)   sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

KUBECTL=(kubectl)
if [[ -n "$CONTEXT" ]]; then
  KUBECTL+=(--context "$CONTEXT")
fi

command -v kubectl >/dev/null || { echo "kubectl not found" >&2; exit 1; }

for dir in "$THEME_DIR/templates" "$THEME_DIR/static"; do
  [[ -d "$dir" ]] || { echo "missing theme dir: $dir" >&2; exit 1; }
done

echo "==> applying theme ConfigMaps into namespace ${NAMESPACE}"
"${KUBECTL[@]}" -n "$NAMESPACE" create configmap hub-theme-templates \
  --from-file="$THEME_DIR/templates" --dry-run=client -o yaml | \
  "${KUBECTL[@]}" -n "$NAMESPACE" apply -f -
"${KUBECTL[@]}" -n "$NAMESPACE" create configmap hub-theme-static \
  --from-file="$THEME_DIR/static" --dry-run=client -o yaml | \
  "${KUBECTL[@]}" -n "$NAMESPACE" apply -f -

if [[ "$RESTART" -eq 1 ]]; then
  echo "==> restarting hub deployment to pick up the new ConfigMaps"
  "${KUBECTL[@]}" -n "$NAMESPACE" rollout restart deployment/hub
  "${KUBECTL[@]}" -n "$NAMESPACE" rollout status deployment/hub --timeout=300s
fi

echo "==> verify"
cat <<'EOF'
  kubectl -n hub exec deploy/hub -c hub -- ls /etc/jupyterhub/custom/templates
  kubectl -n hub exec deploy/hub -c hub -- ls /usr/local/share/jupyterhub/static/heroui
  kubectl -n hub exec deploy/hub -c hub -- \
    grep -nE "template_paths|template_vars|logo_file" /usr/local/etc/jupyterhub/jupyterhub_config.py
  # browser: /hub/login , /hub/home , /hub/logo
EOF
