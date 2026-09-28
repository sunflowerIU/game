FROM node:24-alpine AS base
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/admin/package.json packages/admin/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/database/prisma.config.ts packages/database/prisma.config.ts
COPY packages/database/prisma/schema.prisma packages/database/prisma/schema.prisma
COPY packages/game-core/package.json packages/game-core/package.json
COPY packages/wallet/package.json packages/wallet/package.json
COPY games/neon-reels/package.json games/neon-reels/package.json
COPY games/neon-mines/package.json games/neon-mines/package.json
COPY games/neon-dice/package.json games/neon-dice/package.json
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
ARG NEXT_PUBLIC_API_BASE_URL=""
ARG API_INTERNAL_URL="http://server:4000"
ARG NEXT_PUBLIC_PLAYER_ORIGIN="http://localhost:3000"
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
ENV NEXT_PUBLIC_PLAYER_ORIGIN=${NEXT_PUBLIC_PLAYER_ORIGIN}
COPY . .
RUN pnpm build

FROM node:24-alpine AS server
ENV NODE_ENV=production
WORKDIR /workspace

COPY --from=dependencies --chown=node:node \
  /workspace/node_modules \
  ./node_modules

COPY --from=dependencies --chown=node:node \
  /workspace/apps/server/package.json \
  ./apps/server/package.json

COPY --from=dependencies --chown=node:node \
  /workspace/apps/server/node_modules \
  ./apps/server/node_modules

COPY --from=build --chown=node:node \
  /workspace/apps/server/dist \
  ./apps/server/dist

WORKDIR /workspace/apps/server
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]

FROM base AS migrate
COPY --from=dependencies /workspace/node_modules ./node_modules
COPY --from=dependencies /workspace/apps ./apps
COPY --from=dependencies /workspace/games ./games
COPY --from=build /workspace/packages ./packages
COPY --from=build /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml /workspace/tsconfig.base.json ./
CMD ["pnpm", "db:deploy"]

FROM node:24-alpine AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM node:24-alpine AS admin-web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/admin-web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/admin-web/.next/static ./apps/admin-web/.next/static
USER node
EXPOSE 3001
CMD ["node", "apps/admin-web/server.js"]
