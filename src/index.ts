import express, { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
// @ts-ignore
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// @ts-ignore
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { setupMcpServer } from './server/mcpServer';
import { logger } from './utils/logger';

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(express.json());

// Store both transports and session configs
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
const sessionConfigs: { [sessionId: string]: any } = {};

// Extract credentials from headers
function extractCredentials(req: Request) {
	return {
		JIRA_API_URL: process.env.JIRA_API_URL,
		JIRA_EMAIL: req.headers['x-atlassian-email'] as string,
		JIRA_API_TOKEN: req.headers['x-jira-api-token'] as string,
		JIRA_PROJECT: req.headers['x-jira-project'] as string,
		BITBUCKET_WORKSPACE: process.env.BITBUCKET_WORKSPACE,
		BITBUCKET_EMAIL: req.headers['x-atlassian-email'] as string,
		BITBUCKET_API_TOKEN: req.headers['x-bitbucket-api-token'] as string,
	};
}

// Handle POST requests for client-to-server communication
app.post('/mcp', async (req: Request, res: Response) => {
	try {
		// Check for existing session ID
		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		let transport: StreamableHTTPServerTransport;

		if (sessionId && transports[sessionId]) {
			// Reuse existing transport
			transport = transports[sessionId];
			logger.info(`Reusing existing transport for session: ${sessionId}`);
			
			// Update session config with any new credentials from headers
			const credentials = extractCredentials(req);
			sessionConfigs[sessionId] = { ...sessionConfigs[sessionId], ...credentials };
		} else if (!sessionId && isInitializeRequest(req.body)) {
			// New initialization request
			logger.info('Creating new transport for initialization request');
			
			// Extract credentials from headers
			const credentials = extractCredentials(req);
			
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (sessionId: string) => {
					// Store the transport and credentials by session ID
					transports[sessionId] = transport;
					sessionConfigs[sessionId] = credentials;
					logger.info(`Session initialized and stored: ${sessionId}`);
					logger.info(`Credentials configured for session: ${sessionId}`, {
						hasJiraToken: !!credentials.JIRA_API_TOKEN,
						jiraEmail: credentials.JIRA_EMAIL,
						jiraProject: credentials.JIRA_PROJECT
					});
				},
			});

			// Clean up transport when closed
			transport.onclose = () => {
				if (transport.sessionId) {
					delete transports[transport.sessionId];
					delete sessionConfigs[transport.sessionId];
					logger.info(`Session ${transport.sessionId} cleaned up`);
				}
			};

			// Create MCP server instance for this transport
			const server = new McpServer({
				name: 'cintra-taskmaster',
				version: '1.0.0'
			});

			// Setup tools and resources with access to session config
			setupMcpServer(server, () => sessionConfigs[transport.sessionId!]);

			// Connect to the MCP server
			await server.connect(transport);
			logger.info('MCP server connected to transport');
		} else {
			// Invalid request
			logger.info('Invalid request: no session ID and not an initialize request');
			res.status(400).json({
				jsonrpc: '2.0',
				error: {
					code: -32000,
					message: 'Bad Request: No valid session ID provided',
				},
				id: null,
			});
			return;
		}

		// Handle the request
		logger.info(`Handling request for session: ${transport.sessionId}`);
		await transport.handleRequest(req, res, req.body);
	} catch (error) {
		logger.error('Error in POST /mcp:', error);
		if (!res.headersSent) {
			res.status(500).json({
				jsonrpc: '2.0',
				error: {
					code: -32603,
					message: 'Internal server error',
				},
				id: null,
			});
		}
	}
});

// Reusable handler for GET and DELETE requests
const handleSessionRequest = async (req: Request, res: Response) => {
	try {
		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		logger.info(`Session request (${req.method}) for session: ${sessionId}`);
		
		if (!sessionId || !transports[sessionId]) {
			logger.info('Invalid or missing session ID');
			res.status(400).send('Invalid or missing session ID');
			return;
		}
		
		const transport = transports[sessionId];
		await transport.handleRequest(req, res);
	} catch (error) {
		logger.error(`Error in ${req.method} /mcp:`, error);
		if (!res.headersSent) {
			res.status(500).send('Internal server error');
		}
	}
};

// Handle GET requests for server-to-client notifications via SSE
app.get('/mcp', handleSessionRequest);

// Handle DELETE requests for session termination
app.delete('/mcp', handleSessionRequest);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
	res.json({ 
		status: 'healthy', 
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
		sessions: Object.keys(transports).length
	});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`MCP HTTP server listening on port ${PORT}`);
	console.log(`Health check: http://localhost:${PORT}/health`);
	console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
	logger.info('SIGTERM received, shutting down gracefully');
	// Close all transports
	Object.values(transports).forEach(transport => {
		transport.close();
	});
	process.exit(0);
});

process.on('SIGINT', () => {
	logger.info('SIGINT received, shutting down gracefully');
	// Close all transports
	Object.values(transports).forEach(transport => {
		transport.close();
	});
	process.exit(0); 
});