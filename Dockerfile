# Use Node.js 20 Alpine for better security and performance
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies for building native modules and curl for health checks
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl \
    dumb-init

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install ALL dependencies first (including dev dependencies for building)
RUN npm ci && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY tsconfig.json ./

# Build TypeScript to JavaScript
RUN npm run build

# Remove source TypeScript files and reinstall only production dependencies
RUN rm -rf src/ tsconfig.json node_modules/
RUN npm ci --only=production && npm cache clean --force

# Create logs directory with proper permissions
RUN mkdir -p logs && chmod 755 logs

# Create non-root user for security
RUN addgroup -g 1001 -S mcpuser && \
    adduser -S mcpuser -u 1001 -G mcpuser

# Change ownership of app directory to non-root user
RUN chown -R mcpuser:mcpuser /app

# Switch to non-root user
USER mcpuser

# Expose port (configurable via environment variable)
EXPOSE 3000

# Health check using the actual health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start the MCP server
CMD ["npm", "start"] 