# Production Dockerfile for Google Cloud Run / Container Platforms
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./
RUN npm ci

# Copy full source and build client + server bundles
COPY . .
RUN npm run build

# Production Runner Image
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled frontend and backend bundles from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/supabase_schema.sql ./supabase_schema.sql

# Create storage directory for local database & exports
RUN mkdir -p /app/data

# Cloud Run injects PORT environment variable dynamically (defaults to 3000 or 8080)
EXPOSE 3000

# Start server with compiled node bundle
CMD ["node", "dist/server.js"]
