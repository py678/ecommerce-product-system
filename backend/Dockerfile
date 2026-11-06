FROM node:26-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json turbo.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,id=silk-shop-npm,target=/root/.npm,sharing=locked npm ci --workspace backend --include-workspace-root --prefer-offline --no-audit --no-fund --fetch-retries=3 --fetch-timeout=120000 && node node_modules/turbo/bin/turbo --version
COPY backend ./backend
RUN npm run build:backend && mkdir -p backend/node_modules

# Migration tools stay outside the application runtime image.
FROM build AS migrate
WORKDIR /app/backend
USER node
CMD ["npm", "run", "db:deploy"]

FROM build AS production-dependencies
RUN --mount=type=cache,id=silk-shop-npm,target=/root/.npm,sharing=locked npm prune --omit=dev --omit=optional --workspace backend --include-workspace-root --prefer-offline --no-audit --no-fund && mkdir -p backend/node_modules

FROM node:26-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
WORKDIR /app/backend
RUN mkdir -p /app/backend/uploads && chown node:node /app/backend/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
