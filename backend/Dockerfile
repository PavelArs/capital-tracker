FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (like bcrypt)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

FROM node:20-alpine

WORKDIR /app

# Install postgresql-client for running SQL migrations
RUN apk add --no-cache postgresql-client

COPY package*.json ./

# Copy production dependencies and built app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Copy SQL migrations
COPY migrations ./migrations

# Copy and set entrypoint script
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]

