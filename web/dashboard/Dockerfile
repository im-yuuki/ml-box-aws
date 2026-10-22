# ML Box — Dashboard (Next.js) image.
#
# Multi-stage: build with `npm run build`, then copy the standalone output
# into a slim runtime image.  The Next.js image is fronted by the same ALB
# as the hub (host = app.mlbox.june8th.me).
#
# Build context: repository root.
#
#   docker buildx build --platform linux/amd64 \
#     -f web/dashboard/Dockerfile \
#     --build-arg NEXT_PUBLIC_COGNITO_REGION=ap-southeast-2 \
#     --build-arg NEXT_PUBLIC_COGNITO_USER_POOL_ID=<...> \
#     --build-arg NEXT_PUBLIC_COGNITO_CLIENT_ID=<...> \
#     --build-arg NEXT_PUBLIC_BFF_BASE_URL=https://app.mlbox.june8th.me/api/bff \
#     --tag 451058046864.dkr.ecr.ap-southeast-2.amazonaws.com/jhub-gpu-sandbox/dashboard:dev-<sha> \
#     .

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY web/dashboard/package.json web/dashboard/package-lock.json* ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG NEXT_PUBLIC_COGNITO_REGION
ARG NEXT_PUBLIC_COGNITO_USER_POOL_ID
ARG NEXT_PUBLIC_COGNITO_CLIENT_ID
ARG NEXT_PUBLIC_BFF_BASE_URL
ENV NEXT_PUBLIC_COGNITO_REGION=${NEXT_PUBLIC_COGNITO_REGION} \
    NEXT_PUBLIC_COGNITO_USER_POOL_ID=${NEXT_PUBLIC_COGNITO_USER_POOL_ID} \
    NEXT_PUBLIC_COGNITO_CLIENT_ID=${NEXT_PUBLIC_COGNITO_CLIENT_ID} \
    NEXT_PUBLIC_BFF_BASE_URL=${NEXT_PUBLIC_BFF_BASE_URL} \
    NEXT_TELEMETRY_DISABLED=1
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
