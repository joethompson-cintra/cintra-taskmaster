# Docker Setup Guide for Cintra-Taskmaster

This guide will help you dockerize and run the cintra-taskmaster MCP server using Docker and Docker Compose.

## Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)
- Your Atlassian (Jira/Bitbucket) credentials

## Quick Start

1. **Clone and Build**
   ```bash
   git clone <your-repo>
   cd cintra-taskmaster
   docker-compose up --build
   ```

2. **Access the Server**
   - MCP Server: http://localhost:3000/mcp
   - Health Check: http://localhost:3000/health

## Environment Configuration

### 1. Create Environment File

Create a `.env` file in the root directory with your configuration:

```env
# Jira Configuration
JIRA_API_URL=https://your-domain.atlassian.net

# Bitbucket Configuration  
BITBUCKET_WORKSPACE=your-workspace

# Logging (optional)
LOG_LEVEL=info
NODE_ENV=production
PORT=3000
```

### 2. User Authentication

The application uses **header-based authentication** for security. Each request must include:

```bash
# Required headers for API calls
curl -X POST http://localhost:3000/mcp \
  -H "x-atlassian-email: your-email@domain.com" \
  -H "x-jira-api-token: your-jira-token" \
  -H "x-bitbucket-api-token: your-bitbucket-token" \
  -H "x-jira-project: YOUR-PROJECT-KEY" \
  -H "mcp-session-id: unique-session-id" \
  -H "Content-Type: application/json"
```

## Docker Commands

### Development Mode
```bash
# Run in development with auto-restart
docker-compose up --build

# Run in background
docker-compose up -d

# View logs
docker-compose logs -f cintra-taskmaster

# Stop services
docker-compose down
```

### Production Mode
```bash
# Run with nginx reverse proxy
docker-compose --profile production up -d

# This will also start nginx on ports 80/443
```

## Build Only Docker Image

If you prefer to build just the Docker image:

```bash
# Build the image
docker build -t cintra-taskmaster:latest .

# Run the container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/logs:/app/logs \
  -e JIRA_API_URL=https://your-domain.atlassian.net \
  -e BITBUCKET_WORKSPACE=your-workspace \
  -e LOG_LEVEL=info \
  --name cintra-taskmaster \
  cintra-taskmaster:latest
```

## Health Checks

The application includes health checks:

```bash
# Check container health
docker-compose ps

# Manual health check
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 1234.5,
  "sessions": 0
}
```

## Logging

Logs are mounted to `./logs` directory:

```bash
# View application logs
tail -f logs/app.log

# View error logs
tail -f logs/error.log

# View logs in Docker
docker-compose logs -f cintra-taskmaster
```

## Security Features

- **Non-root user**: Container runs as `mcpuser` (UID 1001)
- **Read-only filesystem**: Application code is read-only
- **No sensitive data in environment**: User credentials via headers only
- **Proper signal handling**: Uses `dumb-init` for clean shutdowns

## Troubleshooting

### Common Issues

1. **Build fails on native dependencies**
   ```bash
   # Clear node_modules and rebuild
   docker-compose down
   docker-compose build --no-cache
   ```

2. **Health check fails**
   ```bash
   # Check if service is running
   docker-compose ps
   
   # Check logs for errors
   docker-compose logs cintra-taskmaster
   ```

3. **Permission errors with logs**
   ```bash
   # Fix log directory permissions
   sudo chmod 755 logs/
   sudo chown -R 1001:1001 logs/
   ```

### Debug Mode

Run with debug logging:

```bash
# Enable debug logging
docker-compose up -e LOG_LEVEL=debug
```

## Production Deployment

For production deployment with SSL:

1. **Create nginx configuration** (nginx.conf):
   ```nginx
   events {
       worker_connections 1024;
   }
   
   http {
       upstream mcp-server {
           server cintra-taskmaster:3000;
       }
       
       server {
           listen 80;
           server_name your-domain.com;
           
           location / {
               proxy_pass http://mcp-server;
               proxy_set_header Host $host;
               proxy_set_header X-Real-IP $remote_addr;
           }
       }
   }
   ```

2. **Deploy with production profile**:
   ```bash
   docker-compose --profile production up -d
   ```

## Testing

Run the E2E tests against the Docker container:

```bash
# Start the container
docker-compose up -d

# Run tests (from host)
npm run test:e2e

# Cleanup
docker-compose down
```

## Monitoring

Monitor your MCP server:

```bash
# Check resource usage
docker stats cintra-taskmaster

# View system info
docker system df

# Check container health
docker inspect cintra-taskmaster | jq '.[0].State.Health'
```

## Backup and Recovery

Since this is a stateless application:

1. **Configuration backup**: Save your `.env` file
2. **Log backup**: Archive the `./logs` directory
3. **No database**: No persistent data to backup

## Need Help?

- Check the main README.md for API documentation
- Review application logs in `./logs/`
- Run health checks: `curl localhost:3000/health`
- Check the E2E tests for usage examples 