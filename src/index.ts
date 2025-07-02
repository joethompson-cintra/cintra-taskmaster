// Simple MCP server starter template without authentication
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
// @ts-ignore
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import { logger } from './utils/logger';
import { setupMcpServer } from './server/mcpServer';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
	origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
	credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Create MCP server instance
const server = new McpServer({
	name: 'typescript-mcp-server',
	version: '1.0.0'
}, {
	capabilities: {
		logging: {},
		tools: {},
		resources: {},
		prompts: {}
	}
});

// Setup MCP server with tools, resources, and prompts
setupMcpServer(server);

// Store active transports
const transports = new Map<string, StreamableHTTPServerTransport>();

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
	res.json({ 
		status: 'healthy', 
		timestamp: new Date().toISOString(),
		uptime: process.uptime()
	});
});

// MCP endpoint with session management
app.all('/mcp', async (req: Request, res: Response) => {
	try {
		const sessionId = (req.query.sessionId as string) || (req.headers['x-session-id'] as string) || 'default';

		let transport = transports.get(sessionId);
		
		if (!transport) {
			// Create new transport for this session
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => sessionId,
				onsessioninitialized: (id: string) => {
					logger.info(`Session initialized: ${id}`);
				}
			});
			transports.set(sessionId, transport);
			
			// Clean up transport when connection closes
			res.on('close', () => {
				transports.delete(sessionId);
				logger.info(`Session ${sessionId} closed`);
			});
			
			// Connect server to transport
			await server.connect(transport);
			logger.info(`New MCP session created: ${sessionId}`);
		}
		
		// Handle the request with the transport
		await transport.handleRequest(req, res);
		
	} catch (error) {
		logger.error('MCP endpoint error:', error);
		res.status(500).json({ error: 'Internal server error' });
	}
});

// Error handling middleware
app.use((error: Error, req: Request, res: Response, next: NextFunction): void => {
	logger.error('Unhandled error:', error);
	res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
	logger.info(`MCP server running on port ${port}`);
	logger.info(`Health check available at: http://localhost:${port}/health`);
	logger.info(`MCP endpoint available at: http://localhost:${port}/mcp`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
	logger.info('SIGTERM received, shutting down gracefully');
	process.exit(0);
});

process.on('SIGINT', () => {
	logger.info('SIGINT received, shutting down gracefully');
	process.exit(0);
}); 