# ==============================================================================
# WONDER-LUST PRODUCTION DOCKERFILE (MULTI-STAGE, SECURITY HARDENED)
# ==============================================================================

# --- Stage 1: Dependencies Builder ---
FROM node:20-alpine AS dependencies
WORKDIR /app

# Install build dependencies if needed for native modules
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json ./

# Install only production dependencies cleanly
RUN npm ci --omit=dev --ignore-scripts

# --- Stage 2: Production Runtime Container ---
FROM node:20-alpine AS runner
WORKDIR /app

# Set production environment variables
ENV NODE_ENV=production \
    PORT=8080 \
    DB_URL=mongodb://mongo:27017/wonderlust

# Install curl / wget for container health checks
RUN apk add --no-cache curl wget

# Create necessary upload directories and assign ownership to non-root 'node' user
RUN mkdir -p /app/public/uploads /app/views && \
    chown -R node:node /app && \
    chmod 750 /app/public/uploads

# Copy production node_modules from dependencies stage
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules

# Copy application source code with non-root ownership
COPY --chown=node:node . .

RUN chown -R node:node /app/public/uploads && chmod 750 /app/public/uploads

# Ensure secure runtime execution as non-root user
USER node

# Expose HTTP port
EXPOSE 8080

# Container Healthcheck probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Default process launch command
CMD ["node", "server.js"]
