/**
 * tools/add-task.ts
 * Tool to create new Jira issues
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { createJiraIssue } from '../../utils/jira/jira-utils';
import { JiraTicket } from '../../utils/jira/jira-ticket';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

export function registerAddTaskTool(server: McpServer, getSessionConfig?: () => any): void {
    server.registerTool('add_jira_issue', {
        title: 'Add Jira Issue',
        description: 'Creates a new issue in Jira with proper markdown formatting. All text fields support full markdown syntax including headers, lists, code blocks, bold/italic text, and links. The content is automatically converted to Atlassian Document Format (ADF) for optimal Jira display.',
        inputSchema: {
            title: z
                .string()
                .describe(
                    'The title/summary for the new issue (plain text, no markdown)'
                ),
            description: z
                .string()
                .optional()
                .describe(
                    'The main description for the issue. FORMATTING GUIDE: Use markdown syntax - ## for headers, **bold**, *italic*, `inline code`, ```language code blocks```, - for bullet lists, 1. for numbered lists, [link text](url) for links. This will be displayed as the main ticket description in Jira.'
                ),
            issueType: z
                .string()
                .optional()
                .describe(
                    'The issue type for the issue (default: Task, Epic, Story, Bug, Subtask)'
                ),
            details: z
                .string()
                .optional()
                .describe(
                    'Implementation details and technical specifications. FORMATTING GUIDE: Use markdown for structure - ## Implementation Steps, ### Database Schema, ```sql code```, **Important:** notes, - Step 1, - Step 2. This content will appear in a blue "Implementation Details" panel in Jira for clear separation from the main description.'
                ),
            acceptanceCriteria: z
                .string()
                .optional()
                .describe(
                    'Acceptance criteria and requirements that must be met. FORMATTING GUIDE: Use markdown checklists - [ ] for incomplete items, **Must have:** for emphasis, ### Additional Requirements for sections. This content will appear in a green "Acceptance Criteria" panel in Jira to highlight completion requirements.'
                ),
            testStrategy: z
                .string()
                .optional()
                .describe(
                    'Testing approach and strategy. FORMATTING GUIDE: Use markdown structure - ## Unit Tests, ```bash test commands```, ### Performance Tests, **Target:** for goals, - Test case 1. This content will appear in a gray "Test Strategy (TDD)" panel in Jira for clear testing guidance.'
                ),
            parentKey: z
                .string()
                .optional()
                .describe(
                    "The Jira key of the Epic/parent to link this issue to (e.g., 'PROJ-5')"
                ),
            priority: z
                .string()
                .optional()
                .describe("Jira priority name (e.g., 'Medium', 'High')"),
            assignee: z
                .string()
                .optional()
                .describe('Jira account ID or email of the assignee'),
            labels: z
                .array(z.string())
                .optional()
                .describe('List of labels to add'),
        },
    }, async (args: {
        title: string;
        description?: string;
        issueType?: string;
        details?: string;
        acceptanceCriteria?: string;
        testStrategy?: string;
        parentKey?: string;
        priority?: string;
        assignee?: string;
        labels?: string[];
    }) => {
        try {
            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);

            logger.info(`Creating Jira task with title "${args.title}"`);

            // Validate required parameters
            if (!args.title) {
                logger.error('Task title/summary is required');
                return createErrorResponse('Task title/summary is required');
            }

            if (args.parentKey) {
                logger.info(`Task will be linked to parent/epic: ${args.parentKey}`);
            }

            // Use the JiraTicket class to manage the ticket data and ADF conversion
            const jiraTicket = new JiraTicket({
                title: args.title,
                description: args.description,
                details: args.details,
                acceptanceCriteria: args.acceptanceCriteria,
                testStrategy: args.testStrategy,
                parentKey: args.parentKey,
                priority: args.priority
                    ? args.priority.charAt(0).toUpperCase() + args.priority.slice(1)
                    : 'Medium',
                issueType: args.issueType || 'Task',
                assignee: args.assignee,
                labels: args.labels || []
            });

            // Call the createJiraIssue function
            const result = await createJiraIssue(jiraTicket, {
                jiraConfig,
                log: logger  // Pass logger in options object
            });

            if (!result.success) {
                logger.error(`Failed to create Jira issue: ${result.error?.message || 'Unknown error'}`);
                return createErrorResponse(`Failed to create Jira issue: ${result.error?.message || 'Unknown error'}`);
            }

            // Success response
            const issueData = result.data;
            const successMessage = `Successfully created Jira ${jiraTicket.issueType.toLowerCase()} "${args.title}" with key: ${issueData.key}`;
            
            logger.info(successMessage);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `${successMessage}\n\nIssue Details:\n- Key: ${issueData.key}\n- ID: ${issueData.id}\n- Type: ${jiraTicket.issueType}\n- Priority: ${jiraTicket.priority}${args.parentKey ? `\n- Parent: ${args.parentKey}` : ''}${args.assignee ? `\n- Assignee: ${args.assignee}` : ''}`
                    }
                ]
            };

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in add-jira-issue tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to create Jira issue: ${errorMessage}`);
        }
    });
}
