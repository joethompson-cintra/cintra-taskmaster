/**
 * tools/add-jira-comment.ts
 * Tool to add a comment to a Jira issue
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { JiraClient } from '../../utils/jira/jira-client';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

export function registerAddJiraCommentTool(server: McpServer, getSessionConfig?: () => any): void {

    server.registerTool('add_jira_comment', {
        title: 'Add Jira Comment',
        description: 'Add a comment to a Jira issue',
        inputSchema: {
            id: z
                .string()
                .describe("Jira issue key (e.g., 'PROJ-123')"),
            comment: z
                .string()
                .describe('Comment text to add to the Jira issue')
        },
    }, async (args: {
        id: string;
        comment: string;
    }) => {
        try {
            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);

            const { id, comment } = args;

            // Validate required parameters
            if (!id) {
                logger.error('Jira issue key is required');
                return createErrorResponse('Jira issue key is required');
            }

            if (!comment) {
                logger.error('Comment text is required');
                return createErrorResponse('Comment text is required');
            }

            logger.info(`Adding comment to Jira issue ${id}`);

            // Initialize the JiraClient with session-specific configuration
            const jiraClient = new JiraClient(jiraConfig);

            // Check if Jira is enabled
            if (!jiraClient.isReady()) {
                logger.error('Jira integration is not properly configured');
                return createErrorResponse('Jira integration is not properly configured');
            }

            // Add the comment using the JiraClient
            const result = await jiraClient.addComment(id, comment, { log: logger });

            if (!result.success) {
                logger.error(`Failed to add comment to Jira issue ${id}: ${result.error?.message || 'Unknown error'}`);
                return createErrorResponse(`Failed to add comment to Jira issue: ${result.error?.message || 'Unknown error'}`);
            }

            const responseData = {
                issueKey: id,
                commentId: result.data.id,
                commentText: comment,
                author: result.data.author?.displayName || 'Unknown',
                created: result.data.created,
                message: `Comment successfully added to Jira issue ${id}`
            };

            logger.info(`Comment successfully added to Jira issue ${id}`);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(responseData, null, 2)
                }]
            };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in add-jira-comment tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to add comment: ${errorMessage}`);
        }
    });
} 