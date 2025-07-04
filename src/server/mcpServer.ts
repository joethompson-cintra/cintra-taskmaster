// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger';
import { registerGetTaskTool } from './tools/get-task';
import { registerNextTaskTool } from './tools/next-task';
import { registerSetTaskStatusTool } from './tools/set-task-status';
import { registerAddTaskTool } from './tools/add-task';

export function setupMcpServer(server: McpServer, getSessionConfig?: () => any): void {
    try {
        logger.info('Registering Task Master tools...');
        registerGetTaskTool(server, getSessionConfig);
        registerNextTaskTool(server, getSessionConfig);
        registerSetTaskStatusTool(server, getSessionConfig);
        registerAddTaskTool(server, getSessionConfig);

    } catch (error: any) {
        logger.error(`Error registering Task Master tools: ${error.message}`);
        logger.error('Stack trace:', error.stack);
        throw error;
    }
} 