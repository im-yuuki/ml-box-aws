# ML Box — CPU single-user notebook image (JupyterHub on EKS).
#
# Base: jupyter/base-notebook:latest (JupyterLab 4.x, non-root user `jovyan`).
# Adds the ML Box JupyterLab theme (@mlbox/jlab-heroui-theme) as a prebuilt
# labextension, installed offline from the wheel vendored in this repository.
#
# Build context = repository root (the wheel lives under web/theme/...):
#
#   docker buildx build --platform linux/amd64 -f images/cpu/Dockerfile .
#
# See scripts/build-images.sh for the build/push flow and scripts/README.md for
# how to point Terraform at the resulting image.
#
# The image carries no secrets and keeps the base image's non-root user.

ARG BASE_IMAGE=jupyter/base-notebook:latest
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="mlbox-jhub-cpu" \
      org.opencontainers.image.description="CPU single-user notebook image for the ML Box JupyterHub on EKS, with the HeroUI JupyterLab theme" \
      org.opencontainers.image.source="https://github.com/mlbox/ml-box-aws" \
      org.opencontainers.image.licenses="MIT"

# Theme extension coordinates (pip distribution name != labextension package name).
ARG THEME_DIST_NAME="jlab-heroui-theme"
ARG THEME_VERSION="0.1.0"
ARG THEME_PACKAGE="@mlbox/jlab-heroui-theme"
# Minimum JupyterLab version the theme was built against (@jupyterlab/apputils ^4.4.2).
ARG JUPYTERLAB_VERSION="4.4.2"
ARG JUPYTERLAB_PYGMENTS_VERSION="0.3.0"
# JupyterHub version of the single-user server. MUST match the Hub (Z2JH chart
# 4.4.2 ships quay.io/jupyterhub/k8s-hub:4.4.2 = JupyterHub 5.5.2), otherwise
# the Hub answers with "Redirect loop detected".
ARG JUPYTERHUB_VERSION="5.5.2"
# Wheel to install, relative to the build context (repository root).
ARG THEME_WHEEL="web/theme/lab/jlab-heroui-theme/dist/jlab_heroui_theme-0.1.0-py3-none-any.whl"

# pip needs root; the runtime user is restored to non-root at the end.
USER root

COPY images/lib/install-theme.sh /tmp/install-theme.sh
COPY ${THEME_WHEEL} /tmp/wheels/

RUN bash /tmp/install-theme.sh && rm -f /tmp/install-theme.sh

# Back to the base image's non-root user (jovyan, uid 1000).
USER 1000
WORKDIR /home/jovyan
