# ML Box BFF — Cognito session and JupyterHub API proxy.
# Build context: repository root.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY web/bff/package.json web/bff/package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/bff/package.json web/bff/tsconfig.json ./
COPY web/bff/src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs bff
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=bff:nodejs /app/dist ./dist
USER bff
EXPOSE 4000
CMD ["node", "dist/server.js"]
