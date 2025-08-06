# Multi-stage build for production
FROM node:20-bullseye-slim AS builder

# Install ca-certificates (required for TypeScript SDK)
RUN apt-get update \
    && apt-get install -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Create production stage
FROM node:20-bullseye-slim AS production

# Install ca-certificates (required for TypeScript SDK)
RUN apt-get update \
    && apt-get install -y ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y dumb-init && rm -rf /var/lib/apt/lists/*

# Create app user for security
RUN groupadd -r nodejs && useradd -r -g nodejs nodejs

# Set working directory
WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./

# Copy source code
COPY --from=builder --chown=nodejs:nodejs /app/src ./src

# Create logs directory
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command (can be overridden)
CMD ["npm", "run", "server"] 