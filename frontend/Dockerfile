FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS builder

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

FROM nginx:1.31.9-alpine-slim@sha256:5bfced78d24d644270bedb0a9968697042e38d5c03fb6354603df025279c1cbe AS release

# Keep the floors for CVE-2026-103111 (pcre2 10.49-r0) and CVE-2026-14456 / CVE-2026-45447
# (OpenSSL 3.5.8-r0) so that no older base can bring the vulnerable packages back.
# The 1.31.9 base (Alpine 3.24.4) already ships pcre2 10.49-r0 and OpenSSL 3.5.9-r0.
RUN apk add --no-cache 'pcre2>=10.49-r0' 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0'

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY deploy/container-nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=6 \
  CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
