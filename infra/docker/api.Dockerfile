# Multi-stage: build with the full toolchain, ship without it.
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @evas/api prisma:generate && pnpm --filter @evas/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Never run as root.
RUN addgroup -S evas && adduser -S evas -G evas

COPY --from=builder --chown=evas:evas /app/apps/api/dist ./dist
COPY --from=builder --chown=evas:evas /app/apps/api/node_modules ./node_modules
COPY --from=builder --chown=evas:evas /app/apps/api/prisma ./prisma

USER evas
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "dist/main.js"]
