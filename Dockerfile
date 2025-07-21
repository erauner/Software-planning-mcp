# Multi-stage build for smaller image
FROM node:20-alpine AS builder

WORKDIR /app

# Copy all necessary files before installing dependencies
COPY package*.json ./
COPY pnpm-lock.yaml ./
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Build the application
RUN pnpm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install pnpm in production image
RUN npm install -g pnpm

# Copy package files and install production dependencies only
COPY package*.json ./
COPY pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --production --ignore-scripts

# Copy built application from builder
COPY --from=builder /app/build ./build

# Create non-root user
RUN addgroup -g 1001 -S mcp && \
    adduser -S mcp -u 1001

# Switch to non-root user
USER mcp

# Set default environment variables
ENV NODE_ENV=production \
    STORAGE_MODE=file

# MCP servers communicate via stdio
ENTRYPOINT ["node", "/app/build/index.js"]
