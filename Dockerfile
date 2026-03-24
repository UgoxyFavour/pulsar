# Multi-stage build for pulsar MCP server

# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the TypeScript project
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S pulsar -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built files from builder stage
COPY --from=builder --chown=pulsar:nodejs /app/dist ./dist

# Switch to non-root user
USER pulsar

# Set environment defaults
ENV STELLAR_NETWORK=testnet
ENV LOG_LEVEL=info

# Entrypoint
ENTRYPOINT ["node", "dist/index.js"]
