# Image build & publish

The project ships four OCI images. They are published to GitHub Container
Registry (GHCR); no AWS account is needed to build or pull them.

| Image | Dockerfile | Base | Purpose |
| --- | --- | --- | --- |
| `mlbox-dashboard` | `web/dashboard/Dockerfile` | `node:22-bookworm-slim` | Next.js dashboard |
| `mlbox-bff` | `web/bff/Dockerfile` | `node:22-bookworm-slim` | Cognito / JupyterHub BFF |
| `mlbox-cpu` | `images/cpu/Dockerfile` | `jupyter/base-notebook:latest` | single-user notebook, CPU |
| `mlbox-gpu` | `images/gpu/Dockerfile` | `quay.io/jupyter/pytorch-notebook:cuda12-latest` | single-user notebook, GPU |

All images are built from the repository root and target `linux/amd64` (the EKS
nodes are x86_64). No account-specific values are baked in: runtime settings come
from Terraform as Kubernetes env or Secrets.

The cpu/gpu notebook images carry the MLBox JupyterLab theme
(`@mlbox/jlab-heroui-theme`) as a prebuilt labextension, installed **offline**
from a wheel. The wheel is not committed; it is built from
`web/theme/lab/jlab-heroui-theme` (npm + pip). The runtime user stays non-root
(`jovyan`, uid 1000 for notebooks).

```
images/
├── cpu/Dockerfile          # CPU single-user image
├── gpu/Dockerfile          # GPU single-user image
└── lib/install-theme.sh    # shared install + verification step
scripts/
├── build-images.sh         # build / push all four images
└── README.md
```

## Automated publishing (recommended)

`.github/workflows/images.yml` builds all four images and pushes them to
`ghcr.io/<owner>/mlbox-<name>` on pushes to `master` and `v*.*.*` tags. Pull
requests build without pushing. Each image is tagged with:

- the full commit SHA (immutable; use this in Terraform),
- the branch name, and `latest` on the default branch,
- the semver version, for release tags.

Authentication uses the workflow's `GITHUB_TOKEN`; no extra secret is needed.

After the first push, make each package **public** in GitHub (package settings →
Change visibility), so other AWS accounts can pull without credentials. A private
package requires an `imagePullSecret` in the cluster.

## Local build

Requires Docker with Buildx (`docker buildx version`).

```bash
./scripts/build-images.sh                 # all four, loaded into local Docker
ONLY=cpu ./scripts/build-images.sh        # one image: dashboard | bff | cpu | gpu
TAG=v1.2.3 ./scripts/build-images.sh      # explicit tag
```

The default tag is `dev-<gitshortsha>` (`dev-latest` outside a git checkout).
The image prefix defaults to `ghcr.io/<owner>/mlbox-`, where the owner is read from
the `origin` remote; override with `IMAGE_PREFIX`.

Apple Silicon builds run `linux/amd64` through emulation, so they are slow.

## Push to GHCR

```bash
export GHCR_USER=<your-github-username>
export CR_PAT=<token-with-write:packages>   # classic PAT or fine-grained token
PUSH=1 ./scripts/build-images.sh
```

If `CR_PAT` is unset, the script assumes `docker login ghcr.io` was already run.

## Point Terraform at the images

Stacks `03-hub-app` and `04-dashboard` have no default image references. Set
them in each stack's `terraform.tfvars` (git-ignored), using the full commit SHA:

```hcl
# terraform/stacks/03-hub-app/terraform.tfvars
cpu_image = "ghcr.io/<owner>/mlbox-cpu:<40-char-sha>"
gpu_image = "ghcr.io/<owner>/mlbox-gpu:<40-char-sha>"

# terraform/stacks/04-dashboard/terraform.tfvars
dashboard_image = "ghcr.io/<owner>/mlbox-dashboard:<40-char-sha>"
bff_image       = "ghcr.io/<owner>/mlbox-bff:<40-char-sha>"
```

The values end up in `singleuser.profileList[].kubespawner_override.image` in
`terraform/stacks/03-hub-app/values/hub-values.yaml.tpl`.

Pulls from GHCR go through the NAT gateway, so the cluster needs egress: keep
`nat_mode` at `managed_per_az` or `fck_nat` in `01-foundation`. With `nat_mode = "none"`
the nodes have no IPv4 route to `ghcr.io`.

## GitHub Actions

| Workflow | State | Purpose |
| --- | --- | --- |
| `images.yml` | active | build and push the four images to GHCR |
| `deploy.yml.disabled` | disabled | production rollout of dashboard and BFF |

`deploy.yml.disabled` is kept until the production rollout is reopened. To reopen
it, rename it to `deploy.yml`, then complete the one-time setup:

1. In **Settings → Environments**, create `production`, add the production
   approvers as required reviewers, and restrict deployments to `master`.
2. In **Settings → Secrets and variables → Actions → Variables**, set
   `AWS_DEPLOY_ROLE_ARN` and `EKS_CLUSTER_NAME` to the values from
   `terraform/stacks/02-platform` (`github_deployer_role_arn`,
   `github_actions_cluster_name`). These are identifiers, not secrets.
3. Dispatch **Approved production rollout** from `master` with a full commit SHA
   that `images.yml` has already published, and confirm environment approval and
   both rollout statuses.

The deployer role trusts only the `production` environment subject. Do not broaden
it to wildcard repository or branch subjects.

## Verify

Inside the image:

```bash
docker run --rm ghcr.io/<owner>/mlbox-cpu:<tag> \
  jupyter labextension list | sed -E 's/\x1B\[[0-9;]*m//g'
```

Expected:

```
JupyterLab v4.4.2
/opt/conda/share/jupyter/labextensions
        jupyterlab_pygments v0.3.0 enabled OK (python, jupyterlab_pygments)
        @jupyter-notebook/lab-extension v7.0.6 enabled OK
        @mlbox/jlab-heroui-theme v0.1.0 enabled OK
```

The image build itself fails if the theme is not `enabled OK` or if the
`heroui-light` / `heroui-dark` plugins are missing from the shipped bundle, so a
successful build is the verification.

## Notes / gotchas

- **JupyterLab version.** The theme declares `"@jupyterlab/apputils": "^4.4.2"`.
  The stock `jupyter/base-notebook:latest` ships JupyterLab 4.0.7, where the
  extension is reported as *not compatible* and the browser refuses to load its
  plugins. The image build therefore upgrades JupyterLab to 4.4.2 (and
  `jupyterlab-pygments` to 0.3.0) when the base image is older.
  `images/lib/install-theme.sh` does it only when needed and fails the build if
  the extension is still incompatible.
- **Theme on disk.** The extension installs to
  `<sys-prefix>/share/jupyter/labextensions/@mlbox/jlab-heroui-theme` and is picked
  up automatically by JupyterLab 4 / Notebook 7 on the next server start.
- **Default theme.** The images ship the extension but do **not** force it as the
  default. To make HeroUI the fleet-wide default, add the `overrides.json` snippet
  from `web/theme/lab/jlab-heroui-theme/README.md` to
  `<home>/.jupyter/lab/user-settings/@jupyterlab/apputils-extension/overrides.json`
  in the image.
- **GPU runtime env.** The GPU image sets `TF_FORCE_GPU_ALLOW_GROWTH=true` and
  `XLA_PYTHON_CLIENT_PREALLOCATE=false`; the hub values set the same variables per
  pod (`singleuser.extraEnv`).
- **Usage history is opt-in.** Enable `enable_dashboard_usage_history=true` in
  stack 02 to provision the private PostgreSQL instance, then set
  `enable_usage_history=true` in stack 04. The DB has deletion protection and final
  snapshots; disabling history alone does not destroy the DB. Samples are recorded
  at most once per hour when an authenticated usage GET occurs; there is no
  background sampler. CPU-hours remain untracked. The DB URL is materialized into
  a Terraform-managed Kubernetes Secret, so protect both Terraform state backends.
