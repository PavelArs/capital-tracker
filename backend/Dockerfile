FROM node:22.21.1-alpine AS dependencies

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json

FROM dependencies AS builder
RUN pnpm --filter capital-tracker-backend... install --frozen-lockfile
COPY backend ./backend
RUN pnpm --dir backend build

FROM dependencies AS production-dependencies
RUN pnpm --filter capital-tracker-backend... install --prod --frozen-lockfile

FROM node:22.21.1-alpine AS release

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=builder --chown=node:node /app/backend/dist ./backend/dist
COPY --from=builder --chown=node:node /app/backend/package.json ./backend/package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/main.js"]
