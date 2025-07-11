/**
 * tools/expand-jira-task.ts
 * Tool to expand a Jira task into subtasks for detailed implementation
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { expandJiraTask } from '../../utils/jira/jira-utils';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

/**
 * Register the expand Jira task tool with the MCP server
 * @param server - The MCP server instance
 * @param getSessionConfig - Function to get session configuration
 */
export function registerExpandJiraTaskTool(server: McpServer, getSessionConfig?: () => any): void {
    server.registerTool('expand_jira_task', {
        title: 'Expand Jira Task',
        description: 'Expand a Jira task into subtasks for detailed implementation',
        inputSchema: {
            id: z.string().describe('ID of task to expand (Important: Make sure to include the project prefix, e.g. PROJ-123)'),
            num: z.string().optional().describe('Number of subtasks to generate'),
            research: z.boolean().optional().describe('Use Perplexity AI for research-backed generation'),
            prompt: z.string().optional().describe('Additional context for subtask generation'),
            force: z.boolean().optional().describe('Force the expansion even if subtasks already exist')
        },
    }, async (args: {
        id: string;
        num?: string;
        research?: boolean;
        prompt?: string;
        force?: boolean;
    }) => {
        try {
            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);

            // Validate task ID
            if (!args.id) {
                logger.error('Jira task ID is required');
                return createErrorResponse('Jira task ID is required');
            }

            logger.info(`Starting expand task with args: ${JSON.stringify(args)}`);

            // Parse number of subtasks
            const numSubtasks = args.num ? parseInt(args.num, 10) : undefined;
            
            // Call the expandJiraTask function
            const result = await expandJiraTask(
                args.id,
                numSubtasks,
                args.research || false,
                args.prompt || '',
                {
                    jiraConfig,
                    log: logger,
                    force: args.force || false
                }
            );

            // Handle the result
            if (result.success) {
                const data = result.data;
                const subtasksCount = data.subtasksCount || 0;
                const dependencyLinks = data.dependencyLinks || [];
                
                const content = [{
                    type: 'text' as const,
                    text: `✅ Successfully expanded Jira task ${args.id} into ${subtasksCount} subtasks with ${dependencyLinks.length} dependency links.

**Task Details:**
- Task ID: ${data.taskId}
- Created Subtasks: ${subtasksCount}
- Dependency Links: ${dependencyLinks.length}

**Created Subtasks:**
${data.subtasks?.map((subtask: any, index: number) => `${index + 1}. ${subtask.jiraKey}: ${subtask.title}`).join('\n') || 'No subtasks available'}

${dependencyLinks.length > 0 ? `\n**Dependency Links:**\n${dependencyLinks.map((link: any) => `- ${link.from} depends on ${link.to}`).join('\n')}` : ''}

The task has been successfully expanded with AI-generated subtasks.`
                }];
                
                logger.info(`Task expansion completed for issue: ${args.id}`);
                return { content };
            } else {
                return createErrorResponse(`Failed to expand task: ${result.error?.message || 'Unknown error'}`);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in expand-jira-task tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to expand task: ${errorMessage}`);
        }
    });
}