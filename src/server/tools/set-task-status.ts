/**
 * tools/set-task-status.ts
 * Tool to set the status of Jira tasks
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { setJiraTaskStatus } from '../../utils/jira/jira-utils';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

export function registerSetTaskStatusTool(server: McpServer, getSessionConfig?: () => any): void {
    server.registerTool('set_jira_task_status', {
        title: 'Set Jira Task Status',
        description: 'Set the status of one or more tasks or subtasks in Jira',
        inputSchema: {
            id: z
                .string()
                .describe(
                    "Jira issue key(s) to update (e.g., 'PROJ-123', 'PROJ-124'). Can be comma-separated for multiple updates."
                ),
            status: z
                .string()
                .describe(
                    "New status to set (e.g., 'To Do', 'In Progress', 'Done', 'In Review' etc)."
                ),
        },
    }, async (args: {
        id: string;
        status: string;
    }) => {
        try {
            logger.info(`Setting status of Jira issue(s) ${args.id} to: ${args.status}`);

            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);

            // Validate required parameters
            if (!args.id) {
                const errorMessage = 'No task ID specified. Please provide a task ID to update.';
                logger.error(errorMessage);
                return createErrorResponse(errorMessage);
            }

            if (!args.status) {
                const errorMessage = 'No status specified. Please provide a new status value.';
                logger.error(errorMessage);
                return createErrorResponse(errorMessage);
            }

            // Call the setJiraTaskStatus function
            const result = await setJiraTaskStatus(args.id, args.status, {
                log: logger,
                jiraConfig: jiraConfig
            });

            if (!result.success) {
                logger.error(`Failed to update Jira issue status: ${result.error?.message || 'Unknown error'}`);
                return createErrorResponse(`Failed to update task status: ${result.error?.message || 'Unknown error'}`);
            }

            // Success response
            const updatedTasks = result.data?.updatedTasks || [];
            const successMessage = updatedTasks.length > 0 
                ? `Successfully updated ${updatedTasks.length} task(s) to "${args.status}": ${updatedTasks.map((t: any) => t.id).join(', ')}`
                : `Successfully updated task(s) ${args.id} to "${args.status}"`;

            logger.info(successMessage);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: successMessage
                    }
                ]
            };

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in set-jira-task-status tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to set task status: ${errorMessage}`);
        }
    });
}
