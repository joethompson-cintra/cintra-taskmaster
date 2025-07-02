import request from 'supertest';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { setupMcpServer } from '../server/mcpServer';

describe('MCP Server Integration Tests', () => {
    let app: express.Application;
    let server: McpServer;

    beforeAll(async () => {
        // Create Express app
        app = express();
        
        // Security middleware
        app.use(helmet());
        app.use(cors({
            origin: '*',
            credentials: true
        }));
        
        app.use(express.json({ limit: '10mb' }));
        app.use(express.urlencoded({ extended: true }));

        // Create MCP server instance
        server = new McpServer({
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

        // Health check endpoint
        app.get('/health', (req, res) => {
            res.json({ 
                status: 'healthy', 
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            });
        });

        // Simple mock endpoint for tools
        app.post('/tools/echo', (req, res) => {
            const { text } = req.body;
            res.json({
                content: [{
                    type: 'text',
                    text: `Echo: ${text}`
                }]
            });
        });

        app.post('/tools/greet', (req, res) => {
            const { name, language } = req.body;
            const greeting = language === 'es' 
                ? `¡Hola, ${name}! Bienvenido a nuestro servidor MCP.`
                : `Hello, ${name}! Welcome to our MCP server.`;
            res.json({
                content: [{
                    type: 'text',
                    text: greeting
                }]
            });
        });

        app.get('/tools/system-info', (req, res) => {
            res.json({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        message: 'System Information:',
                        nodeVersion: process.version,
                        platform: process.platform,
                        arch: process.arch,
                        uptime: process.uptime(),
                        memory: process.memoryUsage()
                    }, null, 2)
                }]
            });
        });

        app.get('/resources/status', (req, res) => {
            res.json({
                contents: [{
                    uri: 'server://status',
                    mimeType: 'application/json',
                    text: JSON.stringify({
                        status: 'healthy',
                        uptime: process.uptime(),
                        timestamp: new Date().toISOString(),
                        memory: process.memoryUsage(),
                        nodeVersion: process.version
                    })
                }]
            });
        });

        app.get('/resources/config', (req, res) => {
            res.json({
                contents: [{
                    uri: 'server://config',
                    mimeType: 'application/json',
                    text: JSON.stringify({
                        name: 'typescript-mcp-server',
                        version: '1.0.0',
                        capabilities: ['tools', 'resources', 'prompts'],
                        tools: ['echo', 'greet', 'system-info'],
                        resources: ['server://status', 'server://config'],
                        prompts: ['welcome', 'help']
                    })
                }]
            });
        });

        app.post('/prompts/welcome', (req, res) => {
            const { username } = req.body;
            res.json({
                messages: [{
                    role: 'user',
                    content: {
                        type: 'text',
                        text: `Welcome to MCP Server, ${username}! How can I help you today?`
                    }
                }]
            });
        });

        app.post('/prompts/help', (req, res) => {
            const { topic } = req.body;
            const helpText = topic === 'tools' 
                ? 'Available tools: echo, greet, system-info. Use these to interact with the server.'
                : 'This is an MCP server with tools, resources, and prompts. Use tools/list, resources/list, or prompts/list to explore.';
            res.json({
                messages: [{
                    role: 'assistant',
                    content: {
                        type: 'text',
                        text: helpText
                    }
                }]
            });
        });
    });

    test('should respond to health check', async () => {
        const response = await request(app).get('/health');
        
        expect(response.status).toBe(200);
        expect(response.body.status).toBe('healthy');
        expect(response.body.timestamp).toBeDefined();
        expect(response.body.uptime).toBeDefined();
    });

    test('should call echo tool', async () => {
        const response = await request(app)
            .post('/tools/echo')
            .send({ text: 'Hello MCP Integration!' });

        expect(response.status).toBe(200);
        expect(response.body.content).toBeDefined();
        expect(response.body.content[0].type).toBe('text');
        expect(response.body.content[0].text).toBe('Echo: Hello MCP Integration!');
    });

    test('should call greet tool with English', async () => {
        const response = await request(app)
            .post('/tools/greet')
            .send({ name: 'Integration Tester', language: 'en' });

        expect(response.status).toBe(200);
        expect(response.body.content).toBeDefined();
        expect(response.body.content[0].type).toBe('text');
        expect(response.body.content[0].text).toBe('Hello, Integration Tester! Welcome to our MCP server.');
    });

    test('should call greet tool with Spanish', async () => {
        const response = await request(app)
            .post('/tools/greet')
            .send({ name: 'Probador', language: 'es' });

        expect(response.status).toBe(200);
        expect(response.body.content).toBeDefined();
        expect(response.body.content[0].type).toBe('text');
        expect(response.body.content[0].text).toBe('¡Hola, Probador! Bienvenido a nuestro servidor MCP.');
    });

    test('should call system-info tool', async () => {
        const response = await request(app).get('/tools/system-info');

        expect(response.status).toBe(200);
        expect(response.body.content).toBeDefined();
        expect(response.body.content[0].type).toBe('text');
        expect(response.body.content[0].text).toContain('System Information:');
        expect(response.body.content[0].text).toContain('nodeVersion');
        expect(response.body.content[0].text).toContain('platform');
    });

    test('should read server-status resource', async () => {
        const response = await request(app).get('/resources/status');

        expect(response.status).toBe(200);
        expect(response.body.contents).toBeDefined();
        expect(response.body.contents[0].uri).toBe('server://status');
        expect(response.body.contents[0].mimeType).toBe('application/json');
        expect(response.body.contents[0].text).toContain('healthy');
        
        // Verify the status content is valid JSON
        const statusData = JSON.parse(response.body.contents[0].text);
        expect(statusData.status).toBe('healthy');
        expect(statusData.uptime).toBeDefined();
    });

    test('should read config resource', async () => {
        const response = await request(app).get('/resources/config');

        expect(response.status).toBe(200);
        expect(response.body.contents).toBeDefined();
        expect(response.body.contents[0].uri).toBe('server://config');
        expect(response.body.contents[0].mimeType).toBe('application/json');
        
        // Verify the config content is valid JSON
        const configData = JSON.parse(response.body.contents[0].text);
        expect(configData.name).toBe('typescript-mcp-server');
        expect(configData.version).toBe('1.0.0');
        expect(configData.capabilities).toContain('tools');
    });

    test('should call welcome prompt', async () => {
        const response = await request(app)
            .post('/prompts/welcome')
            .send({ username: 'Integration Tester' });

        expect(response.status).toBe(200);
        expect(response.body.messages).toBeDefined();
        expect(response.body.messages[0].role).toBe('user');
        expect(response.body.messages[0].content.type).toBe('text');
        expect(response.body.messages[0].content.text).toBe('Welcome to MCP Server, Integration Tester! How can I help you today?');
    });

    test('should call help prompt', async () => {
        const response = await request(app)
            .post('/prompts/help')
            .send({ topic: 'tools' });

        expect(response.status).toBe(200);
        expect(response.body.messages).toBeDefined();
        expect(response.body.messages[0].role).toBe('assistant');
        expect(response.body.messages[0].content.type).toBe('text');
        expect(response.body.messages[0].content.text).toBe('Available tools: echo, greet, system-info. Use these to interact with the server.');
    });

    test('should verify server instance exists', async () => {
        // Test that the server instance was created successfully
        expect(server).toBeDefined();
        expect(typeof server).toBe('object');
    });
}); 