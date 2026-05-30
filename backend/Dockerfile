FROM node:20-alpine AS builder

WORKDIR /app

# Copy package lists
COPY package*.json ./

# Install packages
RUN npm ci

# Copy application code
COPY . .

# Build application
RUN npm run build

# Runtime Stage
FROM node:20-alpine

WORKDIR /app

# Copy package lists
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy compiled files from builder stage
COPY --from=builder /app/dist ./dist

# Expose NestJS server port
EXPOSE 3001

# Run NestJS application
CMD ["node", "dist/src/main.js"]
