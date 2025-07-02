// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { logger } from '../utils/logger';

export function setupMcpServer(server: McpServer): void {
    // Register a simple echo tool
    server.registerTool('echo', {
        title: 'Echo Tool',
        description: 'Echo back the input text',
        inputSchema: {
            text: z.string().describe('Text to echo back'),
        },
    }, async ({ text }: { text: string }) => {
        logger.info(`Echo tool called with text: ${text}`);
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `Echo: ${text}`,
                },
            ],
        };
    });

    // Register a greeting tool
    server.registerTool('greet', {
        title: 'Greeting Tool',
        description: 'Generate a personalized greeting',
        inputSchema: {
            name: z.string().describe('Name of the person to greet'),
            language: z.enum(['en', 'es', 'fr', 'de']).optional().describe('Language for the greeting'),
        },
    }, async ({ name, language = 'en' }: { name: string; language?: string }) => {
        const greetings: Record<string, string> = {
            en: `Hello, ${name}! Welcome to our MCP server.`,
            es: `¡Hola, ${name}! Bienvenido a nuestro servidor MCP.`,
            fr: `Bonjour, ${name}! Bienvenue sur notre serveur MCP.`,
            de: `Hallo, ${name}! Willkommen auf unserem MCP-Server.`,
        };

        logger.info(`Greeting tool called for ${name} in ${language}`);
        return {
            content: [
                {
                    type: 'text' as const,
                    text: greetings[language] || greetings.en,
                },
            ],
        };
    });

    // Register a system info tool
    server.registerTool('system-info', {
        title: 'System Information',
        description: 'Get basic system information',
        inputSchema: {},
    }, async () => {
        const info = {
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            nodeVersion: process.version,
            platform: process.platform,
            architecture: process.arch,
        };

        logger.info('System info tool called');
        return {
            content: [
                {
                    type: 'text' as const,
                    text: `System Information:\n${JSON.stringify(info, null, 2)}`,
                },
            ],
        };
    });

    // Register a simple resource with correct API signature
    server.registerResource(
        'server-status',
        'server://status',
        {
            title: 'Server Status',
            description: 'Current server status and health',
            mimeType: 'application/json',
        },
        async () => {
            const status = {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
            };

            logger.info('Server status resource accessed');
            return {
                contents: [
                    {
                        uri: 'server://status',
                        mimeType: 'application/json',
                        text: JSON.stringify(status, null, 2),
                    },
                ],
            };
        }
    );

    // Register a configuration resource with correct API signature
    server.registerResource(
        'config',
        'server://config',
        {
            title: 'Server Configuration',
            description: 'Server configuration information',
            mimeType: 'application/json',
        },
        async () => {
            const config = {
                name: 'typescript-mcp-server',
                version: '1.0.0',
                environment: process.env.NODE_ENV || 'development',
                port: process.env.PORT || 3000,
                capabilities: ['tools', 'resources', 'prompts', 'logging'],
            };

            logger.info('Configuration resource accessed');
            return {
                contents: [
                    {
                        uri: 'server://config',
                        mimeType: 'application/json',
                        text: JSON.stringify(config, null, 2),
                    },
                ],
            };
        }
    );

    // Register a sample prompt with correct API signature
    server.registerPrompt('welcome', {
        title: 'Welcome Prompt',
        description: 'A welcome message for new users',
        argsSchema: {
            username: z.string().describe('Username for personalization'),
            service: z.string().optional().describe('Service name'),
        },
    }, async ({ username, service = 'MCP Server' }: { username: string; service?: string }) => {
        logger.info(`Welcome prompt called for user: ${username}`);
        return {
            messages: [
                {
                    role: 'user' as const,
                    content: {
                        type: 'text' as const,
                        text: `Welcome to ${service}, ${username}! How can I help you today?`,
                    },
                },
            ],
        };
    });

    // Register a help prompt with correct API signature
    server.registerPrompt('help', {
        title: 'Help Prompt',
        description: 'Get help with available tools and resources',
        argsSchema: {
            topic: z.enum(['tools', 'resources', 'prompts', 'general']).optional().describe('Help topic'),
        },
    }, async ({ topic = 'general' }) => {
        const helpContent: Record<string, string> = {
            tools: 'Available tools: echo, greet, system-info. Use these to interact with the server.',
            resources: 'Available resources: server-status, config. Access these for server information.',
            prompts: 'Available prompts: welcome, help. Use these for guided interactions.',
            general: 'This is a TypeScript MCP server starter template. Use /health for status checks.',
        };

        logger.info(`Help prompt called for topic: ${topic}`);
        return {
            messages: [
                {
                    role: 'assistant' as const,
                    content: {
                        type: 'text' as const,
                        text: helpContent[topic] || helpContent.general,
                    },
                },
            ],
        };
    });

    logger.info('MCP server setup completed with tools, resources, and prompts');
} 