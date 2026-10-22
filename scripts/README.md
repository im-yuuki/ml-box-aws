# Image build & publish (CPU / GPU single-user notebooks)

The JupyterHub single-user pods run two images:

| Flavour | Base image | Repo (ECR) |
| --- | --- | --- |
| CPU | `jupyter/base-notebook:latest` | `jhub-gpu-sandbox/cpu` |
| GPU | `quay.io/jupyter/pytorch-notebook:cuda12-latest` | `jhub-gpu-sandbox/gpu` |

Both are built from `images/cpu/Dockerfile` and `images/gpu/Dockerfile` and both
carry the ML Box JupyterLab theme (`@mlbox/jlab-heroui-theme`) as a prebuilt
labextension, installed **offline** from the wheel vendored in the repository
(`web/theme/lab/jlab-heroui-theme/dist/`). No secrets are baked into the images
and the runtime user stays non-root (`jovyan`, uid 1000).

The image build lives outside Terraform (handoff doc §8): Terraform only
creates the ECR repositories and points the hub at the resulting image URIs.

```
images/
├── cpu/Dockerfile          # CPU single-user image
├── gpu/Dockerfile          # GPU single-user image
└── lib/install-theme.sh    # shared install + verification step
scripts/
├── build-images.sh         # build / push
└── README.md
```

## Prerequisites

- Docker with Buildx (`docker buildx version`).
- AWS CLI with credentials for the target account — **only needed to push**
  (`PUSH=1`); a local build does not touch AWS.
- The theme wheel. `build-images.sh` uses
  `web/theme/lab/jlab-heroui-theme/dist/jlab_heroui_theme-0.1.0-py3-none-any.whl`
  and rebuilds it with the theme's own `build.sh` (npm + pip) when missing.
  Set `SKIP_WHEEL_BUILD=1` to fail instead of rebuilding.

## Build (local, no AWS access)

```bash
./scripts/build-images.sh                 # both flavours, loaded into local Docker
ONLY=cpu ./scripts/build-images.sh        # one flavour
TAG=v1.2.3 ./scripts/build-images.sh     # explicit tag
```

The default tag is `dev-<gitshortsha>` (`dev-latest` outside a git checkout).
Images are built for `linux/amd64` because the EKS nodes are x86_64 — on an
Apple Silicon machine the build runs through emulation, so it is slow.

Without `PUSH=1` the images are only loaded into the local Docker image store
(`jhub-gpu-sandbox/cpu:<tag>`, `jhub-gpu-sandbox/gpu:<tag>`).

## Push to ECR

The ECR repositories are created by Terraform
(`terraform/modules/ecr`, applied by `terraform/stacks/03-platform`), so apply the
hub stack once before the first push.

```bash
PUSH=1 ./scripts/build-images.sh
```

This runs `aws ecr get-login-password` against
`451058046864.dkr.ecr.ap-southeast-2.amazonaws.com` and pushes:

```
451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/cpu:<tag>
451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/gpu:<tag>
```

Override `AWS_ACCOUNT_ID`, `AWS_REGION`, `ECR_REGISTRY` or `IMAGE_NAMESPACE`
if the repos live elsewhere (`IMAGE_NAMESPACE` must match the ECR repository
names created by Terraform).

## Point Terraform at the images

`terraform/stacks/04-hub-app/variables.tf` exposes `cpu_image` and `gpu_image`
(defaults: the public base images). Set them to the ECR URIs:

```bash
cd terraform/stacks/04-hub-app
terraform init
terraform apply \
  -var="cpu_image=451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/cpu:dev-fa3b6fa" \
  -var="gpu_image=451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/gpu:dev-fa3b6fa"
```

or put the same two values in `terraform/stacks/04-hub-app/terraform.tfvars`
(git-ignored) and run a plain `terraform apply`. The values end up in
`singleuser.profileList[].kubespawner_override.image` in
`values/hub-values.yaml.tpl`.

The GPU profile additionally needs the image to be pullable by the EKS node
role: the Karpenter node role attaches `AmazonEC2ContainerRegistryPullOnly`
(`terraform/modules/karpenter/node-role.tf`), which covers
`ecr:GetAuthorizationToken`, `ecr:BatchGetImage` and
`ecr:GetDownloadUrlForLayer` on these repositories.

## Verify

Inside the image:

```bash
docker run --rm jhub-gpu-sandbox/cpu:dev-fa3b6fa \
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

In a running pod:

```bash
kubectl -n hub exec deploy/hub -c hub -- true   # hub pod
kubectl -n hub run tmp --rm -it --image=<image-uri> --restart=Never -- jupyter labextension list
```

## Notes / gotchas

- **JupyterLab version.** The theme declares `"@jupyterlab/apputils": "^4.4.2"`.
  The stock `jupyter/base-notebook:latest` ships JupyterLab 4.0.7, where the
  extension is reported as *not compatible* and the browser refuses to load its
  plugins — the themes then never appear in Settings → Theme. The image build
  therefore upgrades JupyterLab to 4.4.2 (and `jupyterlab-pygments` to 0.3.0,
  whose 0.2.x release is only compatible with JupyterLab < 4.1) when the base
  image is older. `images/lib/install-theme.sh` does it only when needed and
  fails the build if the extension still ends up incompatible.
- **Theme on disk.** The extension installs to
  `<sys-prefix>/share/jupyter/labextensions/@mlbox/jlab-heroui-theme` and is
  picked up automatically by JupyterLab 4 / Notebook 7 on the next server start.
- **Default theme.** The images ship the extension but do **not** force it as
  the default; to make HeroUI the fleet-wide default, drop the
  `overrides.json` snippet from `web/theme/lab/jlab-heroui-theme/README.md` into
  `<home>/.jupyter/lab/user-settings/@jupyterlab/apputils-extension/overrides.json`
  in the image.
- **GPU runtime env.** The GPU image sets `TF_FORCE_GPU_ALLOW_GROWTH=true` and
  `XLA_PYTHON_CLIENT_PREALLOCATE=false` (handoff doc §8); the hub values set the
  same variables per pod (`singleuser.extraEnv`).
