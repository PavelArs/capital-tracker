FROM node:22.21.1-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm --filter capital-tracker-frontend... install --frozen-lockfile

COPY frontend ./frontend

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --dir frontend build

FROM nginx:1.28.0-alpine AS release

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY deploy/container-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
