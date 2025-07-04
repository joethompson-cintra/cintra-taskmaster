/**
 * tools/update-task.ts
 * Tool to update Jira tasks with new information using LLM processing
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { fetchJiraTaskDetails } from '../../utils/jira/jira-utils';
import { JiraClient } from '../../utils/jira/jira-client';
import { JiraTicket } from '../../utils/jira/jira-ticket';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';
import { generateText } from '../../utils/ai-services';

export function registerUpdateTaskTool(server: McpServer, getSessionConfig?: () => any): void {
    server.registerTool('update_jira_task', {
        title: 'Update Jira Task',
        description: 'Updates a single Jira task by ID with new information or context provided in the prompt',
        inputSchema: {
            id: z
                .string()
                .describe("Jira issue key of the task to update (e.g., 'PROJ-123')"),
            prompt: z
                .string()
                .describe('A prompt given to an LLM describing the changes to make to Jira tasks (Be very detailed about which fields of the task need to be updated and what changes should be made)'),
            research: z
                .boolean()
                .optional()
                .describe('Use Perplexity AI for research-backed updates (not currently implemented)')
        },
    }, async (args: {
        id: string;
        prompt: string;
        research?: boolean;
    }) => {
        try {
            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);

            // Validate required parameters
            if (!args.id) {
                logger.error('Task ID is required');
                return createErrorResponse('Task ID is required');
            }

            if (!args.prompt) {
                logger.error('Prompt with new information is required');
                return createErrorResponse('Prompt with new information is required');
            }

            // Validate task ID format
            if (!args.id.includes('-')) {
                logger.error('Task ID must be in the format "PROJ-123"');
                return createErrorResponse('Task ID must be in the format "PROJ-123"');
            }

            logger.info(`Updating Jira task ${args.id} with new information using LLM processing`);

            // Create Jira client
            const jiraClient = new JiraClient(jiraConfig);

            if (!jiraClient.isReady()) {
                logger.error('Jira integration is not properly configured');
                return createErrorResponse('Jira integration is not properly configured');
            }

            // First, fetch the current task details
            logger.info(`Fetching current details for ${args.id}`);
            const fetchResult = await fetchJiraTaskDetails(
                args.id,
                false, // withSubtasks
                logger,
                { 
                    includeImages: false, 
                    includeComments: false, 
                    includeContext: false,
                    jiraConfig
                }
            );

            if (!fetchResult.success) {
                logger.error(`Failed to fetch task: ${fetchResult.error?.message || 'Unknown error'}`);
                return createErrorResponse(`Failed to fetch task: ${fetchResult.error?.message || 'Unknown error'}`);
            }

            const currentTask = fetchResult.data?.task;
            if (!currentTask) {
                logger.error('No task data found');
                return createErrorResponse('No task data found');
            }

            // Convert the current task to markdown format for LLM processing
            const currentTicket = new JiraTicket({
                title: currentTask.title,
                description: currentTask.description,
                details: currentTask.details,
                acceptanceCriteria: currentTask.acceptanceCriteria,
                testStrategy: currentTask.testStrategy,
                priority: currentTask.priority,
                issueType: currentTask.issueType,
                parentKey: currentTask.parentKey,
                labels: currentTask.labels,
                assignee: currentTask.assignee
            });

            const currentMarkdown = currentTicket.toMarkdown();
            logger.info(`Current ticket converted to markdown for LLM processing`);

            // Create system prompt for the LLM to return only changed fields
            const systemPrompt = `You are a Jira ticket update assistant. You will be given a Jira ticket in markdown format and a user instruction describing what changes need to be made to the ticket.

CRITICAL: You must NEVER copy the user instruction text into the ticket. Instead, you must EXECUTE the instruction by making the actual changes to the ticket content.

Your task is to:
1. Read and understand the current ticket content
2. Understand what the user instruction is asking you to do
3. Determine which specific fields need to be updated
4. Return ONLY a JSON object containing the fields that need to be changed

AVAILABLE FIELDS:
- "title": string - The ticket title/summary
- "description": string - The main description content
- "details": string - Implementation details content (from "## Implementation Details" section)
- "acceptanceCriteria": string - Acceptance criteria content (from "## Acceptance Criteria" section)  
- "testStrategy": string - Test strategy content (from "## Test Strategy (TDD)" section)
- "priority": string - Priority level (e.g., "High", "Medium", "Low")
- "labels": array of strings - Labels/tags for the ticket

EXAMPLES:
- If user says "mark all acceptance criteria as complete" → Return: {"acceptanceCriteria": "updated content with - [x] instead of - [ ]"}
- If user says "add a new implementation step" → Return: {"details": "original content + new step"}
- If user says "update the title to 'New Title'" → Return: {"title": "New Title"}
- If user says "mark the first acceptance criteria as done" → Return: {"acceptanceCriteria": "content with only first item changed to - [x]"}

FORMATTING RULES:
- Use markdown formatting: **bold**, *italic*, \`code\`, bullet lists (-), numbered lists (1.), checkboxes (- [ ] or - [x])
- Preserve all existing formatting in the field you're updating
- Only include fields that actually need to be changed in your JSON response
- If updating a section, include the complete updated content for that section

CRITICAL: Return ONLY a valid JSON object with the fields that need to be updated. Do NOT include any explanatory text or markdown formatting around the JSON. Do NOT include fields that don't need to be changed.`;

            const llmPrompt = `Current Jira ticket:

${currentMarkdown}

User instruction: ${args.prompt}

Analyze the instruction and return a JSON object containing only the fields that need to be updated based on the instruction.`;

            // Send to LLM for processing
            logger.info(`Sending ticket to LLM for field-specific processing`);
            logger.info(`User instruction: ${args.prompt}`);
            
            const llmResponse = await generateText(llmPrompt, systemPrompt, {
                model: 'claude-sonnet-4-20250514',
                maxTokens: 20000, // Reduced from 50000 to prevent timeouts
                temperature: 0.1 // Lower temperature for more consistent formatting
            });

            logger.info(`Received field updates from LLM`);
            logger.info(`LLM Response: ${llmResponse.substring(0, 1000)}...`);

            // Parse the JSON response
            let updatedFields: any;
            try {
                // Clean the response to ensure it's valid JSON
                const cleanedResponse = llmResponse.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
                updatedFields = JSON.parse(cleanedResponse);
                logger.info(`Successfully parsed LLM response as JSON`);
                logger.info(`Fields to update: ${Object.keys(updatedFields).join(', ')}`);
            } catch (parseError) {
                logger.error(`Failed to parse LLM response as JSON: ${parseError}`);
                logger.error(`Raw LLM response: ${llmResponse}`);
                return createErrorResponse(`Failed to parse LLM response as valid JSON. Please try again with a clearer instruction.`);
            }

            // Validate that we have at least one field to update
            if (!updatedFields || Object.keys(updatedFields).length === 0) {
                logger.warn(`No fields to update found in LLM response`);
                return createErrorResponse(`No fields to update were identified. Please provide a more specific instruction.`);
            }

            // Update only the specific fields in the current ticket
            currentTicket.update(updatedFields);
            logger.info(`Updated ticket with LLM-provided field changes`);

            // Update the issue using the JiraClient
            logger.info(`Updating Jira issue ${args.id} with field-specific changes`);
            const updateResult = await jiraClient.updateIssue(
                args.id,
                {
                    fields: {
                        description: currentTicket.toADF()
                    }
                },
                { log: logger }
            );

            if (!updateResult.success) {
                logger.error(`Failed to update Jira issue: ${updateResult.error?.message || 'Unknown error'}`);
                return createErrorResponse(`Failed to update Jira issue: ${updateResult.error?.message || 'Unknown error'}`);
            }

            // Create detailed success response showing what was updated
            const updatedFieldsList = Object.keys(updatedFields).map(field => {
                const fieldNames: { [key: string]: string } = {
                    'title': 'Title',
                    'description': 'Description',
                    'details': 'Implementation Details',
                    'acceptanceCriteria': 'Acceptance Criteria',
                    'testStrategy': 'Test Strategy',
                    'priority': 'Priority',
                    'labels': 'Labels'
                };
                return fieldNames[field] || field;
            });

            const successMessage = `Successfully updated Jira task ${args.id}`;
            logger.info(`${successMessage} - Updated fields: ${updatedFieldsList.join(', ')}`);

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `${successMessage}\n\n**Task ID:** ${args.id}\n\n**Updated Fields:** ${updatedFieldsList.join(', ')}\n\n**Changes Applied:** ${args.prompt}\n\n**Processing Method:** LLM-powered field-specific update (preserves unchanged sections)`
                    }
                ]
            };

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in update-jira-task tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to update Jira task: ${errorMessage}`);
        }
    });
}
