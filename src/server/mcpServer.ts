// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger';
import { registerGetTaskTool } from './tools/get-task';
import { registerNextTaskTool } from './tools/next-task';
import { registerSetTaskStatusTool } from './tools/set-task-status';
import { registerAddTaskTool } from './tools/add-task';
import { registerUpdateTaskTool } from './tools/update-task';
import { registerRemoveTaskTool } from './tools/remove-task';
import { registerAddJiraCommentTool } from './tools/add-jira-comment';
import { registerGetJiraAttachmentTool } from './tools/get-jira-attachment';
import { registerExpandJiraTaskTool } from './tools/expand-jira-task';

export function setupMcpServer(server: McpServer, getSessionConfig?: () => any): void {
    try {
        logger.info('Registering Task Master tools...');
        registerGetTaskTool(server, getSessionConfig);
        registerNextTaskTool(server, getSessionConfig);
        registerSetTaskStatusTool(server, getSessionConfig);
        registerAddTaskTool(server, getSessionConfig);
        registerUpdateTaskTool(server, getSessionConfig);
        registerRemoveTaskTool(server, getSessionConfig);
        registerAddJiraCommentTool(server, getSessionConfig);
        registerGetJiraAttachmentTool(server, getSessionConfig);
        registerExpandJiraTaskTool(server, getSessionConfig);

    } catch (error: any) {
        logger.error(`Error registering Task Master tools: ${error.message}`);
        logger.error('Stack trace:', error.stack);
        throw error;
    }
} 