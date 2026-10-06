FROM node:26.10.0-alpine3.24@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS builder

WORKDIR /app

# Node 25+ no longer bundles Corepack; install the pinned pnpm from the registry.
RUN npm install --global pnpm@12.9.1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
RUN pnpm --filter capital-tracker-frontend... install --frozen-lockfile

COPY frontend ./frontend

ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --dir frontend build

FROM nginx:1.31.0-alpine-slim@sha256:241b0d0fe06250e026e7a35a008d022c9a1d3bec19442d65cc33b84d0b5dd64d AS release

# CVE-2026-103111: the pinned base ships pcre2 10.48-r0; require the fixed Alpine package.
RUN apk add --no-cache 'pcre2>=10.49-r0'

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY deploy/container-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
