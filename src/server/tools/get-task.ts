/**
 * tools/get-task.ts
 * Tool to get task details by ID
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { fetchJiraTaskDetails } from '../../utils/jira/jira-utils';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

export function registerGetTaskTool(server: McpServer, getSessionConfig?: () => any): void {

    server.registerTool('get_jira_task', {
        title: 'Get Jira Task',
        description: 'Get detailed information about a specific Jira task',
        inputSchema: {
            id: z
                .string()
                .describe(
                    'Task ID to get (Important: Make sure to include the project prefix, e.g. PROJ-123)'
                ),
            withSubtasks: z
                .boolean()
                .optional()
                .default(false)
                .describe('If true, will fetch subtasks for the parent task'),
            includeImages: z
                .boolean()
                .optional()
                .default(true)
                .describe(
                    'If true, will fetch and include image attachments (default: true)'
                ),
            includeComments: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    'If true, will fetch and include comments (default: false)'
                ),
            includeContext: z
                .boolean()
                .optional()
                .default(true)
                .describe('If true, will include related tickets and PR context (default: true)'),
            maxRelatedTickets: z
                .number()
                .min(1)
                .max(10)
                .optional()
                .default(5)
                .describe('Maximum number of related tickets to fetch in context (default: 10, max: 50)')
        },
    }, async (args: {
        id: string;
        withSubtasks?: boolean;
        includeImages?: boolean;
        includeComments?: boolean;
        includeContext?: boolean;
        maxRelatedTickets?: number;
    }) => {
        try {
            // Get configurations using the shared config hook
            const { jiraConfig, bitbucketConfig } = useSessionConfigs(getSessionConfig, logger);

            // Destructure args with defaults (inlined from showJiraTaskDirect)
            const {
                id: taskId,
                includeImages = true,
                includeComments = false,
                includeContext = false,
                withSubtasks = false,
                maxRelatedTickets = 10
            } = args;

            // Validate task ID
            if (!taskId) {
                logger.error('Task ID is required');
                return createErrorResponse('Task ID is required');
            }

            logger.info(
                `Retrieving task details for Jira issue: ${taskId}${includeImages === false ? ' (excluding images)' : ''}${includeComments ? ' (including comments)' : ''}`
            );

            // Use the dedicated function from jira-utils.js to fetch task details
            const result = await fetchJiraTaskDetails(
                taskId,
                withSubtasks,
                logger,
                { 
                    includeImages, 
                    includeComments, 
                    includeContext, 
                    maxRelatedTickets, 
                    maxTokens: 40000,
                    jiraConfig, // Pass the session-specific config
                    bitbucketConfig // Pass the session-specific Bitbucket config
                }
            );

            if (!result.success) {
                return createErrorResponse(`Failed to fetch task: ${result.error?.message || 'Unknown error'}`);
            }

            const task = result.data?.task;

            // Extract context images before formatting response
            let contextImages: any[] = [];
            if (task?._contextImages && task._contextImages.length > 0) {
                contextImages = task._contextImages;
                // Clean up the temporary context images from the ticket object BEFORE JSON.stringify
                delete task._contextImages;
            }

            // Build the content array with proper typing
            const content: Array<{
                type: 'text';
                text: string;
            } | {
                type: 'image';
                data: string;
                mimeType: string;
            }> = [];

            // Add task data
            content.push({
                type: 'text' as const,
                text: typeof task === 'object'
                    ? JSON.stringify(task, null, 2)
                    : String(task)
            });

            // Add main ticket images to the content array
            if (result.data?.images && result.data.images.length > 0) {
                for (let i = 0; i < result.data.images.length; i++) {
                    const imageData = result.data.images[i];

                    // Add image description
                    content.push({
                        type: 'text' as const,
                        text: `Main Ticket Image ${i + 1}: ${imageData.filename || 'Unknown filename'} (${imageData.mimeType}, ${Math.round(imageData.size / 1024)}KB${imageData.isThumbnail ? ', thumbnail' : ''})`
                    });

                    // Add the actual image
                    content.push({
                        type: 'image' as const,
                        data: imageData.base64,
                        mimeType: imageData.mimeType
                    });
                }
            }

            // Add context images to the content array
            if (contextImages.length > 0) {
                for (let i = 0; i < contextImages.length; i++) {
                    const imageData = contextImages[i];

                    // Add image description with source ticket info
                    content.push({
                        type: 'text' as const,
                        text: `Context Image ${i + 1} from ${imageData.sourceTicket} (${imageData.sourceTicketSummary}): ${imageData.filename || 'Unknown filename'} (${imageData.mimeType}, ${Math.round(imageData.size / 1024)}KB${imageData.isThumbnail ? ', thumbnail' : ''})`
                    });

                    // Add the actual image
                    content.push({
                        type: 'image' as const,
                        data: imageData.base64,
                        mimeType: imageData.mimeType
                    });
                }
            }

            logger.info(`Task details retrieval completed for issue: ${taskId}`);
            return { content };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in get-jira-task tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to get task: ${errorMessage}`);
        }
    });
}
