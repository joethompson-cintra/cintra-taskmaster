# TypeScript MCP Server with Authentication

A comprehensive starter project for building a Model Context Protocol (MCP) server with TypeScript and HTTP authentication support, designed for cloud deployment.

## Features

- 🔐 **OAuth Authentication**: Proxy OAuth provider support for secure authentication
- 🌐 **HTTP Transport**: StreamableHTTP transport for modern cloud deployment
- 🛡️ **Security**: Helmet, CORS, and input validation
- 📝 **Logging**: Structured logging with Winston
- 🔧 **TypeScript**: Full TypeScript support with strict type checking
- ☁️ **Cloud Ready**: Docker support and environment-based configuration
- 🧪 **Testing**: Jest testing framework with TypeScript support
- 📊 **Health Checks**: Built-in health monitoring endpoints
- 🎯 **MCP Features**: Tools, resources, and prompts implementation

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Docker (optional, for containerized deployment)

### Installation

1. Clone or download this starter project
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

4. Update the `.env` file with your OAuth provider configuration:
   ```bash
   # Update these with your actual OAuth provider details
   OAUTH_AUTHORIZATION_URL=https://your-oauth-provider.com/oauth2/v1/authorize
   OAUTH_TOKEN_URL=https://your-oauth-provider.com/oauth2/v1/token
   OAUTH_REVOCATION_URL=https://your-oauth-provider.com/oauth2/v1/revoke
   OAUTH_CLIENT_ID=your-actual-client-id
   OAUTH_CLIENT_SECRET=your-actual-client-secret
   ISSUER_URL=https://your-oauth-provider.com
   ```

5. Build and start the server:
   ```bash
   npm run build
   npm start
   ```

   Or for development with hot reloading:
   ```bash
   npm run dev
   ```

### Verification

Visit `http://localhost:3000/health` to verify the server is running.

## Project Structure

```
src/
├── index.ts              # Main server entry point
├── server/
│   └── mcpServer.ts      # MCP server setup and handlers
├── utils/
│   ├── logger.ts         # Winston logging configuration
│   └── config.ts         # Environment validation
├── middleware/
│   └── auth.ts           # Authentication middleware
├── types/
│   └── index.ts          # TypeScript type definitions
└── __tests__/
    ├── setup.ts          # Test setup
    └── server.test.ts    # Basic tests
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3000) |
| `NODE_ENV` | Environment (development/production) | No |
| `BASE_URL` | Base URL for the server | Yes |
| `OAUTH_AUTHORIZATION_URL` | OAuth authorization endpoint | Yes |
| `OAUTH_TOKEN_URL` | OAuth token endpoint | Yes |
| `OAUTH_REVOCATION_URL` | OAuth revocation endpoint | Yes |
| `OAUTH_CLIENT_ID` | OAuth client ID | Yes |
| `OAUTH_CLIENT_SECRET` | OAuth client secret | Yes |
| `ISSUER_URL` | OAuth issuer URL | Yes |
| `SERVICE_DOCUMENTATION_URL` | Service documentation URL | Yes |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | No |
| `LOG_LEVEL` | Logging level (error/warn/info/debug) | No |

## API Endpoints

### Core Endpoints

- `GET /health` - Health check endpoint
- `POST /mcp` - MCP protocol endpoint (requires session ID)
- `GET /mcp` - MCP protocol endpoint (requires session ID)

### Authentication Endpoints

- `GET /auth/.well-known/oauth-authorization-server` - OAuth discovery
- `GET /auth/authorize` - OAuth authorization
- `POST /auth/token` - OAuth token exchange
- `POST /auth/revoke` - OAuth token revocation

## MCP Features

### Tools

- **echo**: Echo back input text
- **get_time**: Get current server time in various formats

### Resources

- **config://server**: Server configuration and status
- **info://about**: Server information

### Prompts

- **server_status**: Get detailed server status
- **welcome_message**: Generate welcome message for users

## Development

### Scripts

```bash
npm run dev        # Start development server with hot reload
npm run build      # Build TypeScript to JavaScript
npm run start      # Start production server
npm run test       # Run tests
npm run lint       # Run ESLint
npm run lint:fix   # Fix ESLint issues
npm run clean      # Clean build directory
```

### Adding New Features

1. **Tools**: Add new tools in `src/server/mcpServer.ts` in the `CallToolRequestSchema` handler
2. **Resources**: Add new resources in the `ReadResourceRequestSchema` handler
3. **Prompts**: Add new prompts in the `GetPromptRequestSchema` handler

### Testing

Run tests with:
```bash
npm test
```

Add new tests in the `src/__tests__/` directory.

## Deployment

### Docker

Build and run with Docker:
```bash
docker build -t mcp-server .
docker run -p 3000:3000 --env-file .env mcp-server
```

### Docker Compose

For local development:
```bash
docker-compose up
```

For production with nginx:
```bash
docker-compose --profile production up
```

### Cloud Platforms

This server is designed to work with major cloud platforms:

- **AWS**: Deploy using ECS, Lambda, or Elastic Beanstalk
- **Google Cloud**: Deploy using Cloud Run or App Engine
- **Azure**: Deploy using Container Instances or App Service
- **Heroku**: Deploy using container registry

## Security Considerations

1. **Environment Variables**: Never commit `.env` files with actual secrets
2. **OAuth Configuration**: Ensure your OAuth provider is properly configured
3. **CORS**: Configure allowed origins appropriately for your use case
4. **HTTPS**: Always use HTTPS in production
5. **Token Validation**: Implement proper token validation in the `verifyAccessToken` function

## Customization

### OAuth Provider Integration

Update the `ProxyOAuthServerProvider` configuration in `src/index.ts`:

```typescript
const proxyProvider = new ProxyOAuthServerProvider({
    endpoints: {
        authorizationUrl: process.env.OAUTH_AUTHORIZATION_URL!,
        tokenUrl: process.env.OAUTH_TOKEN_URL!,
        revocationUrl: process.env.OAUTH_REVOCATION_URL!,
    },
    verifyAccessToken: async (token) => {
        // Implement your token verification logic here
        // Make requests to your OAuth provider to validate tokens
    },
    getClient: async (clientId) => {
        // Implement your client validation logic here
        // Return client configuration based on clientId
    }
});
```

### Adding Custom Middleware

Add custom middleware in `src/index.ts`:

```typescript
app.use('/api', yourCustomMiddleware);
```

## Troubleshooting

### Common Issues

1. **Port Already in Use**: Change the `PORT` environment variable
2. **OAuth Errors**: Verify your OAuth provider configuration
3. **CORS Issues**: Check your `ALLOWED_ORIGINS` configuration
4. **Build Errors**: Ensure all dependencies are installed with `npm install`

### Logs

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only
- Console output (development mode)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run tests and linting
6. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification](https://modelcontextprotocol.io/specification)
- [OAuth 2.0 RFC](https://tools.ietf.org/html/rfc6749)