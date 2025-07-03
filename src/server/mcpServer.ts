// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { registerGetTaskTool } from './tools/get-task';

export function setupMcpServer(server: McpServer, getSessionConfig?: () => any): void {
    try {
        logger.info('Starting MCP server setup...');
        
        // Test basic server registration with a simple tool first
        server.registerTool('test-tool', {
            title: 'Test Tool',
            description: 'A simple test tool to verify MCP server is working',
            inputSchema: {
                message: z.string().optional().describe('Test message'),
            },
        }, async ({ message = 'Hello from MCP server!' }: { message?: string }) => {
            logger.info(`Test tool called with message: ${message}`);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Test successful: ${message}`,
                    },
                ],
            };
        });
        
        logger.info('Test tool registered successfully');

        // Try to register the get-task tool
        try {
            registerGetTaskTool(server, getSessionConfig);
            logger.info('Get task tool registered successfully');
        } catch (error) {
            logger.error('Failed to register get-task tool:', error);
            // Don't throw - continue with just the test tool
        }

        logger.info('MCP server setup completed successfully');
    } catch (error: any) {
        logger.error(`Error registering Task Master tools: ${error.message}`);
        logger.error('Stack trace:', error.stack);
        throw error;
    }

    // // Register a simple echo tool
    // server.registerTool('echo', {
    //     title: 'Echo Tool',
    //     description: 'Echo back the input text',
    //     inputSchema: {
    //         text: z.string().describe('Text to echo back'),
    //     },
    // }, async ({ text }: { text: string }) => {
    //     logger.info(`Echo tool called with text: ${text}`);
    //     return {
    //         content: [
    //             {
    //                 type: 'text' as const,
    //                 text: `Echo: ${text}`,
    //             },
    //         ],
    //     };
    // });

    // // Register a greeting tool
    // server.registerTool('greet', {
    //     title: 'Greeting Tool',
    //     description: 'Generate a personalized greeting',
    //     inputSchema: {
    //         name: z.string().describe('Name of the person to greet'),
    //         language: z.enum(['en', 'es', 'fr', 'de']).optional().describe('Language for the greeting'),
    //     },
    // }, async ({ name, language = 'en' }: { name: string; language?: string }) => {
    //     const greetings: Record<string, string> = {
    //         en: `Hello, ${name}! Welcome to our MCP server.`,
    //         es: `¡Hola, ${name}! Bienvenido a nuestro servidor MCP.`,
    //         fr: `Bonjour, ${name}! Bienvenue sur notre serveur MCP.`,
    //         de: `Hallo, ${name}! Willkommen auf unserem MCP-Server.`,
    //     };

    //     logger.info(`Greeting tool called for ${name} in ${language}`);
    //     return {
    //         content: [
    //             {
    //                 type: 'text' as const,
    //                 text: greetings[language] || greetings.en,
    //             },
    //         ],
    //     };
    // });

    // // Register a system info tool
    // server.registerTool('system-info', {
    //     title: 'System Information',
    //     description: 'Get basic system information',
    //     inputSchema: {},
    // }, async () => {
    //     const info = {
    //         timestamp: new Date().toISOString(),
    //         uptime: process.uptime(),
    //         nodeVersion: process.version,
    //         platform: process.platform,
    //         architecture: process.arch,
    //     };

    //     logger.info('System info tool called');
    //     return {
    //         content: [
    //             {
    //                 type: 'text' as const,
    //                 text: `System Information:\n${JSON.stringify(info, null, 2)}`,
    //             },
    //         ],
    //     };
    // });

    // logger.info('MCP server setup completed with tools, resources, and prompts');
} 