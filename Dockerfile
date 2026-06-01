# ──────────────────────────────────────────────────────────────
# Project Aegis — Root Dockerfile (NestJS Control Plane)
# Multi-stage build for minimal production image
# ──────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main.js"]
