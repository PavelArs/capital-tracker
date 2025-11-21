FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM node:20-alpine

WORKDIR /app

# Install serve - lightweight static file server
RUN npm install -g serve

# Copy built files
COPY --from=builder /app/dist ./dist
COPY serve.json ./dist/serve.json

EXPOSE 80

# Serve static files on port 80
CMD ["serve", "-s", "dist", "-l", "80"]
