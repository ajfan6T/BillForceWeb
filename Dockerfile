# Production Dockerfile for Google Cloud Run / Container Platforms
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency files (Electron, used only for the Windows app, is not downloaded here)
COPY package*.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci

# Copy full source and build client + server bundles
COPY . .
RUN npm run build

# Production Runner Image
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Behind Cloud Run / a load balancer: use the real client address for sign-in rate limits.
ENV TRUST_PROXY=1
# Mount a persistent volume here: every business's database, logins and backups live in this folder.
ENV BILLFORCE_DATA_DIR=/app/data

# Install production runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled frontend and backend bundles from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/supabase_schema.sql ./supabase_schema.sql

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

# Storage folder for databases and backups (mount a volume on it to keep data across restarts)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Cloud Run injects PORT environment variable dynamically (defaults to 3000 or 8080)
EXPOSE 3000

# Start server with compiled node bundle
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
