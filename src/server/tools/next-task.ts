/**
 * tools/next-task.ts
 * Tool to find the next Jira task to work on
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { findNextJiraTask } from '../../utils/jira/jira-utils';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

export function registerNextTaskTool(server: McpServer, getSessionConfig?: () => any): void {
    server.registerTool('next_jira_task', {
        title: 'Find Next Jira Task',
        description: 'Find the next Jira task to work on based on dependencies and status',
        inputSchema: {
            parentKey: z
                .string()
                .describe(
                    'Parent Jira issue key (epic or task with subtasks) to filter tasks by, if no parent key is provided, pass in "all" as the parameter'
                ),
        },
    }, async (args: {
        parentKey: string;
    }) => {
        try {
            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);

            // Check if parentKey is 'all' and set to empty string to fetch all tasks
            const parentKey = args.parentKey === 'all' ? '' : args.parentKey;

            logger.info(`Finding next task with args: ${JSON.stringify(args)}`);

            // Call the findNextJiraTask function with parentKey
            const result = await findNextJiraTask(
                parentKey,
                logger,
                {
                    jiraConfig
                }
            );

            if (!result.success) {
                logger.error(`Failed to find next task: ${result.error?.message || 'Unknown error'}`);
                return createErrorResponse(`Failed to find next task: ${result.error?.message || 'Unknown error'}`);
            }

            // If no next task found
            if (!result.data?.nextTask) {
                logger.info('No eligible next task found. All tasks are either completed or have unsatisfied dependencies');
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: 'No eligible next task found. All tasks are either completed or have unsatisfied dependencies'
                        }
                    ]
                };
            }

            // Return the next task data
            const nextTask = result.data.nextTask;
            logger.info(`Successfully found next task: ${nextTask.id || 'No available tasks'}`);
            
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: typeof nextTask === 'object'
                            ? JSON.stringify(nextTask, null, 2)
                            : String(nextTask)
                    }
                ]
            };

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in next-jira-task tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to find next task: ${errorMessage}`);
        }
    });
}
