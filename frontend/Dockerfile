FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN --mount=type=cache,id=silk-shop-npm,target=/root/.npm,sharing=locked npm ci --workspace frontend --include-workspace-root --prefer-offline --no-audit --no-fund --fetch-retries=3 --fetch-timeout=120000 && node node_modules/turbo/bin/turbo --version
COPY frontend ./frontend
RUN npm run build:frontend

FROM nginx:stable-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
