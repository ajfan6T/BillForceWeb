# BILLFORCE server edition: runs the ready-built app (no build step here).
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Behind a load balancer: use the real client address for sign-in rate limits.
ENV TRUST_PROXY=1
# Mount a persistent volume here: every business's database, logins and backups live in this folder.
ENV BILLFORCE_DATA_DIR=/app/data

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dist ./dist
COPY public ./public
COPY supabase_schema.sql ./supabase_schema.sql

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
