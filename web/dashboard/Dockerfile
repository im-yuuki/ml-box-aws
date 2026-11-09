# MLBox — Dashboard (Next.js) image.
#
# Multi-stage: build with `npm run build`, then copy the standalone output
# into a slim runtime image.
#
# The image is account-agnostic: no NEXT_PUBLIC_* values are baked in. Cognito
# and BFF settings are read from the environment when the container starts.
#
# Build context: repository root.
#
#   docker buildx build --platform linux/amd64 \
#     -f web/dashboard/Dockerfile \
#     --tag ghcr.io/<owner>/mlbox-dashboard:<sha> .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY web/dashboard/package.json web/dashboard/package-lock.json* ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY web/dashboard/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
USER nextjs
EXPOSE 3000
CMD ["npm", "start"]
