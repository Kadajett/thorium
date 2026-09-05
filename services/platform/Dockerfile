# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS pnpm

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
WORKDIR /workspace

FROM pnpm AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/platform/package.json ./services/platform/package.json
RUN pnpm install --frozen-lockfile --prod --filter @thorium/platform...

FROM pnpm AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY services/platform/package.json ./services/platform/package.json
RUN pnpm install --frozen-lockfile --filter @thorium/platform...
COPY services/platform/tsconfig.json services/platform/tsconfig.build.json ./services/platform/
COPY services/platform/src ./services/platform/src
COPY services/platform/migrations ./services/platform/migrations
RUN pnpm --filter @thorium/platform build

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PACKAGE_ARTIFACT_DIRECTORY=/var/lib/thorium/packages
WORKDIR /workspace/services/platform

COPY --from=production-dependencies /workspace/node_modules /workspace/node_modules
COPY --from=production-dependencies /workspace/services/platform/node_modules ./node_modules
COPY services/platform/package.json ./package.json
COPY --from=build /workspace/services/platform/dist ./dist
COPY --from=build /workspace/services/platform/migrations ./migrations

RUN mkdir -p /var/lib/thorium/packages && chown -R node:node /var/lib/thorium

USER node
EXPOSE 2567
CMD ["node", "dist/index.js"]
