FROM node:20-alpine AS builder

WORKDIR /app

# Copy package lists
COPY package*.json ./

# Install packages
RUN npm ci

# Copy application code
COPY . .

# Build application with disabled telemetry
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runtime Stage
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy package lists
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Copy compiled files and static assets
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Expose Next.js server port
EXPOSE 3000

# Start Next.js application
CMD ["npm", "start"]
