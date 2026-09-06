# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS pnpm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /workspace
COPY patches ./patches

FROM pnpm AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/game-host-api/package.json ./packages/game-host-api/package.json
COPY services/game-host/package.json ./services/game-host/package.json
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @thorium/game-host...

FROM pnpm AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.strict.json ./
COPY packages/game-host-api/package.json ./packages/game-host-api/package.json
COPY packages/game-host-api/tsconfig.json ./packages/game-host-api/tsconfig.json
COPY packages/game-host-api/src ./packages/game-host-api/src
COPY services/game-host/package.json ./services/game-host/package.json
RUN pnpm install --frozen-lockfile --filter @thorium/game-host...
COPY services/game-host/tsconfig.json services/game-host/tsconfig.build.json ./services/game-host/
COPY services/game-host/src ./services/game-host/src
RUN pnpm --filter @thorium/game-host-api build && pnpm --filter @thorium/game-host build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace/services/game-host
COPY --from=production-dependencies /workspace/node_modules /workspace/node_modules
COPY --from=production-dependencies /workspace/services/game-host/node_modules ./node_modules
COPY services/game-host/package.json ./package.json
COPY packages/game-host-api/package.json /workspace/packages/game-host-api/package.json
COPY --from=build /workspace/packages/game-host-api/dist /workspace/packages/game-host-api/dist
COPY --from=build /workspace/services/game-host/dist ./dist
RUN mkdir -p /var/lib/thorium/server-modules /var/lib/thorium/game-state \
  && chown -R node:node /var/lib/thorium
USER node
EXPOSE 2568
CMD ["node", "dist/index.js"]
