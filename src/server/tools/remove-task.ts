/**
 * tools/remove-task.ts
 * Tool to remove Jira tasks by ID
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { removeJiraTask } from '../../utils/jira/jira-utils';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

export function registerRemoveTaskTool(server: McpServer, getSessionConfig?: () => any): void {

    server.registerTool('remove_jira_task', {
        title: 'Remove Jira Task',
        description: 'Remove a Jira issue (task or subtask) from the Jira project',
        inputSchema: {
            id: z
                .string()
                .describe(
                    "Jira issue key(s) to remove (e.g., 'PROJ-123' or 'PROJ-123,PROJ-124')"
                ),
        },
    }, async (args: {
        id: string;
    }) => {
        try {

            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);
            
            const { id } = args;

            // Validate task ID
            if (!id) {
                logger.error('Jira issue key is required');
                return createErrorResponse('Jira issue key is required');
            }

            // Split task IDs if comma-separated
            const taskIdArray = id.split(',').map((taskId) => taskId.trim());

            logger.info(
                `Removing ${taskIdArray.length} Jira issue(s) with key(s): ${taskIdArray.join(', ')}`
            );

            // Remove tasks one by one
            const results = [];

            for (const taskId of taskIdArray) {
                try {
                    const result = await removeJiraTask(taskId, logger, { jiraConfig });
                    if (result.success) {
                        results.push({
                            taskId,
                            success: true,
                            message: result.data.message,
                            removedTask: result.data.removedTask
                        });
                        logger.info(`Successfully removed Jira issue: ${taskId}`);
                    } else {
                        results.push({
                            taskId,
                            success: false,
                            error: result.error?.message || 'Unknown error'
                        });
                        logger.error(
                            `Error removing Jira issue ${taskId}: ${result.error?.message || 'Unknown error'}`
                        );
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    results.push({
                        taskId,
                        success: false,
                        error: errorMessage
                    });
                    logger.error(`Error removing Jira issue ${taskId}: ${errorMessage}`);
                }
            }

            // Check if all tasks were successfully removed
            const successfulRemovals = results.filter((r) => r.success);
            const failedRemovals = results.filter((r) => !r.success);

            if (successfulRemovals.length === 0) {
                // All removals failed
                return createErrorResponse(
                    `Failed to remove any Jira issues. Details: ${failedRemovals
                        .map((r) => `${r.taskId}: ${r.error}`)
                        .join('; ')}`
                );
            }

            // At least some tasks were removed successfully
            const responseData = {
                totalIssues: taskIdArray.length,
                successful: successfulRemovals.length,
                failed: failedRemovals.length,
                results: results
            };

            logger.info(`Task removal completed. Successfully removed ${successfulRemovals.length} out of ${taskIdArray.length} issues`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(responseData, null, 2)
                }]
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in remove-jira-task tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to remove task: ${errorMessage}`);
        }
    });
} 