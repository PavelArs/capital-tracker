FROM node:26.11.1-alpine3.24@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS builder

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

FROM nginx:1.31.7-alpine-slim@sha256:ebd058041a732a2b2dc0b606e34572dd8e0034de6a4aa4d50d8c13a240ac6005 AS release

# CVE-2026-103111: the pinned base ships pcre2 10.47-r0; require the fixed Alpine package.
# CVE-2026-14456 and CVE-2026-45447: it also ships OpenSSL 3.5.6-r0; require 3.5.8-r0.
RUN apk add --no-cache 'pcre2>=10.49-r0' 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY deploy/container-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
