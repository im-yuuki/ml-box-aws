# MLBox admin console — read-only operations dashboard for a single administrator.
# Build context: repository root.
#
#   ui stage      web/admin/ui   Next.js static export (HeroUI, shared design tokens) -> /ui/out
#   builder stage web/admin      Fastify backend (TypeScript) -> /app/dist
#   runner stage  backend + exported UI served from ./public

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS ui-deps
WORKDIR /ui
COPY web/admin/ui/package.json web/admin/ui/package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS ui-builder
WORKDIR /ui
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=ui-deps /ui/node_modules ./node_modules
COPY web/admin/ui/package.json web/admin/ui/tsconfig.json web/admin/ui/next.config.ts ./
COPY web/admin/ui/src ./src
RUN npm run build

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY web/admin/package.json web/admin/package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/admin/package.json web/admin/tsconfig.json ./
COPY web/admin/src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs admin
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=admin:nodejs /app/dist ./dist
COPY --from=ui-builder --chown=admin:nodejs /ui/out ./public
COPY web/bff/certs/rds-ca-bundle.pem /etc/ssl/certs/rds-ca-bundle.pem
USER admin
EXPOSE 5000
CMD ["node", "dist/server.js"]
