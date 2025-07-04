/**
 * jira-utils.ts
 * Utility functions for interacting with Jira API
 */
// import { generateTextService } from '../../../../scripts/modules/ai-services-unified.js';
// import { isSilentMode, log } from '../../../../scripts/modules/utils.js';
import { JiraTicket } from './jira-ticket';
import { JiraClient } from './jira-client';
import { Anthropic } from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { ContextAggregator } from '../bitbucket/context-aggregator';
import { JiraRelationshipResolver } from './jira-relationship-resolver';
import { BitbucketClient } from '../bitbucket/bitbucket-client';
import { PRTicketMatcher } from '../bitbucket/pr-ticket-matcher';
import {
	Logger,
	FetchOptions,
	CompressionResult,
} from '../../types/jira';

/**
 * Estimate token count for text content
 * Rough approximation: 1 token ≈ 4 characters
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
function estimateTokenCount(text: string | null | undefined): number {
	if (!text || typeof text !== 'string') return 0;
	return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for an object by JSON stringifying it
 * @param obj - Object to estimate tokens for
 * @returns Estimated token count
 */
function estimateObjectTokens(obj: any): number {
	if (!obj) return 0;
	try {
		const jsonString = JSON.stringify(obj);
		return estimateTokenCount(jsonString);
	} catch (error) {
		return 0;
	}
}

/**
 * Trim unnecessary fields from pull request data to reduce token usage
 * @param pullRequests - Array of pull request objects
 * @returns Trimmed pull request objects
 */
function trimPullRequestFields(pullRequests: any[]): any[] {
	if (!pullRequests || !Array.isArray(pullRequests)) {
		return pullRequests;
	}

	return pullRequests.map((pr: any) => {
		const trimmedPR = { ...pr };

		// Remove avatar field from reviewers
		if (trimmedPR.reviewers && Array.isArray(trimmedPR.reviewers)) {
			trimmedPR.reviewers = trimmedPR.reviewers.map((reviewer: any) => {
				const { avatar, ...trimmedReviewer } = reviewer;
				return trimmedReviewer;
			});
		}

		// Remove unnecessary fields from commits
		if (trimmedPR.commits && Array.isArray(trimmedPR.commits)) {
			trimmedPR.commits = trimmedPR.commits.map((commit: any) => {
				const { hash, shortHash, displayId, url, ...trimmedCommit } = commit;
				return trimmedCommit;
			});
		}

		// Remove avatarUrls from attachments (if they exist)
		if (trimmedPR.attachments && Array.isArray(trimmedPR.attachments)) {
			trimmedPR.attachments = trimmedPR.attachments.map((attachment: any) => {
				const { avatarUrls, ...trimmedAttachment } = attachment;
				return trimmedAttachment;
			});
		}

		return trimmedPR;
	});
}

/**
 * Trim response content to fit within token limits
 * @param responseData - Response data to trim
 * @param maxTokens - Maximum allowed tokens
 * @param log - Logger instance
 * @returns Trimmed response data
 */
function trimResponseForTokenLimit(responseData: any, maxTokens: number, log: Logger): any {
	const { task, allTasks, images } = responseData;
	
	// Calculate current token usage
	const mainTaskTokens = estimateObjectTokens(task);
	const imagesTokens = images ? images.length * 50 : 0; // Rough estimate for image metadata
	let currentTokens = mainTaskTokens + imagesTokens;
	
	log.info(`Initial token estimate: ${currentTokens} (main task: ${mainTaskTokens}, images: ${imagesTokens})`);
	
	// If we're already under the limit, return as is
	if (currentTokens <= maxTokens) {
		log.info(`Response within token limit (${currentTokens} <= ${maxTokens})`);
		return responseData;
	}
	
	// Create a copy to modify
	const trimmedTask = JSON.parse(JSON.stringify(task));
	let trimmedImages = images ? [...images] : [];
	
	// Track trimming statistics
	const trimStats = {
		originalRelatedTickets: trimmedTask.relatedTickets ? trimmedTask.relatedTickets.length : 0,
		removedTickets: 0,
		removedImages: 0,
		trimmedPRs: 0,
		trimmedFields: 0
	};
	
	// Trim in order of importance (least important first)
	const trimSteps = [
		{
			name: 'Remove context images',
				action: () => {
					if (trimmedImages.length > 0) {
						const contextImagesRemoved = trimmedImages.length;
						trimStats.removedImages = contextImagesRemoved;
						trimmedImages = [];
						log.info(`Removed ${contextImagesRemoved} context images`);
						return contextImagesRemoved * 50; // Rough token savings
					}
					return 0;
				}
		},
		{
			name: 'Trim related tickets by relevance score',
			action: () => {
				if (!trimmedTask.relatedTickets || trimmedTask.relatedTickets.length === 0) {
					return 0;
				}
				
				// Sort related tickets by relevance score (lowest first for removal)
				// Use the existing relevanceScore property calculated by the context aggregator
				const sortedTickets = [...trimmedTask.relatedTickets].sort((a: any, b: any) => {
					const scoreA = a.relevanceScore || 0;
					const scoreB = b.relevanceScore || 0;
					return scoreA - scoreB; // Ascending order (lowest first for removal)
				});
				
				let tokensFreed = 0;
				let ticketsRemoved = 0;
				
				// Remove tickets one by one until we're under the limit
				while (sortedTickets.length > 0 && currentTokens > maxTokens) {
					const removedTicket = sortedTickets.shift();
					const ticketTokens = estimateObjectTokens(removedTicket);
					tokensFreed += ticketTokens;
					currentTokens -= ticketTokens;
					ticketsRemoved++;
					
					log.info(`Removed ticket ${removedTicket.ticket?.jiraKey || removedTicket.ticket?.id || 'unknown'} (relevance: ${removedTicket.relevanceScore || 0})`);
				}
				
				// Update the task with remaining tickets
				trimmedTask.relatedTickets = sortedTickets;
				trimStats.removedTickets = ticketsRemoved;
				
				if (ticketsRemoved > 0) {
					log.info(`Removed ${ticketsRemoved} related tickets (saved ~${tokensFreed} tokens)`);
				}
				
				return tokensFreed;
			}
		},
		{
			name: 'Trim PR data',
			action: () => {
				let tokensFreed = 0;
				let prsRemoved = 0;
				
				// Trim PR data from main task
				if (trimmedTask.pullRequests && trimmedTask.pullRequests.length > 0) {
					const originalPRs = trimmedTask.pullRequests.length;
					if (originalPRs > 2) {
						trimmedTask.pullRequests = trimmedTask.pullRequests.slice(0, 2); // Keep only 2 most recent
						prsRemoved += (originalPRs - 2);
						tokensFreed += (originalPRs - 2) * 100; // Rough estimate
						log.info(`Trimmed PR data from ${originalPRs} to 2 PRs`);
					}
				}
				
				// Trim PR data from related tickets
				if (trimmedTask.relatedTickets) {
					trimmedTask.relatedTickets.forEach((ticket: any) => {
						if (ticket.pullRequests && ticket.pullRequests.length > 1) {
							const originalPRs = ticket.pullRequests.length;
							ticket.pullRequests = ticket.pullRequests.slice(0, 1); // Keep only 1 PR per related ticket
							prsRemoved += (originalPRs - 1);
							tokensFreed += (originalPRs - 1) * 50; // Rough estimate
						}
					});
				}
				
				trimStats.trimmedPRs = prsRemoved;
				currentTokens -= tokensFreed;
				return tokensFreed;
			}
		},
		{
			name: 'Trim detailed fields',
			action: () => {
				let tokensFreed = 0;
				let fieldsCount = 0;
				
				// Trim detailed fields from main task
				if (trimmedTask.details && trimmedTask.details.length > 500) {
					const originalLength = trimmedTask.details.length;
					trimmedTask.details = trimmedTask.details.substring(0, 500) + '... [truncated]';
					tokensFreed += estimateTokenCount(trimmedTask.details.substring(500));
					fieldsCount++;
					log.info(`Truncated main task details from ${originalLength} to 500 characters`);
				}
				
				// Trim detailed fields from related tickets
				if (trimmedTask.relatedTickets) {
					trimmedTask.relatedTickets.forEach((ticket: any) => {
						if (ticket.ticket?.description && ticket.ticket.description.length > 200) {
							const originalLength = ticket.ticket.description.length;
							ticket.ticket.description = ticket.ticket.description.substring(0, 200) + '... [truncated]';
							tokensFreed += estimateTokenCount(ticket.ticket.description.substring(200));
							fieldsCount++;
						}
						if (ticket.ticket?.details && ticket.ticket.details.length > 200) {
							const originalLength = ticket.ticket.details.length;
							ticket.ticket.details = ticket.ticket.details.substring(0, 200) + '... [truncated]';
							tokensFreed += estimateTokenCount(ticket.ticket.details.substring(200));
							fieldsCount++;
						}
					});
				}
				
				trimStats.trimmedFields = fieldsCount;
				currentTokens -= tokensFreed;
				return tokensFreed;
			}
		},
		{
			name: 'Remove remaining related tickets',
			action: () => {
				if (trimmedTask.relatedTickets && trimmedTask.relatedTickets.length > 0) {
					const tokensFreed = estimateObjectTokens(trimmedTask.relatedTickets);
					const ticketsRemoved = trimmedTask.relatedTickets.length;
					trimStats.removedTickets += ticketsRemoved;
					trimmedTask.relatedTickets = [];
					currentTokens -= tokensFreed;
					log.info(`Removed all remaining ${ticketsRemoved} related tickets`);
					return tokensFreed;
				}
				return 0;
			}
		}
	];
	
	// Execute trim steps until we're under the limit
	for (const step of trimSteps) {
		if (currentTokens <= maxTokens) break;
		
		const tokensFreed = step.action();
		if (tokensFreed > 0) {
			log.info(`${step.name}: freed ~${tokensFreed} tokens, current estimate: ${currentTokens}`);
		}
	}
	
	// Update relationshipSummary to reflect trimmed data
	if (trimmedTask.relationshipSummary) {
		const remainingTickets = trimmedTask.relatedTickets || [];
		
		trimmedTask.relationshipSummary = {
			subtasks: remainingTickets.filter((t: any) =>
				t.relationships && t.relationships.some((r: any) => r.type === 'subtask')
			).length,
			dependencies: remainingTickets.filter((t: any) =>
				t.relationships && t.relationships.some((r: any) => r.type === 'dependency')
			).length,
			relatedTickets: remainingTickets.filter((t: any) =>
				t.relationships && t.relationships.some((r: any) => r.type === 'related')
			).length,
			totalUnique: remainingTickets.length,
			// Add trimming information
			trimmedDueToTokenLimit: trimStats.removedTickets > 0,
			originalTotal: trimStats.originalRelatedTickets,
			removedForTokenLimit: trimStats.removedTickets
		};
	}
	
	// Update contextSummary to reflect trimmed data
	if (trimmedTask.contextSummary) {
		const remainingTickets = trimmedTask.relatedTickets || [];
		const completedCount = remainingTickets.filter((t: any) => 
			t.ticket && (t.ticket.status === 'done' || t.ticket.status === 'Done')
		).length;
		const activeCount = remainingTickets.filter((t: any) => 
			t.ticket && t.ticket.status && !['done', 'Done', 'closed', 'Closed'].includes(t.ticket.status)
		).length;
		
		// Count total PRs from remaining tickets
		const totalPRs = remainingTickets.reduce((count: number, ticket: any) => {
			return count + (ticket.pullRequests ? ticket.pullRequests.length : 0);
		}, (trimmedTask.pullRequests ? trimmedTask.pullRequests.length : 0));
		
		const mergedPRs = remainingTickets.reduce((count: number, ticket: any) => {
			if (ticket.pullRequests) {
				return count + ticket.pullRequests.filter((pr: any) => pr.state === 'MERGED').length;
			}
			return count;
		}, (trimmedTask.pullRequests ? trimmedTask.pullRequests.filter((pr: any) => pr.state === 'MERGED').length : 0));
		
		// Calculate status breakdown
		const statusBreakdown: Record<string, number> = {};
		remainingTickets.forEach((ticket: any) => {
			if (ticket.ticket && ticket.ticket.status) {
				const status = ticket.ticket.status;
				statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
			}
		});
		
		// Calculate average relevance
		const avgRelevance = remainingTickets.length > 0 
			? remainingTickets.reduce((sum: number, t: any) => sum + (t.relevanceScore || 0), 0) / remainingTickets.length
			: 0;
		
		trimmedTask.contextSummary = {
			totalRelated: remainingTickets.length,
			filteredOut: trimStats.originalRelatedTickets - remainingTickets.length,
			completedWork: completedCount,
			activeWork: activeCount,
			totalPRs: totalPRs,
			mergedPRs: mergedPRs,
			averageRelevance: Math.round(avgRelevance),
			statusBreakdown: statusBreakdown,
			// Add trimming information
			trimmedDueToTokenLimit: trimStats.removedTickets > 0 || trimStats.removedImages > 0 || trimStats.trimmedPRs > 0,
			originalContextSize: trimStats.originalRelatedTickets,
			removedForTokenLimit: {
				tickets: trimStats.removedTickets,
				images: trimStats.removedImages,
				prs: trimStats.trimmedPRs,
				truncatedFields: trimStats.trimmedFields
			},
			tokenLimitApplied: maxTokens
		};
	}
	
	// Final check
	const finalTokens = estimateObjectTokens(trimmedTask) + (trimmedImages.length * 50);
	log.info(`Final token estimate after trimming: ${finalTokens} (target: ${maxTokens})`);
	
	if (finalTokens > maxTokens) {
		log.warn(`Response still exceeds token limit after trimming (${finalTokens} > ${maxTokens})`);
		// Add a warning to the task
		trimmedTask._trimWarning = `Response was trimmed to fit within token limits. Some context may be missing.`;
	}
	
	// Log trimming summary
	if (trimStats.removedTickets > 0 || trimStats.removedImages > 0 || trimStats.trimmedPRs > 0) {
		log.info(`Trimming summary: ${trimStats.removedTickets} tickets, ${trimStats.removedImages} images, ${trimStats.trimmedPRs} PRs, ${trimStats.trimmedFields} fields truncated`);
	}
	
	return {
		task: trimmedTask,
		allTasks: [trimmedTask], // Update allTasks to match trimmed task
		images: trimmedImages
	};
}

/**
 * Fetch a single Jira task details by its key
 * @param {string} taskId - Jira issue key to fetch
 * @param {boolean} [withSubtasks=false] - If true, will fetch subtasks for the parent task
 * @param {Object} log - Logger object
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.includeImages=true] - Whether to fetch and include image attachments
 * @param {boolean} [options.includeComments=false] - Whether to fetch and include comments
 * @param {boolean} [options.includeContext=false] - Whether to fetch and include related context (PRs, etc.)
 * @param {number} [options.maxRelatedTickets=10] - Maximum number of related tickets for context
 * @param {number} [options.maxTokens] - Maximum token count (default: 20000)
 * @returns {Promise<Object>} - Task details in Task Master format with allTasks array and any image attachments as base64
 */
export async function fetchJiraTaskDetails(
	taskId: string,
	withSubtasks: boolean = false,
	log: Logger,
	options: FetchOptions = {}
): Promise<any> {
	try {
		// Extract options with defaults
		const {
			includeImages = true,
			includeComments = false,
			includeContext = false,
			maxRelatedTickets = 5,
			maxTokens = 40000,
			jiraConfig,
			bitbucketConfig
		} = options;

		// Check if Jira is enabled using the JiraClient with session-specific config
		const jiraClient = new JiraClient(jiraConfig);

		if (!jiraClient.isReady()) {
			// Log detailed validation errors
			const validation = jiraClient.validateConfig(log);
			log.error('Jira client validation failed:', {
				missingFields: validation.missingFields,
				enabled: jiraClient.enabled,
				hasClient: !!jiraClient.client,
				error: jiraClient.error,
				config: {
					hasBaseUrl: !!jiraClient.config.baseUrl,
					hasEmail: !!jiraClient.config.email,
					hasApiToken: !!jiraClient.config.apiToken,
					hasProject: !!jiraClient.config.project
				}
			});
			
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		log.info(
			`Fetching Jira task details for key: ${taskId}${includeImages === false ? ' (excluding images)' : ''}${includeComments ? ' (including comments)' : ''}${maxTokens !== 40000 ? ` (max tokens: ${maxTokens})` : ''}`
		);

		// Fetch the issue with conditional image and comment fetching
		const issueResult = await jiraClient.fetchIssue(taskId, {
			log,
			expand: 'true',
			includeImages,
			includeComments
		});

		if (!issueResult.success) {
			return issueResult; // Return the error response from the client
		}

		// Now get subtasks if this is a parent issue
		let subtasksData = null;
		const issue = issueResult.data;

		if (withSubtasks) {
			try {
				// Use existing function to fetch subtasks
				subtasksData = await fetchTasksFromJira(taskId, withSubtasks, log, { includeComments });
			} catch (subtaskError: unknown) {
				const errorMessage = subtaskError instanceof Error ? subtaskError.message : String(subtaskError);
				log.warn(
					`Could not fetch subtasks for ${taskId}: ${errorMessage}`
				);
				// Continue without subtasks - this is not fatal
				return {
					success: false,
					error: {
						code: 'SUBTASK_FETCH_ERROR',
						message: errorMessage
					}
				};
			}
		}

		// Convert from Jira format to Task Master format
		const task = issue.toTaskMasterFormat();

		if (subtasksData && subtasksData.tasks) {
			task.subtasks = subtasksData.tasks;
		}

		// Add context if requested and available
		if (includeContext) {
			try {
				await addContextToTask(
					task,
					taskId,
					maxRelatedTickets,
					withSubtasks,
					log,
					jiraConfig,
					bitbucketConfig
				);
			} catch (contextError: unknown) {
				// Context failure should not break the main functionality
				const errorMessage = contextError instanceof Error ? contextError.message : String(contextError);
				log.warn(`Failed to add context to task ${taskId}: ${errorMessage}`);
				// Continue without context
			}
		}

		// Trim unnecessary fields from PR data to reduce token usage
		// This happens before token calculation to get accurate savings
		if (task.pullRequests && task.pullRequests.length > 0) {
			const originalPRTokens = estimateObjectTokens(task.pullRequests);
			task.pullRequests = trimPullRequestFields(task.pullRequests);
			const trimmedPRTokens = estimateObjectTokens(task.pullRequests);
			const tokensSaved = originalPRTokens - trimmedPRTokens;
			if (tokensSaved > 0) {
				log.info(`Trimmed PR fields from main task, saved ~${tokensSaved} tokens`);
			}
		}

		// Trim PR fields from related tickets as well
		if (task.relatedTickets && task.relatedTickets.length > 0) {
			let totalPRTokensSaved = 0;
			task.relatedTickets.forEach((relatedItem, index) => {
				// PR data is in relatedItem.ticket.pullRequests, not relatedItem.pullRequests
				if (relatedItem.ticket && relatedItem.ticket.pullRequests && relatedItem.ticket.pullRequests.length > 0) {
					const originalTokens = estimateObjectTokens(relatedItem.ticket.pullRequests);
					relatedItem.ticket.pullRequests = trimPullRequestFields(relatedItem.ticket.pullRequests);
					const trimmedTokens = estimateObjectTokens(relatedItem.ticket.pullRequests);
					totalPRTokensSaved += (originalTokens - trimmedTokens);
				}
			});
			if (totalPRTokensSaved > 0) {
				log.info(`Trimmed PR fields from related tickets, saved ~${totalPRTokensSaved} tokens`);
			}
		}

		// For the allTasks array, include the task itself and its subtasks
		const allTasks = [task];
		if (subtasksData && subtasksData.tasks) {
			allTasks.push(...subtasksData.tasks);
		}

		// Prepare response data
		let responseData = {
			task: task,
			allTasks: allTasks,
			images: includeImages ? (issue as any).attachmentImages || [] : []
		};

		// Apply token limiting if maxTokens is specified and > 0
		if (maxTokens > 0) {
			responseData = trimResponseForTokenLimit(responseData, maxTokens, log);
		}

		return {
			success: true,
			data: responseData
		};
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		log.error(`Error fetching Jira task details: ${errorMessage}`);

		// Handle 404 Not Found specifically
		if (error && typeof error === 'object' && 'response' in error && 
			(error as any).response && (error as any).response.status === 404) {
			return {
				success: false,
				error: {
					code: 'TASK_NOT_FOUND',
					message: `Jira issue with key ${taskId} not found`
				}
			};
		}

		// Handle other API errors
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: errorMessage || 'Error communicating with Jira API'
			}
		};
	}
}

/**
 * Create MCP-compatible content response with images
 * @param {Object} taskData - Task data from fetchJiraTaskDetails
 * @param {string} [textContent] - Optional text content to include
 * @returns {Array} - MCP content array with text and images
 */
export function createMCPContentWithImages(taskData: any, textContent: string | null = null): any[] {
	const content = [];

	// Add text content if provided
	if (textContent) {
		content.push({
			type: 'text',
			text: textContent
		});
	}

	// Add images if available
	if (taskData.images && taskData.images.length > 0) {
		for (const image of taskData.images) {
			content.push({
				type: 'image',
				data: image.data,
				mimeType: image.mimeType
			});
		}
	}

	return content;
}

/**
 * Fetch tasks from Jira for a specific parent issue key
 * @param {string} parentKey - Parent Jira issue key, if null will fetch all tasks in the project
 * @param {boolean} [withSubtasks=false] - If true, will fetch subtasks for the parent task
 * @param {Object} log - Logger object
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.includeComments=false] - Whether to fetch and include comments
 * @returns {Promise<Object>} - Tasks and statistics in Task Master format
 */
export async function fetchTasksFromJira(parentKey: string | null, withSubtasks: boolean = false, log: Logger, options: FetchOptions = {}): Promise<any> {
	try {
		// Extract options with defaults
		const {
			includeComments = false,
			jiraConfig
		} = options;

		// Check if Jira is enabled using the JiraClient with session-specific config
		const jiraClient = new JiraClient(jiraConfig);

		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		// Build JQL query based on whether parentKey is provided
		let jql;
		if (parentKey) {
			// If parentKey is provided, get subtasks for the specific parent
			jql = `project = "${jiraClient.config.project}" AND parent = "${parentKey}" ORDER BY created ASC`;
			log.info(
				`Fetching Jira subtasks for parent ${parentKey} with JQL: ${jql}${includeComments ? ' (including comments)' : ''}`
			);
		} else {
			// If no parentKey, get all tasks in the project
			jql = `project = "${jiraClient.config.project}" ORDER BY created ASC`;
			log.info(`Fetching all Jira tasks with JQL: ${jql}${includeComments ? ' (including comments)' : ''}`);
		}

		// Use the searchIssues method instead of direct HTTP request
		// Now returns JiraTicket objects directly
		const searchResult = await jiraClient.searchIssues(jql, {
			maxResults: 100,
			expand: 'true',
			log
		});

		if (!searchResult.success) {
			return searchResult; // Return the error response
		}

		const issues = searchResult.data;
		if (issues.length === 0) {
			log.info(`No issues found with the specified ID(s)`);
			return {
				success: false,
				error: {
					code: 'ISSUES_NOT_FOUND',
					message: `No issues found with the specified ID(s)`
				}
			};
		}

		// Convert JiraTicket objects to Task Master format
		const tasks = await Promise.all(
			searchResult.data.map(async (jiraTicket) => {
				// Get task in Task Master format
				const task = jiraTicket.toTaskMasterFormat();

				// Fetch subtasks if withSubtasks is true and the ticket has subtasks
				if (withSubtasks && jiraTicket.jiraKey) {
					log.info(`Fetching subtasks for ${jiraTicket.jiraKey}`);
					try {
						// Recursive call to fetch subtasks using the current issue key as parent
						const subtasksResult = await fetchTasksFromJira(
							jiraTicket.jiraKey,
							false,
							log,
							options
						);
						if (subtasksResult && subtasksResult.tasks) {
							task.subtasks = subtasksResult.tasks;
							log.info(
								`Added ${task.subtasks.length} subtasks to ${jiraTicket.jiraKey}`
							);
						}
					} catch (subtaskError: unknown) {
						const errorMessage = subtaskError instanceof Error ? subtaskError.message : String(subtaskError);
						log.warn(
							`Error fetching subtasks for ${jiraTicket.jiraKey}: ${errorMessage}`
						);
						// Continue without subtasks - this is not fatal
					}
				}

				return task;
			})
		);

		// Calculate statistics
		const totalTasks = tasks.length;
		const completedTasks = tasks.filter(
			(t) => t.status === 'done' || t.status === 'completed'
		).length;
		const inProgressCount = tasks.filter(
			(t) => t.status === 'in-progress'
		).length;
		const pendingCount = tasks.filter((t) => t.status === 'pending').length;
		const blockedCount = tasks.filter((t) => t.status === 'blocked').length;
		const deferredCount = tasks.filter((t) => t.status === 'deferred').length;
		const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length;
		const completionPercentage =
			totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

		// Calculate subtask statistics
		let subtaskStats = {
			total: 0,
			completed: 0,
			inProgress: 0,
			pending: 0,
			blocked: 0,
			deferred: 0,
			cancelled: 0,
			completionPercentage: 0
		};

		// If withSubtasks is true, collect statistics for all subtasks
		if (withSubtasks) {
			const allSubtasks = tasks.flatMap((task) => task.subtasks || []);
			subtaskStats.total = allSubtasks.length;
			subtaskStats.completed = allSubtasks.filter(
				(t) => t.status === 'done' || t.status === 'completed'
			).length;
			subtaskStats.inProgress = allSubtasks.filter(
				(t) => t.status === 'in-progress'
			).length;
			subtaskStats.pending = allSubtasks.filter(
				(t) => t.status === 'pending'
			).length;
			subtaskStats.blocked = allSubtasks.filter(
				(t) => t.status === 'blocked'
			).length;
			subtaskStats.deferred = allSubtasks.filter(
				(t) => t.status === 'deferred'
			).length;
			subtaskStats.cancelled = allSubtasks.filter(
				(t) => t.status === 'cancelled'
			).length;
			subtaskStats.completionPercentage =
				subtaskStats.total > 0
					? (subtaskStats.completed / subtaskStats.total) * 100
					: 0;
		}

		// Return in the same format as listTasks
		return {
			success: true,
			tasks,
			filter: 'all',
			stats: {
				total: totalTasks,
				completed: completedTasks,
				inProgress: inProgressCount,
				pending: pendingCount,
				blocked: blockedCount,
				deferred: deferredCount,
				cancelled: cancelledCount,
				completionPercentage,
				subtasks: subtaskStats
			},
			source: 'jira',
			parentKey: parentKey || 'all'
		};
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		log.error(`Error fetching tasks from Jira: ${errorMessage}`);
		throw error;
	}
}

/**
 * Create a Jira issue using the JiraTicket class
 * @param {JiraTicket} jiraTicket - JiraTicket instance with all the data
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} Result object with success status and data/error
 */
export async function createJiraIssue(jiraTicket: any, options: FetchOptions = {}): Promise<any> {
	const { jiraConfig, log } = options;
	
	try {

		// Check if Jira is enabled using the JiraClient
		const jiraClient = new JiraClient(jiraConfig);

		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		// Validate required parameters
		if (!jiraTicket.issueType) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Issue type is required'
				}
			};
		}

		if (!jiraTicket.title) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Summary/title is required'
				}
			};
		}

		// Client-side validation: Check parent key existence if provided
		if (jiraTicket.parentKey) {
			try {
				const client = jiraClient.getClient();
				await client.get(`/rest/api/3/issue/${jiraTicket.parentKey}`);
				log.info(`✓ Parent key ${jiraTicket.parentKey} validated`);
			} catch (parentError: unknown) {
				const isAxiosError = parentError && typeof parentError === 'object' && 'response' in parentError;
				const errorMessage = (isAxiosError && (parentError as any).response?.status === 404)
					? `Parent issue '${jiraTicket.parentKey}' does not exist or is not accessible`
					: `Failed to validate parent issue '${jiraTicket.parentKey}': ${parentError instanceof Error ? parentError.message : String(parentError)}`;
				
				return {
					success: false,
					error: {
						code: 'INVALID_PARENT_KEY',
						message: errorMessage,
						field: 'parentKey',
						value: jiraTicket.parentKey,
						suggestion: 'Please verify the parent issue key exists and you have access to it'
					}
				};
			}
		}

		// For subtasks, parentKey is required
		if (jiraTicket.issueType === 'Subtask' && !jiraTicket.parentKey) {
			return {
				success: false,
				error: {
					code: 'MISSING_PARAMETER',
					message: 'Parent issue key is required for Subtask creation',
					field: 'parentKey',
					suggestion: 'Provide a valid parent issue key when creating subtasks'
				}
			};
		}

		// Generate request payload for debugging
		const requestPayload = jiraTicket.toJiraRequestData();
		
		// Log request details for debugging (without sensitive data)
		log.info(`Creating ${jiraTicket.issueType} with fields: ${Object.keys(requestPayload.fields).join(', ')}`);
		
		if (jiraTicket.issueType === 'Subtask') {
			log.info(`Creating Jira subtask under parent ${jiraTicket.parentKey}`);
		} else {
			log.info(`Creating Jira ${jiraTicket.issueType.toLowerCase()}`);
			if (jiraTicket.parentKey) {
				log.info(`... linked to parent/epic ${jiraTicket.parentKey}`);
			}
		}

		try {
			// Make the API request
			const client = jiraClient.getClient();
			const response = await client.post(
				'/rest/api/3/issue',
				requestPayload
			);

			// Return success with data
			return {
				success: true,
				data: {
					key: response.data.key,
					id: response.data.id,
					self: response.data.self
				}
			};
		} catch (requestError: any) {
			// Enhanced error handling with specific field validation
			const errorResponse = requestError.response?.data;
			const specificErrors = errorResponse?.errors || {};
			const errorMessages = errorResponse?.errorMessages || [];
			
			// Check for specific field errors and provide helpful messages
			const fieldErrors = [];
			
			if (specificErrors.priority) {
				fieldErrors.push({
					field: 'priority',
					error: specificErrors.priority,
					suggestion: 'The priority field may not be available on your Jira screen configuration. Try without priority or contact your Jira admin.'
				});
			}
			
			if (specificErrors.parent) {
				fieldErrors.push({
					field: 'parent',
					error: specificErrors.parent,
					suggestion: `Parent issue '${jiraTicket.parentKey}' was not found. Verify the issue key exists and you have access to it.`
				});
			}
			
			if (specificErrors.issuetype) {
				fieldErrors.push({
					field: 'issueType',
					error: specificErrors.issuetype,
					suggestion: `Issue type '${jiraTicket.issueType}' may not be valid for this project. Check available issue types in your Jira project.`
				});
			}
			
			if (specificErrors.assignee) {
				fieldErrors.push({
					field: 'assignee',
					error: specificErrors.assignee,
					suggestion: `Assignee '${jiraTicket.assignee}' may not be valid. Use account ID or verify the user exists.`
				});
			}
			
			if (specificErrors.description) {
				fieldErrors.push({
					field: 'description',
					error: specificErrors.description,
					suggestion: 'There may be an issue with the markdown formatting or ADF conversion. Try simplifying the description content.'
				});
			}

			// Check if the error is related to the priority field (legacy handling)
			const isPriorityError = specificErrors.priority === "Field 'priority' cannot be set. It is not on the appropriate screen, or unknown.";

			// If it's a priority field error and we included priority, retry without it
			if (isPriorityError && jiraTicket.priority) {
				log.warn(`Priority field error detected: ${specificErrors.priority}`);
				log.info('Retrying issue creation without priority field...');

				// Get the request body and remove priority from it
				const retryPayload = { ...requestPayload };
				if (retryPayload.fields.priority) {
					delete retryPayload.fields.priority;
				}

				try {
					// Retry the API request without priority
					const client = jiraClient.getClient();
					const retryResponse = await client.post(
						'/rest/api/3/issue',
						retryPayload
					);

					// Return success with data from retry
					return {
						success: true,
						data: {
							key: retryResponse.data.key,
							id: retryResponse.data.id,
							self: retryResponse.data.self,
							note: 'Created without priority field due to screen configuration'
						}
					};
				} catch (retryError: any) {
					log.error(`Error creating Jira issue on retry: ${retryError.message}`);
					throw retryError;
				}
			}

			// If it's not a priority error or retry fails, throw the error to be caught by outer catch
			throw requestError;
		}
	} catch (error: any) {
		// Log the error
		const issueTypeDisplay =
			jiraTicket.issueType === 'Subtask'
				? 'subtask'
				: jiraTicket.issueType.toLowerCase();
		log.error(`Error creating Jira ${issueTypeDisplay}: ${error.message}`);

		// Enhanced error details for debugging
		const errorResponse = error.response?.data;
		const specificErrors = errorResponse?.errors || {};
		const errorMessages = errorResponse?.errorMessages || [];
		
		// Build field-specific error information
		const fieldErrors: any[] = [];
		Object.entries(specificErrors).forEach(([field, message]) => {
			fieldErrors.push({
				field,
				error: message,
				suggestion: getFieldErrorSuggestion(field, String(message), jiraTicket)
			});
		});

		// Create enhanced error message
		let enhancedMessage = error.response?.data?.errorMessages?.join(', ') || error.message;
		
		if (fieldErrors.length > 0) {
			const fieldErrorDetails = fieldErrors.map(fe => 
				`Field '${fe.field}': ${fe.error}`
			).join('\n- ');
			
			enhancedMessage = `Jira API validation failed (${error.response?.status || 'Unknown'})\n- ${fieldErrorDetails}`;
		}

		// Debug: Log the full error object to see what's available
		const errorDetails = {
			message: error.message,
			name: error.name,
			status: error.response?.status,
			statusText: error.response?.statusText,
			data: error.response?.data || {},
			errorMessages: errorMessages,
			errors: specificErrors,
			fieldErrors: fieldErrors,
			requestPayload: jiraTicket.toJiraRequestData(), // Include request payload for debugging
			headers: error.response?.headers
				? Object.keys(error.response.headers)
				: [],
			config: error.config
				? {
						url: error.config.url,
						method: error.config.method,
						baseURL: error.config.baseURL,
						headers: Object.keys(error.config.headers || {})
					}
				: {},
			isAxiosError: error.isAxiosError || false,
			code: error.code || 'NO_CODE'
		};

		// Return structured error response with enhanced information
		return {
			success: false,
			error: {
				code: error.response?.status || error.code || 'JIRA_API_ERROR',
				message: enhancedMessage,
				details: errorDetails,
				fieldErrors: fieldErrors,
				displayMessage: enhancedMessage,
				suggestions: fieldErrors.map(fe => fe.suggestion).filter(Boolean)
			}
		};
	}
}

/**
 * Get field-specific error suggestions
 * @param {string} field - The field that caused the error
 * @param {string} message - The error message from Jira
 * @param {JiraTicket} jiraTicket - The ticket data for context
 * @returns {string} Helpful suggestion for the user
 */
function getFieldErrorSuggestion(field: string, message: string, jiraTicket: any): string {
	switch (field) {
		case 'priority':
			return 'The priority field may not be available on your Jira screen configuration. Try without priority or contact your Jira admin.';
		case 'parent':
			return `Parent issue '${jiraTicket.parentKey}' was not found. Verify the issue key exists and you have access to it.`;
		case 'issuetype':
			return `Issue type '${jiraTicket.issueType}' may not be valid for this project. Check available issue types in your Jira project.`;
		case 'assignee':
			return `Assignee '${jiraTicket.assignee}' may not be valid. Use account ID or verify the user exists.`;
		case 'description':
			return 'There may be an issue with the markdown formatting or ADF conversion. Try simplifying the description content.';
		case 'labels':
			return 'One or more labels may not be valid. Check if labels are enabled in your project and use valid label names.';
		case 'project':
			return 'Project configuration issue. Verify your Jira project key is correct in the environment settings.';
		default:
			return `Field '${field}' validation failed: ${message}. Check the field value and project configuration.`;
	}
}

/**
 * Set the status of a Jira task
 * @param {string} taskId - Jira issue key to update (e.g., "PROJ-123")
 * @param {string} newStatus - New status to set
 * @param {Object} options - Additional options (mcpLog for MCP mode)
 * @returns {Promise<Object>} Result object with success status and data/error
 */
export async function setJiraTaskStatus(taskId: string, newStatus: string, options: FetchOptions = {}): Promise<any> {
	try {
		const { jiraConfig, log } = options;

		log.info(`Updating Jira task ${taskId} status to: ${newStatus}`);

		// Check if Jira is enabled using the JiraClient
		const jiraClient = new JiraClient(jiraConfig);

		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		// Handle multiple task IDs (comma-separated)
		const taskIds = taskId.split(',').map((id) => id.trim());
		const updatedTasks = [];

		// Update each task
		for (const id of taskIds) {
			log.info(`Updating status for Jira issue ${id} to "${newStatus}"...`);

			try {
				// Use the JiraClient's transitionIssue method
				const transitionResult = await jiraClient.transitionIssue(
					id,
					newStatus,
					{ log }
				);

				if (!transitionResult.success) {
					throw new Error(
						transitionResult.error?.message || 'Transition failed'
					);
				}

				log.info(
					`Successfully updated Jira issue ${id} status to "${newStatus}"`
				);
				updatedTasks.push(id);
					} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.error(`Error updating status for issue ${id}: ${errorMessage}`);
			throw new Error(`Failed to update Jira issue ${id}: ${errorMessage}`);
			}
		}

		// Return success value for programmatic use
		return {
			success: true,
			data: {
				updatedTasks: updatedTasks.map((id) => ({
					id,
					status: newStatus
				}))
			}
		};
	} catch (error: unknown) {
		// Log the error
		const errorMessage = error instanceof Error ? error.message : String(error);
		const fullErrorMessage = `Error setting Jira task status: ${errorMessage}`;

		if (options.log) {
			options.log.error(fullErrorMessage);
		}
		// Don't use console.error in MCP mode as it breaks the JSON protocol

		// In MCP mode, return error object
		return {
			success: false,
			error: {
				code: 'JIRA_STATUS_UPDATE_ERROR',
				message: errorMessage
			}
		};
	}
}

/**
 * Find the next pending task based on dependencies from Jira
 * @param {string} [parentKey] - Optional parent/epic key to filter tasks
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} The next task to work on and all retrieved tasks
 */
export async function findNextJiraTask(
	parentKey: string,
	log: Logger,
	options: FetchOptions = {}
): Promise<any> {
	try {
		const { jiraConfig } = options;

		// Check if Jira is enabled using the JiraClient
		const jiraClient = new JiraClient(jiraConfig);

		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		// Array to store all tasks retrieved from Jira
		let allTasks = [];

		if (parentKey) {
			log.info(`Finding next task for parent/epic: ${parentKey}`);
		} else {
			log.info('No parent key provided, fetching all workable tasks');
		}

		// Get tasks using fetchTasksFromJira - whether filtering by parent or getting all tasks
		const result = await fetchTasksFromJira(parentKey, true, log);
		if (result && result.tasks) {
			allTasks = result.tasks;
			log.info(
				`Found ${allTasks.length} tasks ${parentKey ? `for parent ${parentKey}` : 'in total'}`
			);
		}

		if (allTasks.length === 0) {
			log.info('No tasks found');
			return {
				success: true,
				data: {
					nextTask: null
				}
			};
		}

		// Get all completed task IDs
		const completedTaskIds = new Set(
			allTasks
				.filter((t: any) => t.status === 'done' || t.status === 'completed')
				.map((t: any) => t.id)
		);

		// Filter for tasks that are ready to be worked on or currently being worked on
		const eligibleTasks = allTasks.filter(
			(task: any) => {
				// Include tasks that are available to work on (pending, to-do) or currently being worked on (in-progress)
				// Exclude in-review tasks as they're waiting for review feedback
				const isWorkableStatus = ['pending', 'to-do', 'in-progress'].includes(task.status);
				
				return isWorkableStatus && (
					!task.dependencies || // No dependencies, or
					task.dependencies.length === 0 || // Empty dependencies array, or
					task.dependencies.every((depId: any) => completedTaskIds.has(depId)) // All dependencies completed
				);
			}
		);

		if (eligibleTasks.length === 0) {
			log.info(
				'No eligible tasks found - all tasks are either completed, blocked, in review, or have unsatisfied dependencies'
			);
			return {
				success: true,
				data: {
					nextTask: null
				}
			};
		}

		// Sort eligible tasks by:
		// 1. Status (in-progress first, then pending/to-do)
		// 2. Priority (high > medium > low)
		// 3. Dependencies count (fewer dependencies first)
		// 4. ID (lower ID first)
		const priorityValues = { high: 3, medium: 2, low: 1 };
		const statusValues = { 'in-progress': 3, 'pending': 2, 'to-do': 1 };

		const nextTask = eligibleTasks.sort((a: any, b: any) => {
			// Sort by status first - prioritize in-progress tasks
			const statusA = statusValues[a.status as keyof typeof statusValues] || 1;
			const statusB = statusValues[b.status as keyof typeof statusValues] || 1;

			if (statusB !== statusA) {
				return statusB - statusA; // Higher status value first (in-progress > pending > to-do)
			}

			// If status is the same, sort by priority
			const priorityA = priorityValues[a.priority as keyof typeof priorityValues || 'medium'] || 2;
			const priorityB = priorityValues[b.priority as keyof typeof priorityValues || 'medium'] || 2;

			if (priorityB !== priorityA) {
				return priorityB - priorityA; // Higher priority first
			}

			// If priority is the same, sort by dependency count
			const depCountA = a.dependencies ? a.dependencies.length : 0;
			const depCountB = b.dependencies ? b.dependencies.length : 0;
			if (depCountA !== depCountB) {
				return depCountA - depCountB; // Fewer dependencies first
			}

			// If dependency count is the same, sort by ID (using string comparison since Jira IDs are like "PROJ-123")
			return a.id.localeCompare(b.id, undefined, { numeric: true });
		})[0]; // Return the first (highest priority) task

		// Get full details for the next task
		const nextTaskDetails = await fetchJiraTaskDetails(nextTask.id, true, log);

		// Log the found next task
		log.info(
			`Found next task: ${nextTask.id} - ${nextTask.title} (${nextTask.priority} priority)`
		);

		return {
			success: true,
			data: {
				nextTask: nextTaskDetails.success ? nextTaskDetails.data.task : nextTask
			}
		};
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		log.error(`Error finding next Jira task: ${errorMessage}`);
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: errorMessage
			}
		};
	}
}

// /**
//  * Updates one or more Jira issues (tasks or subtasks) with new information based on a prompt.
//  * @param {string|Array<string>} issueIds - Single Jira issue ID or array of IDs to update (in format "PROJ-123")
//  * @param {string} prompt - New information or context to incorporate into the issue(s)
//  * @param {boolean} useResearch - Whether to use Perplexity AI for research-backed updates
//  * @param {Object} options - Additional options including session and logging
//  * @returns {Promise} - Result object with success status and updated issue details
//  */
// export async function updateJiraIssues(
// 	issueIds: string[],
// 	prompt: string,
// 	useResearch: boolean = false,
// 	options: UpdateIssuesOptions = {}
// ): Promise<any> {
// 	const { session, projectRoot } = options;

// 	// Get logger from options or use silent logger for MCP compatibility
// 	const log = options.mcpLog || {
// 		info: () => {},
// 		warn: () => {},
// 		error: () => {},
// 		debug: () => {}
// 	} as Logger;

// 	try {
// 		// Check if Jira is enabled using the JiraClient
// 		const jiraClient = new JiraClient();

// 		if (!jiraClient.isReady()) {
// 			return {
// 				success: false,
// 				error: {
// 					code: 'JIRA_NOT_ENABLED',
// 					message: 'Jira integration is not properly configured'
// 				}
// 			};
// 		}

// 		// Handle both single ID (string) and multiple IDs (array)
// 		const isMultipleIssues = Array.isArray(issueIds);
// 		const issueIdArray = isMultipleIssues ? issueIds : [issueIds];

// 		// Validate input
// 		if (!issueIdArray.length) {
// 			throw new Error(
// 				'Missing required parameter: issueIds must be a non-empty string or array'
// 			);
// 		}

// 		if (!prompt) {
// 			throw new Error('Missing required parameter: prompt');
// 		}

// 		// Validate all issue IDs have the correct format (PROJ-123)
// 		issueIdArray.forEach((id) => {
// 			if (!(typeof id === 'string' && id.includes('-'))) {
// 				throw new Error(`Issue ID "${id}" must be in the format "PROJ-123"`);
// 			}
// 		});

// 		log.info(`Updating ${issueIdArray.length} Jira issue(s) based on prompt`);

// 		// Build JQL query to get the specific issues by ID
// 		const formattedIds = issueIdArray.map((id) => `"${id}"`).join(',');
// 		const jql = `issuekey IN (${formattedIds}) ORDER BY issuekey ASC`;

// 		log.info(`Fetching Jira issues with JQL: ${jql}`);

// 		// Use jiraClient.searchIssues instead of direct client.get
// 		const searchResult = await jiraClient.searchIssues(jql, {
// 			maxResults: 100,
// 			expand: 'true',
// 			log
// 		});

// 		if (!searchResult.success) {
// 			return searchResult;
// 		}

// 		const issues = searchResult.data;
// 		if (issues.length === 0) {
// 			log.info(`No issues found with the specified ID(s)`);
// 			return {
// 				success: false,
// 				error: {
// 					code: 'ISSUES_NOT_FOUND',
// 					message: `No issues found with the specified ID(s)`
// 				}
// 			};
// 		}

// 		// Convert Jira issues to a format suitable for the AI
// 		const tasks = issues.map((jiraTicket) => jiraTicket.toTaskMasterFormat());

// 		// Track which issues are subtasks
// 		const issueTypeMap = issues.reduce((map: Record<string, any>, jiraTicket) => {
// 			map[jiraTicket.jiraKey] = {
// 				isSubtask: jiraTicket.issueType === 'Subtask',
// 				parentKey: jiraTicket.parentKey
// 			};
// 			return map;
// 		}, {} as Record<string, any>);

// 		log.info(
// 			`Found ${tasks.length} issue(s) to update (${Object.values(issueTypeMap).filter((i) => i.isSubtask).length} subtasks)`
// 		);

// 		const systemPrompt = `You are an AI assistant helping to update software development tasks based on new context.
// You will be given a set of tasks and a prompt describing changes or new implementation details.
// Your job is to update the tasks to reflect these changes, while preserving their basic structure.

// Guidelines:
// 1. Maintain the same IDs, statuses, and dependencies unless specifically mentioned in the prompt
// 2. Update titles, descriptions, details, and test strategies to reflect the new information
// 3. Do not change anything unnecessarily - just adapt what needs to change based on the prompt
// 4. You should return ALL the tasks in order, not just the modified ones
// 5. Return a complete valid JSON object with the updated tasks array
// 6. VERY IMPORTANT: Preserve all subtasks marked as "done" or "completed" - do not modify their content
// 7. For tasks with completed subtasks, build upon what has already been done rather than rewriting everything
// 8. If an existing completed subtask needs to be changed/undone based on the new context, DO NOT modify it directly
// 9. Instead, add a new subtask that clearly indicates what needs to be changed or replaced
// 10. Use the existence of completed subtasks as an opportunity to make new subtasks more specific and targeted

// The changes described in the prompt should be applied to ALL tasks in the list. Do not wrap your response in \`\`\`json\`\`\``;

// 		const role = useResearch ? 'research' : 'main';
// 		const userPrompt = `Here are the tasks to update:\n${JSON.stringify(tasks)}\n\nPlease update these tasks based on the following new context:\n${prompt}\n\nIMPORTANT: In the tasks JSON above, any subtasks with "status": "done" or "status": "completed" should be preserved exactly as is. Build your changes around these completed items.\n\nReturn only the updated tasks as a valid JSON array.`;

// 		let updates = await generateTextService({
// 			prompt: userPrompt,
// 			systemPrompt: systemPrompt,
// 			role,
// 			session,
// 			projectRoot
// 		});

// 		// Check if updates is a string and try to parse it as JSON
// 		if (typeof updates === 'string') {
// 			try {
// 				updates = JSON.parse(updates);
// 				log.info('Successfully parsed string response into JSON');
// 			} catch (parseError: any) {
// 				log.error(
// 					`Failed to parse updates string as JSON: ${parseError.message}`
// 				);
// 				throw new Error('Failed to parse LLM response into valid JSON');
// 			}
// 		}

// 		if (!updates || !Array.isArray(updates)) {
// 			throw new Error('Failed to generate valid updates, updates: ' + updates);
// 		}

// 		log.info(`Successfully parsed updates for ${updates.length} issue(s)`);

// 		// Apply the updates to Jira
// 		const updateResults = [];
// 		for (let i = 0; i < updates.length; i++) {
// 			const update = updates[i];
// 			if (!update.id) {
// 				log.warn('Update is missing id identifier, skipping');
// 				continue;
// 			}

// 			try {
// 				log.info(`Updating Jira issue: ${update.id}`);

// 				const issueInfo = issueTypeMap[update.id];
// 				const isSubtask = issueInfo?.isSubtask || false;

// 				// For subtasks, we need to preserve the parent relationship
// 				if (isSubtask) {
// 					// Get the complete issue data to ensure we preserve parent relation
// 					const fullIssueResponse = await jiraClient.fetchIssue(update.id, {
// 						log
// 					});
// 					if (!fullIssueResponse.success) {
// 						log.warn(
// 							`Failed to fetch full issue details: ${fullIssueResponse.error?.message}`
// 						);
// 						continue;
// 					}
// 					const fullIssue = fullIssueResponse.data;
// 					const parentKey = fullIssue.parentKey || issueInfo.parentKey;

// 					if (!parentKey) {
// 						log.warn(`Subtask ${update.id} is missing parent relationship`);
// 					}
// 				}

// 				// Create a JiraTicket with properties from the update
// 				const jiraTicket = new JiraTicket({
// 					title: update.title,
// 					description: update.description,
// 					// Include all relevant fields from the update
// 					details: update.implementationDetails || update.details,
// 					acceptanceCriteria: update.acceptanceCriteria,
// 					testStrategy: update.testStrategyTdd || update.testStrategy,
// 					// Include other properties
// 					priority: update.priority,
// 					jiraKey: update.id
// 				});

// 				// For subtasks, preserve the issue type
// 				if (isSubtask) {
// 					jiraTicket.issueType = 'Subtask';
// 					jiraTicket.parentKey = issueInfo.parentKey;
// 				}

// 				// Convert to proper Jira request format
// 				const requestData = jiraTicket.toJiraRequestData();

// 				// Apply the updates if there are any fields to update
// 				if (Object.keys(requestData.fields).length > 0) {
// 					try {
// 											// We don't want to change certain fields in the update
// 					delete (requestData.fields as any).issuetype;
// 					delete (requestData.fields as any).project;

// 						// For subtasks, don't change the parent relationship
// 						if (isSubtask) {
// 							delete requestData.fields.parent;
// 						}

// 						// Only apply the update if we have fields to update
// 						if (Object.keys(requestData.fields).length > 0) {
// 							const client = jiraClient.getClient();
// 							await client.put(`/rest/api/3/issue/${update.id}`, {
// 								fields: requestData.fields
// 							});

// 							log.info(
// 								`Updated issue ${update.id} fields: ${Object.keys(requestData.fields).join(', ')}`
// 							);
// 						} else {
// 							log.info(`No fields to update for issue ${update.id}`);
// 						}
// 					} catch (updateError: unknown) {
// 						// Log detailed error information
// 						const errorMessage = updateError instanceof Error ? updateError.message : String(updateError);
// 						log.error(`Error updating issue: ${errorMessage}`);

// 						const hasResponse = updateError && typeof updateError === 'object' && 'response' in updateError;
// 						if (hasResponse && (updateError as any).response && (updateError as any).response.data) {
// 							log.error(
// 								`API error details: ${JSON.stringify((updateError as any).response.data)}`
// 							);

// 							// If there are specific field errors, log them and try again without those fields
// 							if ((updateError as any).response.data.errors) {
// 								Object.entries((updateError as any).response.data.errors).forEach(
// 									([field, error]) => {
// 										log.error(`Field error - ${field}: ${String(error)}`);

// 										// Remove problematic fields
// 										delete requestData.fields[field];
// 									}
// 								);

// 								// Retry with remaining fields if any
// 								if (Object.keys(requestData.fields).length > 0) {
// 									log.info(`Retrying update without problematic fields...`);
// 									const client = jiraClient.getClient();
// 									await client.put(`/rest/api/3/issue/${update.id}`, {
// 										fields: requestData.fields
// 									});
// 									log.info(
// 										`Updated issue ${update.id} with remaining fields: ${Object.keys(requestData.fields).join(', ')}`
// 									);
// 								}
// 							}
// 						}
// 					}
// 				}

// 				// Find the original task that matches this update
// 				const originalTask = tasks.find(
// 					(task) => task.id === update.id || task.jiraKey === update.id
// 				);

// 				if (!originalTask) {
// 					log.error(`Issue ${update.id} not found in tasks array`);
// 					continue;
// 				}

// 				// Record changes applied
// 				const changesApplied = [];
// 				if (originalTask.title !== update.title)
// 					changesApplied.push({
// 						field: 'summary',
// 						old: originalTask.title,
// 						new: update.title
// 					});
// 				if (originalTask.description !== update.description)
// 					changesApplied.push({
// 						field: 'description',
// 						old: originalTask.description,
// 						new: update.description
// 					});
// 				if (originalTask.priority !== update.priority)
// 					changesApplied.push({
// 						field: 'priority',
// 						old: originalTask.priority,
// 						new: update.priority
// 					});
// 				if (originalTask.implementationDetails !== update.implementationDetails)
// 					changesApplied.push({
// 						field: 'implementationDetails',
// 						old: originalTask.implementationDetails,
// 						new: update.implementationDetails
// 					});
// 				if (originalTask.acceptanceCriteria !== update.acceptanceCriteria)
// 					changesApplied.push({
// 						field: 'acceptanceCriteria',
// 						old: originalTask.acceptanceCriteria,
// 						new: update.acceptanceCriteria
// 					});
// 				if (originalTask.testStrategyTdd !== update.testStrategyTdd)
// 					changesApplied.push({
// 						field: 'testStrategy',
// 						old: originalTask.testStrategyTdd,
// 						new: update.testStrategyTdd
// 					});

// 				// Record updates that were applied
// 				updateResults.push({
// 					key: update.id,
// 					success: true,
// 					isSubtask: isSubtask,
// 					changeType: changesApplied.map((change) => change.field),
// 					changeDetails: changesApplied
// 				});
// 			} catch (error: unknown) {
// 				const errorMessage = error instanceof Error ? error.message : String(error);
// 				log.error(`Failed to update issue ${update.id}: ${errorMessage}`);
// 				updateResults.push({
// 					key: update.id || 'unknown',
// 					success: false,
// 					error: errorMessage
// 				});
// 			}
// 		}

// 		// Return different result formats based on whether it was a single or multiple update
// 		if (!isMultipleIssues) {
// 			// Single issue update result format (similar to original updateJiraIssueById)
// 			const result = updateResults[0] || {
// 				success: false,
// 				error: { code: 'UPDATE_FAILED', message: 'Failed to update issue' }
// 			};

// 			if (result.success) {
// 				return {
// 					success: true,
// 					data: {
// 						message: `Successfully updated Jira ${result.isSubtask ? 'subtask' : 'issue'} ${result.key} based on the prompt`,
// 						issueId: result.key,
// 						isSubtask: result.isSubtask,
// 						changeType: result.changeType,
// 						changeDetails: result.changeDetails
// 					}
// 				};
// 			} else {
// 				return {
// 					success: false,
// 					error: {
// 						code: 'UPDATE_JIRA_ISSUE_ERROR',
// 						message: result.error
// 					}
// 				};
// 			}
// 		} else {
// 			// Multiple issues update result format (similar to original updateJiraTasks)
// 			const successCount = updateResults.filter((r) => r.success).length;
// 			return {
// 				success: successCount > 0,
// 				message: `Updated ${successCount} out of ${updateResults.length} issues based on the prompt`,
// 				results: updateResults
// 			};
// 		}
// 	} catch (error: unknown) {
// 		const errorMessage = error instanceof Error ? error.message : String(error);
// 		log.error(`Failed to update Jira issue(s): ${errorMessage}`);
// 		return {
// 			success: false,
// 			error: {
// 				code: 'UPDATE_JIRA_ISSUES_ERROR',
// 				message: errorMessage
// 			}
// 		};
// 	}
// }

// /**
//  * Expands a Jira task into multiple subtasks using AI
//  * @param {string} taskId - The Jira issue key to expand
//  * @param {number} [numSubtasks] - Number of subtasks to generate (default based on env var)
//  * @param {boolean} [useResearch=false] - Enable Perplexity AI for research-backed subtask generation
//  * @param {string} [additionalContext=''] - Additional context to guide subtask generation
//  * @param {Object} options - Options object containing session and logging info
//  * @param {Object} [options.mcpLog] - Logger object for MCP mode
//  * @param {Object} [options.session] - Session object for AI clients
//  * @param {boolean} [options.force=false] - Force regeneration of subtasks
//  * @returns {Promise<{success: boolean, data: Object, error: Object}>} Result of the expansion
//  */
// export async function expandJiraTask(
// 	taskId: string,
// 	numSubtasks: number,
// 	useResearch: boolean = false,
// 	additionalContext: string = '',
// 	options: ExpandTaskOptions = {}
// ): Promise<any> {
// 	// Destructure options object
// 	const { reportProgress, mcpLog, session, force = false } = options;

// 	// Determine output format based on mcpLog presence (simplification)
// 	const outputFormat = mcpLog ? 'json' : 'text';

// 	// Create custom reporter that checks for MCP log and silent mode
// 	const report = (message: string, level: string = 'info') => {
// 		if (mcpLog) {
// 			if (level === 'info') mcpLog.info(message);
// 			else if (level === 'warn') mcpLog.warn(message);
// 			else if (level === 'error') mcpLog.error(message);
// 			else if (level === 'debug') mcpLog.debug(message);
// 		} else if (!isSilentMode() && outputFormat === 'text') {
// 			// Only log to console if not in silent mode and outputFormat is 'text'
// 			log(level, message);
// 		}
// 	};

// 	// Keep the mcpLog check for specific MCP context logging
// 	if (mcpLog) {
// 		mcpLog.info(
// 			`expandTask - reportProgress available: ${!!reportProgress}, session available: ${!!session}`
// 		);
// 	}

// 	try {
// 		report(`Expanding task ${taskId}`);

// 		// Get task details
// 		const fallbackLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as Logger;
// 		const taskDetails = await fetchJiraTaskDetails(taskId, true, mcpLog || fallbackLogger);
// 		if (!taskDetails.success) {
// 			throw new Error(
// 				`Failed to fetch Jira task: ${taskDetails.error?.message || 'Unknown error'}`
// 			);
// 		}

// 		const task = taskDetails.data.task;

// 		// Check if the task already has subtasks and force isn't enabled
// 		const hasExistingSubtasks = task.subtasks && task.subtasks.length > 0;
// 		if (hasExistingSubtasks && !force) {
// 			report(`Task ${taskId} already has ${task.subtasks.length} subtasks`);
// 			return {
// 				success: true,
// 				message: `Task ${taskId} already has subtasks. Expansion skipped.`,
// 				task,
// 				subtasksCount: task.subtasks.length,
// 				subtasks: task.subtasks
// 			};
// 		}

// 		// Calculate the number of subtasks to generate
// 		const defaultSubtasksCount = parseInt(
// 			process.env.DEFAULT_SUBTASKS || '3',
// 			10
// 		);
// 		const subtasksToGenerate = numSubtasks || defaultSubtasksCount;

// 		// Create a JiraTicket instance from the task data
// 		const jiraTicket = JiraTicket.fromTaskMaster(task);

// 		// Create a proper wrapper for mcpLog
// 		const logWrapper = {
// 			info: (message: string) => report(message),
// 			warn: (message: string) => report(message),
// 			error: (message: string) => report(message),
// 			debug: (message: string) => report(message),
// 			success: (message: string) => report(message) // Map success to info
// 		};

// 		report(`Generating ${subtasksToGenerate} subtasks for Jira task ${taskId}`);

// 		// Generate subtasks with the AI service
// 		const generatedSubtasks = await generateSubtasks(
// 			jiraTicket.toTaskMasterFormat(),
// 			subtasksToGenerate,
// 			useResearch,
// 			additionalContext,
// 			{
// 				reportProgress,
// 				mcpLog: logWrapper,
// 				session,
// 				silentMode: isSilentMode()
// 			}
// 		);

// 		if (!generatedSubtasks || !Array.isArray(generatedSubtasks)) {
// 			throw new Error('Failed to generate subtasks with AI');
// 		}

// 		report(
// 			`Successfully generated ${generatedSubtasks.length} subtasks. Creating in Jira...`
// 		);

// 		// Create each subtask in Jira
// 		const createdSubtasks = [];
// 		const issueKeyMap = new Map(); // Map subtask ID to Jira issue key for dependency linking

// 		for (let i = 0; i < generatedSubtasks.length; i++) {
// 			const subtask = generatedSubtasks[i];

// 			try {
// 				// Create a JiraTicket instance for the subtask
// 				const jiraTicket = new JiraTicket({
// 					title: subtask.title,
// 					description: subtask.description || '',
// 					details: subtask.details || '',
// 					acceptanceCriteria: subtask.acceptanceCriteria || '',
// 					testStrategy: subtask.testStrategy || '',
// 					priority: subtask.priority || task.priority,
// 					issueType: 'Subtask',
// 					parentKey: taskId
// 				});

// 				// Create the subtask in Jira
// 				report(
// 					`Creating subtask ${i + 1}/${generatedSubtasks.length}: ${subtask.title}`
// 				);
// 				const createResult = await createJiraIssue(jiraTicket, mcpLog || fallbackLogger);

// 				if (createResult.success) {
// 					const jiraKey = createResult.data.key;
// 					createdSubtasks.push({
// 						...subtask,
// 						id: jiraKey,
// 						jiraKey: jiraKey
// 					});
// 					// Store the mapping from subtask.id to Jira issue key for dependency linking
// 					issueKeyMap.set(subtask.id, jiraKey);
// 					report(`Successfully created subtask: ${jiraKey}`);
// 				} else {
// 					report(
// 						`Failed to create subtask: ${createResult.error?.message || 'Unknown error'}`
// 					);
// 				}
// 			} catch (error: any) {
// 				report(`Error creating subtask: ${error.message}`);
// 				// Continue with the next subtask even if this one fails
// 			}
// 		}

// 		// Add dependency links between subtasks
// 		report(`Setting up dependencies between subtasks...`);
// 		const jiraClient = new JiraClient();
// 		const client = jiraClient.getClient();
// 		const dependencyLinks = [];

// 		// Process each subtask with dependencies
// 		for (const subtask of generatedSubtasks) {
// 			if (
// 				subtask.dependencies &&
// 				Array.isArray(subtask.dependencies) &&
// 				subtask.dependencies.length > 0
// 			) {
// 				const dependentIssueKey = issueKeyMap.get(subtask.id);

// 				if (dependentIssueKey) {
// 					for (const dependencyId of subtask.dependencies) {
// 						// Skip dependency on "0" which is often used as a placeholder
// 						if (dependencyId === 0) continue;

// 						const dependencyKey = issueKeyMap.get(dependencyId);

// 						if (dependencyKey) {
// 							report(
// 								`Linking issue ${dependentIssueKey} to depend on ${dependencyKey}`
// 							);

// 							try {
// 								// Create issue link using Jira REST API
// 								// "Blocks" link type means the dependency blocks the dependent issue
// 								const linkPayload = {
// 									type: {
// 										name: 'Blocks' // Common link type - this issue blocks the dependent issue
// 									},
// 									inwardIssue: {
// 										key: dependencyKey
// 									},
// 									outwardIssue: {
// 										key: dependentIssueKey
// 									}
// 								};

// 								await client.post('/rest/api/3/issueLink', linkPayload);

// 								dependencyLinks.push({
// 									from: dependentIssueKey,
// 									to: dependencyKey
// 								});

// 								report(
// 									`Created dependency link from ${dependentIssueKey} to ${dependencyKey}`
// 								);
// 							} catch (error: any) {
// 								report(
// 									`Error creating dependency link from ${dependentIssueKey} to ${dependencyKey}: ${error.message}`,
// 									'error'
// 								);
// 							}
// 						} else {
// 							report(
// 								`Dependency subtask ID ${dependencyId} not found in created issues`,
// 								'warn'
// 							);
// 						}
// 					}
// 				}
// 			}
// 		}

// 		// Return the results
// 		return {
// 			success: true,
// 			data: {
// 				message: `Created ${createdSubtasks.length} subtasks for Jira task ${taskId} with ${dependencyLinks.length} dependency links`,
// 				taskId,
// 				subtasksCount: createdSubtasks.length,
// 				subtasks: createdSubtasks,
// 				dependencyLinks
// 			}
// 		};
// 	} catch (error: any) {
// 		report(`Error in expandJiraTask: ${error.message}`);
// 		return {
// 			success: false,
// 			error: {
// 				code: 'EXPAND_JIRA_TASK_ERROR',
// 				message: error.message
// 			}
// 		};
// 	}
// }

/**
 * Removes a Jira subtask
 * @param {string} subtaskId - Jira subtask issue key to remove (e.g., "PROJ-123")
 * @param {boolean} [convert=false] - Whether to convert the subtask to a standalone task instead of deleting
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Result with success status and data/error
 */
export async function removeJiraSubtask(subtaskId: string, convert: boolean = false, log: Logger): Promise<any> {
	try {
		// Check if Jira is enabled using the JiraClient
		const jiraClient = new JiraClient();

		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		log.info(`Removing Jira subtask ${subtaskId} (convert: ${convert})`);

		// First, fetch the subtask to verify it exists and is actually a subtask
		const subtaskResult = await jiraClient.fetchIssue(subtaskId, { log });

		if (!subtaskResult.success) {
			return {
				success: false,
				error: {
					code: 'SUBTASK_NOT_FOUND',
					message: `Could not find subtask with key ${subtaskId}: ${subtaskResult.error?.message || 'Unknown error'}`
				}
			};
		}

		const subtask = subtaskResult.data;

		// Verify it's a subtask
		if (subtask.issueType !== 'Subtask') {
			return {
				success: false,
				error: {
					code: 'NOT_A_SUBTASK',
					message: `Issue ${subtaskId} is not a subtask (type: ${subtask.issueType})`
				}
			};
		}

		// Get the parent key
		const parentKey = subtask.parentKey;
		if (!parentKey) {
			log.warn(`Subtask ${subtaskId} does not have a parent reference`);
		}

		// Handle conversion to standalone task
		if (convert) {
			log.info(`Converting subtask ${subtaskId} to standalone task...`);

			try {
				// If the subtask has a parent, fetch the parent to get its epic link (if any)
				let epicKey = null;
				if (parentKey) {
					log.info(
						`Fetching parent task ${parentKey} to check for epic relationship...`
					);
					const parentResult = await jiraClient.fetchIssue(parentKey, { log });

					if (parentResult.success) {
						const parent = parentResult.data;

						// Check if parent has an epic link by looking at issue links
						if (parent.parentKey) {
							log.info(
								`Parent task has ${parent.dependencies.length} dependencies/links`
							);
							epicKey = parent.parentKey;
							log.info(`Found potential epic relationship: ${epicKey}`);
						}
					} else {
						log.warn(
							`Could not fetch parent task: ${parentResult.error?.message || 'Unknown error'}`
						);
					}
				}

				// Create a new JiraTicket for the standalone task
				const taskTicket = new JiraTicket({
					title: subtask.title,
					description: subtask.description,
					details: subtask.details,
					acceptanceCriteria: subtask.acceptanceCriteria,
					testStrategy: subtask.testStrategy,
					priority: subtask.priority,
					issueType: 'Task', // Convert to regular Task
					labels: subtask.labels || [],
					parentKey: epicKey || undefined
				});

				// Use the JiraClient's createIssue method instead of direct API call
				const createResult = await jiraClient.createIssue(taskTicket, { log });

				if (!createResult.success) {
					return createResult;
				}

				const newTaskKey = createResult.data.key;
				log.info(`Created new task ${newTaskKey} from subtask ${subtaskId}`);

				// After successful creation, get a client for direct API calls if needed
				const client = jiraClient.getClient();

				// Delete the original subtask
				await client.delete(`/rest/api/3/issue/${subtaskId}`);
				log.info(`Deleted original subtask ${subtaskId}`);

				// Return the result with the new task info
				return {
					success: true,
					data: {
						message: `Subtask ${subtaskId} successfully converted to task ${newTaskKey}`,
						originalSubtaskId: subtaskId,
						newTaskId: newTaskKey,
						epicLinked: epicKey,
						task: {
							id: newTaskKey,
							jiraKey: newTaskKey,
							title: subtask.title,
							status: subtask.status,
							priority: subtask.priority
						}
					}
				};
			} catch (error: any) {
				log.error(`Error converting subtask to task: ${error.message}`);
				return {
					success: false,
					error: {
						code: 'CONVERSION_ERROR',
						message: `Failed to convert subtask to task: ${error.message}`
					}
				};
			}
		} else {
			// Simple deletion
			log.info(`Deleting subtask ${subtaskId}...`);

			try {
				const client = jiraClient.getClient();
				await client.delete(`/rest/api/3/issue/${subtaskId}`);

				log.info(`Successfully deleted subtask ${subtaskId}`);
				return {
					success: true,
					data: {
						message: `Subtask ${subtaskId} successfully removed`,
						subtaskId
					}
				};
			} catch (error: any) {
				log.error(`Error deleting subtask: ${error.message}`);
				return {
					success: false,
					error: {
						code: 'DELETE_ERROR',
						message: `Failed to delete subtask: ${error.message}`
					}
				};
			}
		}
	} catch (error: any) {
		log.error(`Error in removeJiraSubtask: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: error.message
			}
		};
	}
}

/**
 * Removes a Jira task or subtask
 * @param {string} taskId - Jira issue key to remove (e.g., "PROJ-123")
 * @param {Object} log - Logger object
 * @returns {Promise<Object>} - Result with success status and data/error
 */
export async function removeJiraTask(taskId: string, log: Logger): Promise<any> {
	try {
		// Check if Jira is enabled using the JiraClient
		const jiraClient = new JiraClient();

		if (!jiraClient.isReady()) {
			return {
				success: false,
				error: {
					code: 'JIRA_NOT_ENABLED',
					message: 'Jira integration is not properly configured'
				}
			};
		}

		log.info(`Removing Jira task ${taskId}`);

		// First, fetch the task to verify it exists and to get its details
		const taskResult = await jiraClient.fetchIssue(taskId, { log });

		if (!taskResult.success) {
			return {
				success: false,
				error: {
					code: 'TASK_NOT_FOUND',
					message: `Could not find task with key ${taskId}: ${taskResult.error?.message || 'Unknown error'}`
				}
			};
		}

		const task = taskResult.data;
		const isSubtask = task.issueType === 'Subtask';

		// If it's a subtask, delegate to removeJiraSubtask function
		if (isSubtask) {
			log.info(`Task ${taskId} is a subtask. Using removeJiraSubtask instead.`);
			return await removeJiraSubtask(taskId, false, log);
		}

		// Check if the task has subtasks
		let subtasks = [];
		try {
			const subtasksResult = await fetchTasksFromJira(taskId, false, log);
			if (subtasksResult.success && subtasksResult.tasks) {
				subtasks = subtasksResult.tasks;
				if (subtasks.length > 0) {
					log.info(
						`Task ${taskId} has ${subtasks.length} subtasks that need to be removed first`
					);
				}
			}
		} catch (error: any) {
			log.warn(`Error fetching subtasks for ${taskId}: ${error.message}`);
			// Continue without subtasks information - not fatal
		}

		// Get a direct client connection
		const client = jiraClient.getClient();

		// If the task has subtasks, delete them individually first
		const subtaskResults = [];
		let subtasksRemoved = 0;

		if (subtasks.length > 0) {
			log.info(
				`Deleting ${subtasks.length} subtasks before removing parent task ${taskId}`
			);

			for (const subtask of subtasks) {
				try {
					log.info(`Removing subtask ${subtask.id}...`);
					const subtaskResult = await removeJiraSubtask(subtask.id, false, log);

					if (subtaskResult.success) {
						subtasksRemoved++;
						subtaskResults.push({
							id: subtask.id,
							success: true,
							message: `Successfully removed subtask ${subtask.id}`
						});
						log.info(`Successfully removed subtask ${subtask.id}`);
					} else {
						subtaskResults.push({
							id: subtask.id,
							success: false,
							error: subtaskResult.error?.message || 'Unknown error'
						});
						log.warn(
							`Failed to remove subtask ${subtask.id}: ${subtaskResult.error?.message || 'Unknown error'}`
						);
					}
				} catch (subtaskError: any) {
					subtaskResults.push({
						id: subtask.id,
						success: false,
						error: subtaskError.message
					});
					log.error(
						`Error removing subtask ${subtask.id}: ${subtaskError.message}`
					);
				}
			}

			log.info(`Removed ${subtasksRemoved} out of ${subtasks.length} subtasks`);

			// Re-fetch subtasks to see if any are still remaining
			try {
				const remainingSubtasksResult = await fetchTasksFromJira(
					taskId,
					false,
					log
				);
				if (
					remainingSubtasksResult.success &&
					remainingSubtasksResult.tasks &&
					remainingSubtasksResult.tasks.length > 0
				) {
					const remainingCount = remainingSubtasksResult.tasks.length;
					log.warn(
						`There are still ${remainingCount} subtasks remaining that could not be deleted`
					);
				}
			} catch (error: any) {
				log.warn(`Could not verify remaining subtasks: ${error.message}`);
			}
		}

		// Now attempt to delete the parent task
		try {
			await client.delete(`/rest/api/3/issue/${taskId}`);
			log.info(`Successfully deleted task ${taskId}`);

			return {
				success: true,
				data: {
					message: `Task ${taskId} successfully removed along with ${subtasksRemoved} subtasks`,
					removedTask: task.toTaskMasterFormat(),
					subtasksRemoved: subtasksRemoved,
					subtaskResults: subtaskResults
				}
			};
		} catch (error: any) {
			log.error(`Error deleting parent task: ${error.message}`);

			// Check if it's a permission error
			if (error.response && error.response.status === 403) {
				return {
					success: false,
					error: {
						code: 'PERMISSION_ERROR',
						message: 'You do not have permission to delete this issue'
					}
				};
			}

			// Check if it's due to remaining subtasks
			if (
				error.response &&
				error.response.status === 400 &&
				error.response.data &&
				(error.response.data.errorMessages || []).some((msg: any) =>
					msg.includes('subtask')
				)
			) {
				return {
					success: false,
					error: {
						code: 'SUBTASKS_REMAINING',
						message: `Failed to delete task: ${error.message}. Some subtasks could not be deleted.`,
						subtaskResults: subtaskResults
					}
				};
			}

			return {
				success: false,
				error: {
					code: 'DELETE_ERROR',
					message: `Failed to delete task: ${error.message}`,
					subtaskResults: subtaskResults
				}
			};
		}
	} catch (error: any) {
		log.error(`Error in removeJiraTask: ${error.message}`);
		return {
			success: false,
			error: {
				code: 'JIRA_API_ERROR',
				message: error.message
			}
		};
	}
}

// /**
//  * Analyze complexity of Jira tasks and generate a complexity report
//  * @param {string} [parentKey] - Optional parent/epic key to filter tasks
//  * @param {number} [threshold=5] - Minimum complexity score to recommend expansion
//  * @param {boolean} [useResearch=false] - Whether to use Perplexity AI for research-backed analysis
//  * @param {string} [outputPath] - Path to save the report file
//  * @param {Object} options - Additional options
//  * @param {string} [options.model] - LLM model to use for analysis
//  * @param {Object} log - Logger object
//  * @param {Object} [context={}] - Context object containing session data
//  * @returns {Promise<{ success: boolean, data?: {Object}, error?: Object }>} - Result with success status and report data/error
//  */
// export async function analyzeJiraTaskComplexity(
// 	parentKey: string,
// 	threshold: number = 5,
// 	useResearch: boolean = false,
// 	outputPath: string,
// 	options: AnalyzeComplexityOptions = {},
// 	log: Logger,
// 	context: any = {}
// ): Promise<any> {
// 	try {
// 		// Check if Jira is enabled using the JiraClient
// 		const jiraClient = new JiraClient();

// 		if (!jiraClient.isReady()) {
// 			return {
// 				success: false,
// 				error: {
// 					code: 'JIRA_NOT_ENABLED',
// 					message: 'Jira integration is not properly configured'
// 				}
// 			};
// 		}

// 		log.info(
// 			`Analyzing complexity of Jira tasks ${parentKey ? `for parent ${parentKey}` : 'in project'}`
// 		);

// 		// First, fetch all tasks from Jira
// 		const tasksResult = await fetchTasksFromJira(parentKey, true, log);

// 		if (!tasksResult.success) {
// 			return tasksResult; // Return the error response
// 		}

// 		if (!tasksResult.tasks || tasksResult.tasks.length === 0) {
// 			return {
// 				success: false,
// 				error: {
// 					code: 'NO_TASKS_FOUND',
// 					message: 'No tasks found to analyze'
// 				}
// 			};
// 		}

// 		log.info(`Found ${tasksResult.tasks.length} tasks to analyze`);

// 		// Filter out tasks with status done/cancelled/deferred
// 		const activeStatuses = ['pending', 'blocked', 'in-progress'];
// 		const filteredTasks = tasksResult.tasks.filter((task: any) =>
// 			activeStatuses.includes(task.status?.toLowerCase() || 'pending')
// 		);

// 		if (filteredTasks.length === 0) {
// 			return {
// 				success: false,
// 				error: {
// 					code: 'NO_ACTIVE_TASKS',
// 					message:
// 						'No active tasks found to analyze (all tasks are completed, cancelled, or deferred)'
// 				}
// 			};
// 		}

// 		log.info(
// 			`Analyzing ${filteredTasks.length} active tasks (skipping ${tasksResult.tasks.length - filteredTasks.length} completed/cancelled/deferred tasks)`
// 		);

// 		// Convert the tasks to the format expected by analyzeTaskComplexity
// 		const tasksData = {
// 			tasks: filteredTasks,
// 			meta: {
// 				projectName: jiraClient.config.project,
// 				source: 'jira'
// 			},
// 			_originalTaskCount: tasksResult.tasks.length
// 		};

// 		// Import analyzeTaskComplexity function from task-manager.js
// 		const { analyzeTaskComplexity } = await import(
// 			'../../../../scripts/modules/task-manager.js'
// 		);

// 		// Create options for analyzeTaskComplexity
// 		const analyzeOptions = {
// 			_filteredTasksData: tasksData, // Pass pre-filtered data
// 			output: outputPath,
// 			model: options.model,
// 			threshold: threshold,
// 			research: useResearch
// 		};

// 		// Create a logger wrapper that matches the expected mcpLog interface
// 		const logWrapper = {
// 			info: (message: string) => log.info(message),
// 			warn: (message: string) => log.warn(message),
// 			error: (message: string) => log.error(message),
// 			debug: (message: string) => log.debug && log.debug(message),
// 			success: (message: string) => log.info(message) // Map success to info
// 		};

// 		// Call the core function with the prepared data
// 		await analyzeTaskComplexity(analyzeOptions, {
// 			session: context.session,
// 			mcpLog: logWrapper
// 		});

// 		// Read the report file
// 		const fs = await import('fs');
// 		const report = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

// 		// Calculate summary statistics
// 		const analysisArray = Array.isArray(report)
// 			? report
// 			: report.complexityAnalysis || [];
// 		const highComplexityTasks = analysisArray.filter(
// 			(t: any) => t.complexityScore >= 8
// 		).length;
// 		const mediumComplexityTasks = analysisArray.filter(
// 			(t: any) => t.complexityScore >= 5 && t.complexityScore < 8
// 		).length;
// 		const lowComplexityTasks = analysisArray.filter(
// 			(t: any) => t.complexityScore < 5
// 		).length;

// 		return {
// 			success: true,
// 			data: {
// 				message: `Task complexity analysis complete. Report saved to ${outputPath}`,
// 				reportPath: outputPath,
// 				reportSummary: {
// 					taskCount: analysisArray.length,
// 					highComplexityTasks,
// 					mediumComplexityTasks,
// 					lowComplexityTasks
// 				}
// 			}
// 		};
// 	} catch (error: any) {
// 		log.error(`Error analyzing Jira task complexity: ${error.message}`);
// 		return {
// 			success: false,
// 			error: {
// 				code: 'JIRA_ANALYZE_ERROR',
// 				message: error.message
// 			}
// 		};
// 	}
// }

// /**
//  * Generate subtasks for a task
//  * @param {Object} task - Task to generate subtasks for
//  * @param {number} numSubtasks - Number of subtasks to generate
//  * @param {boolean} useResearch - Whether to use research for generating subtasks
//  * @param {Object} options - Options object containing:
//  *   - reportProgress: Function to report progress to MCP server (optional)
//  *   - mcpLog: MCP logger object (optional)
//  *   - session: Session object from MCP server (optional)
//  * @returns {Array} Generated subtasks
//  */
// async function generateSubtasks(
// 	task: any,
// 	numSubtasks: number,
// 	useResearch: boolean = false,
// 	additionalContext: string = '',
// 	{ reportProgress, mcpLog, silentMode, session }: GenerateSubtasksOptions = {}
// ): Promise<any> {
// 	try {
// 		// Check both global silentMode and the passed parameter
// 		const isSilent =
// 			silentMode || (typeof silentMode === 'undefined' && isSilentMode());

// 		// Use mcpLog if provided, otherwise use regular log if not silent
// 		const logFn = mcpLog
// 			? (level: string, message: string) => {
// 				if (level === 'info') mcpLog.info(message);
// 				else if (level === 'warn') mcpLog.warn(message);
// 				else if (level === 'error') mcpLog.error(message);
// 				else if (level === 'debug') mcpLog.debug && mcpLog.debug(message);
// 			}
// 			: (level: string, message: string) => !isSilent && log(level, message);

// 		logFn(
// 			'info',
// 			`Generating ${numSubtasks} subtasks for task ${task.id}: ${task.title}`
// 		);

// 		// Only create loading indicators if not in silent mode
// 		let loadingIndicator = null;

// 		let streamingInterval = null;
// 		let responseText = '';

// 		const systemPrompt = `You are an AI assistant helping with task breakdown for software development. 
// You need to break down a high-level task into ${numSubtasks} specific subtasks that can be implemented one by one.

// Subtasks should:
// 1. Be specific and actionable implementation steps
// 2. Follow a logical sequence
// 3. Each handle a distinct part of the parent task
// 4. Include clear guidance on implementation approach
// 5. Have appropriate dependency chains between subtasks
// 6. Collectively cover all aspects of the parent task

// For each subtask, provide:
// - A clear, specific title
// - Detailed description of the task
// - Dependencies on previous subtasks
// - Testing approach

// Each subtask should be implementable in a focused coding session.`;

// 		const contextPrompt = additionalContext
// 			? `\n\nAdditional context to consider: ${additionalContext}`
// 			: '';

// 		const userPrompt = `Please break down this task into ${numSubtasks} specific, actionable subtasks:

// Task ID: ${task.id}
// Title: ${task.title}
// Description: ${task.description}
// Current details: ${task.details || 'None provided'}
// ${contextPrompt}

// Return exactly ${numSubtasks} subtasks with the following JSON structure:
// [
//     {
//       "id": 1,
//       "title": "Example Task Title",
//       "description": "Detailed description of the task (if needed you can use markdown formatting, e.g. headings, lists, etc.)",
// 	  "acceptanceCriteria": "Detailed acceptance criteria for the task following typical Gherkin syntax",
//       "status": "pending",
//       "dependencies": [0],
//       "priority": "high",
//       "details": "Detailed implementation guidance",
//       "testStrategy": "A Test Driven Development (TDD) approach for validating this task. Always specify TDD tests for each task if possible."
//     },
//     // ... more tasks ...
// ],

// Note on dependencies: Subtasks can depend on other subtasks with lower IDs. Use an empty array if there are no dependencies.`;

// 		try {
// 			// Update loading indicator to show streaming progress
// 			// Only create if not in silent mode
// 			if (!isSilent) {
// 				let dotCount = 0;
// 				const readline = await import('readline');
// 				streamingInterval = setInterval(() => {
// 					readline.cursorTo(process.stdout, 0);
// 					process.stdout.write(
// 						`Generating subtasks for task ${task.id}${'.'.repeat(dotCount)}`
// 					);
// 					dotCount = (dotCount + 1) % 4;
// 				}, 500);
// 			}

// 			// Configure Anthropic client
// 			const anthropic = new Anthropic({
// 				apiKey: process.env.ANTHROPIC_API_KEY,
// 				// Add beta header for 128k token output
// 				defaultHeaders: {
// 					'anthropic-beta': 'output-128k-2025-02-19'
// 				}
// 			});

// 			// Use streaming API call
// 			const stream = await anthropic.messages.create({
// 				model: 'claude-3-7-sonnet-latest',
// 				max_tokens: session?.env?.MAX_TOKENS || 15000,
// 				temperature: session?.env?.TEMPERATURE || 0.4,
// 				system: systemPrompt,
// 				messages: [
// 					{
// 						role: 'user',
// 						content: userPrompt
// 					}
// 				],
// 				stream: true
// 			});

// 			// Process the stream
// 			for await (const chunk of stream) {
// 				if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
// 					responseText += chunk.delta.text;
// 				}
// 				if (reportProgress) {
// 					reportProgress(`Progress: ${Math.round((responseText.length / (session?.env?.MAX_TOKENS || 15000)) * 100)}%`);
// 				}
// 			}

// 			if (streamingInterval) clearInterval(streamingInterval);

// 			logFn('info', `Completed generating subtasks for task ${task.id}`);

// 			return parseSubtasksFromText(responseText, 1, numSubtasks, task.id);
// 		} catch (error) {
// 			if (streamingInterval) clearInterval(streamingInterval);
// 			throw error;
// 		}
// 	} catch (error) {
// 		throw error;
// 	}
// }

// /**
//  * Parse subtasks from Claude's response text
//  * @param {string} text - Response text
//  * @param {number} startId - Starting subtask ID
//  * @param {number} expectedCount - Expected number of subtasks
//  * @param {number} parentTaskId - Parent task ID
//  * @returns {Array} Parsed subtasks
//  * @throws {Error} If parsing fails or JSON is invalid
//  */
// function parseSubtasksFromText(text: string, startId: number, expectedCount: number, parentTaskId: string): any[] {
// 	// Set default values for optional parameters
// 	startId = startId || 1;
// 	expectedCount = expectedCount || 2; // Default to 2 subtasks if not specified

// 	// Handle empty text case
// 	if (!text || text.trim() === '') {
// 		throw new Error('Empty text provided, cannot parse subtasks');
// 	}

// 	// Locate JSON array in the text
// 	const jsonStartIndex = text.indexOf('[');
// 	const jsonEndIndex = text.lastIndexOf(']');

// 	// If no valid JSON array found, throw error
// 	if (
// 		jsonStartIndex === -1 ||
// 		jsonEndIndex === -1 ||
// 		jsonEndIndex < jsonStartIndex
// 	) {
// 		throw new Error('Could not locate valid JSON array in the response');
// 	}

// 	// Extract and parse the JSON
// 	const jsonText = text.substring(jsonStartIndex, jsonEndIndex + 1);
// 	let subtasks;

// 	try {
// 		subtasks = JSON.parse(jsonText);
// 	} catch (parseError: any) {
// 		throw new Error(`Failed to parse JSON: ${parseError.message}`);
// 	}

// 	// Validate array
// 	if (!Array.isArray(subtasks)) {
// 		throw new Error('Parsed content is not an array');
// 	}

// 	// Log warning if count doesn't match expected
// 	if (expectedCount && subtasks.length !== expectedCount) {
// 		log(
// 			'warn',
// 			`Expected ${expectedCount} subtasks, but parsed ${subtasks.length}`
// 		);
// 	}

// 	// Normalize subtask IDs if they don't match
// 	subtasks = subtasks.map((subtask, index) => {
// 		// Assign the correct ID if it doesn't match
// 		if (!subtask.id || subtask.id !== startId + index) {
// 			log(
// 				'warn',
// 				`Correcting subtask ID from ${subtask.id || 'undefined'} to ${startId + index}`
// 			);
// 			subtask.id = startId + index;
// 		}

// 		// Convert dependencies to numbers if they are strings
// 		if (subtask.dependencies && Array.isArray(subtask.dependencies)) {
// 			subtask.dependencies = subtask.dependencies.map((dep: any) => {
// 				return typeof dep === 'string' ? parseInt(dep, 10) : dep;
// 			});
// 		} else {
// 			subtask.dependencies = [];
// 		}

// 		// Ensure status is 'pending'
// 		subtask.status = 'pending';

// 		// Add parentTaskId if provided
// 		if (parentTaskId) {
// 			subtask.parentTaskId = parentTaskId;
// 		}

// 		return subtask;
// 	});

// 	return subtasks;
// }

/**
 * Compress image to ensure it's under 1MB for MCP image injection
 * @param {string} base64Data - Base64 encoded image data
 * @param {string} mimeType - Original MIME type of the image
 * @param {Object} log - Logger object
 * @returns {Promise<{base64: string, mimeType: string, originalSize: number, compressedSize: number}>}
 */
export async function compressImageIfNeeded(base64Data: string, mimeType: string, log: Logger): Promise<CompressionResult> {
	const MAX_SIZE_BYTES = 1048576; // 1MB in bytes

	try {
		// Convert base64 to buffer
		const originalBuffer = Buffer.from(base64Data, 'base64');
		const originalSize = originalBuffer.length;

		log?.info(
			`Original image size: ${originalSize} bytes (${(originalSize / 1024 / 1024).toFixed(2)} MB)`
		);

		// If already under 1MB, return as is
		if (originalSize <= MAX_SIZE_BYTES) {
					log?.info('Image is already under 1MB, no compression needed');
		return {
			base64Data: base64Data,
			mimeType: mimeType,
			originalSize: originalSize,
			compressedSize: originalSize,
			compressionRatio: 0
		};
		}

		log?.info('Image exceeds 1MB, compressing...');

		// Start with quality 80% and reduce if needed
		let quality = 80;
		let compressedBuffer;
		let finalMimeType = 'image/jpeg'; // Convert to JPEG for better compression

		do {
			const sharpInstance = sharp(originalBuffer);

			// Convert to JPEG with specified quality
			compressedBuffer = await sharpInstance
				.jpeg({ quality: quality, progressive: true })
				.toBuffer();

			log?.info(
				`Compressed with quality ${quality}%: ${compressedBuffer.length} bytes`
			);

			// Reduce quality if still too large
			if (compressedBuffer.length > MAX_SIZE_BYTES && quality > 10) {
				quality -= 10;
			} else {
				break;
			}
		} while (compressedBuffer.length > MAX_SIZE_BYTES && quality >= 10);

		// If still too large, try resizing
		if (compressedBuffer.length > MAX_SIZE_BYTES) {
			log?.info('Still too large after quality reduction, trying resize...');

			const sharpInstance = sharp(originalBuffer);
			const metadata = await sharpInstance.metadata();

			// Reduce dimensions by 20% at a time
			let scale = 0.8;
			do {
				const newWidth = Math.floor(metadata.width * scale);
				const newHeight = Math.floor(metadata.height * scale);

				compressedBuffer = await sharp(originalBuffer)
					.resize(newWidth, newHeight)
					.jpeg({ quality: 70, progressive: true })
					.toBuffer();

				log?.info(
					`Resized to ${newWidth}x${newHeight}: ${compressedBuffer.length} bytes`
				);

				scale -= 0.1;
			} while (compressedBuffer.length > MAX_SIZE_BYTES && scale > 0.3);
		}

		const compressedBase64 = compressedBuffer.toString('base64');
		const compressedSize = compressedBuffer.length;

		log?.info(
			`Final compressed size: ${compressedSize} bytes (${(compressedSize / 1024 / 1024).toFixed(2)} MB)`
		);
		log?.info(
			`Compression ratio: ${((1 - compressedSize / originalSize) * 100).toFixed(1)}%`
		);

		return {
			base64Data: compressedBase64,
			mimeType: finalMimeType,
			originalSize: originalSize,
			compressedSize: compressedSize,
			compressionRatio: (1 - compressedSize / originalSize)
		};
	} catch (error: any) {
		log?.error(`Error compressing image: ${error.message}`);
		// Return original image if compression fails
		return {
			base64Data: base64Data,
			mimeType: mimeType,
			originalSize: Buffer.from(base64Data, 'base64').length,
			compressedSize: Buffer.from(base64Data, 'base64').length,
			compressionRatio: 0
		};
	}
}

/**
 * Relationship priority mapping for determining primary relationship
 */
export const RELATIONSHIP_PRIORITY = {
	subtask: 1,
	dependency: 2,
	child: 3,
	parent: 4,
	blocks: 5,
	related: 6
};

/**
 * Deduplicate tickets from subtasks and related context into a unified structure
 * @param {Array} subtasks - Array of subtask objects
 * @param {Object} relatedContext - Related context with tickets array
 * @param {Object} log - Logger instance
 * @returns {Object} - Unified structure with deduplicated tickets
 */
export function deduplicateTickets(subtasks: any[], relatedContext: any, log: Logger): any {
	const ticketMap = new Map();

	// Helper function to add or merge relationships
	const addTicketWithRelationship = (ticket: any, relationship: any) => {
		const ticketId = ticket.jiraKey || ticket.id;
		if (!ticketId) {
			log.warn('Ticket found without ID, skipping');
			return;
		}

		if (ticketMap.has(ticketId)) {
			// Merge relationships
			const existing = ticketMap.get(ticketId);
			const newRelationships = [...existing.relationships];

			// Check if this relationship type already exists
			const existingRelType = newRelationships.find(
				(r) => r.type === relationship.type
			);
			if (!existingRelType) {
				newRelationships.push(relationship);
			}

			// Update primary relationship if this one has higher priority
			const currentPrimaryRel = existing.relationships.find((r: any) => r.primary);
			const currentPrimaryPriority =
				(currentPrimaryRel && currentPrimaryRel.type && RELATIONSHIP_PRIORITY[currentPrimaryRel.type as keyof typeof RELATIONSHIP_PRIORITY]) || 999;
			const newRelationshipPriority =
				(relationship.type && RELATIONSHIP_PRIORITY[relationship.type as keyof typeof RELATIONSHIP_PRIORITY]) || 999;

			if (newRelationshipPriority < currentPrimaryPriority) {
				// Set all existing to non-primary
				newRelationships.forEach((r) => (r.primary = false));
				// Set new one as primary
				const newRel = newRelationships.find(
					(r) => r.type === relationship.type
				);
				if (newRel) newRel.primary = true;
			}

			existing.relationships = newRelationships;

			// Merge pull requests - preserve the most detailed version
			const newPRs = ticket.pullRequests || [];
			if (newPRs.length > 0) {
				// Merge PRs by ID, keeping the most detailed version
				const prMap = new Map();

				// Add existing PRs to map
				(existing.pullRequests || []).forEach((pr: any) => {
					if (pr.id) {
						prMap.set(pr.id, pr);
					}
				});

				// Add/merge new PRs, preferring more detailed versions
				newPRs.forEach((pr: any) => {
					if (pr.id) {
						const existingPR = prMap.get(pr.id);
						if (!existingPR) {
							// New PR, add it
							prMap.set(pr.id, pr);
						} else {
							// PR exists, merge keeping the most detailed version
							// Prefer PR with diffstat/filesChanged data
							const hasNewDiffstat = pr.diffStat || pr.filesChanged;
							const hasExistingDiffstat =
								existingPR.diffStat || existingPR.filesChanged;

							if (hasNewDiffstat && !hasExistingDiffstat) {
								// New PR has diffstat, existing doesn't - use new
								prMap.set(pr.id, pr);
							} else if (!hasNewDiffstat && hasExistingDiffstat) {
								// Keep existing PR with diffstat
								// Do nothing
							} else {
								// Both have diffstat or neither has it - merge properties
								prMap.set(pr.id, {
									...existingPR,
									...pr,
									// Preserve detailed data from whichever has it
									diffStat: pr.diffStat || existingPR.diffStat,
									filesChanged:
										pr.filesChanged || existingPR.filesChanged,
									commits: pr.commits || existingPR.commits
								});
							}
						}
					}
				});

				existing.pullRequests = Array.from(prMap.values());
			}
		} else {
			// Add new ticket
			ticketMap.set(ticketId, {
				ticket,
				relationships: [
					{
						...relationship,
						primary: true
					}
				],
				pullRequests: ticket.pullRequests || [],
				relevanceScore: ticket.relevanceScore || 100
			});
		}
	};

	// Process subtasks first (highest priority)
	if (subtasks && Array.isArray(subtasks)) {
		subtasks.forEach((subtask) => {
			addTicketWithRelationship(subtask, {
				type: 'subtask',
				direction: 'child',
				depth: 1
			});
		});
		log.info(`Processed ${subtasks.length} subtasks`);
	}

	// Process related context tickets
	if (
		relatedContext &&
		relatedContext.tickets &&
		Array.isArray(relatedContext.tickets)
	) {
		relatedContext.tickets.forEach((contextItem: any) => {
			const ticket = contextItem.ticket;
			if (ticket) {
				// Create a ticket object with PR data attached for proper merging
				const ticketWithPRs = {
					...ticket,
					pullRequests: contextItem.pullRequests || [],
					relevanceScore: contextItem.relevanceScore || 100
				};

				addTicketWithRelationship(ticketWithPRs, {
					type: contextItem.relationship || 'related',
					direction: contextItem.direction || 'unknown',
					depth: contextItem.depth || 1
				});
			}
		});
		log.info(
			`Processed ${relatedContext.tickets.length} related context tickets`
		);
	}

	// Convert map to array and calculate summary
	const relatedTickets = Array.from(ticketMap.values());

	// Calculate relationship summary
	const relationshipSummary = {
		subtasks: relatedTickets.filter((t: any) =>
			t.relationships.some((r: any) => r.type === 'subtask')
		).length,
		dependencies: relatedTickets.filter((t: any) =>
			t.relationships.some((r: any) => r.type === 'dependency')
		).length,
		relatedTickets: relatedTickets.filter((t: any) =>
			t.relationships.some((r: any) => r.type === 'related')
		).length,
		totalUnique: relatedTickets.length
	};

	// Preserve original context summary if available
	const contextSummary = relatedContext?.summary || {
		overview: `Found ${relationshipSummary.totalUnique} unique related tickets`,
		recentActivity: 'No activity information available',
		completedWork: `${relatedTickets.filter((t) => t.ticket.status === 'done' || t.ticket.status === 'Done').length} tickets completed`,
		implementationInsights: []
	};

	log.info(
		`Deduplicated to ${relationshipSummary.totalUnique} unique tickets from ${(subtasks?.length || 0) + (relatedContext?.tickets?.length || 0)} total`
	);

	return {
		relatedTickets,
		relationshipSummary,
		contextSummary
	};
}

/**
 * Extract attachment images from context tickets and remove them from the context
 * @param {Object} relatedContext - The related context object containing tickets
 * @param {Object} log - Logger instance
 * @returns {Array} Array of extracted image objects
 */
export function extractAndRemoveContextImages(relatedContext: any, log: Logger): any[] {
	const contextImages: any[] = [];

	if (!relatedContext || !relatedContext.tickets) {
		return contextImages;
	}

	// Process each context ticket
	relatedContext.tickets.forEach((contextTicketWrapper: any, ticketIndex: number) => {
		// The structure is: contextTicketWrapper.ticket.attachmentImages
		// We need to check and remove from the nested ticket object
		if (
			contextTicketWrapper.ticket &&
			contextTicketWrapper.ticket.attachmentImages &&
			Array.isArray(contextTicketWrapper.ticket.attachmentImages)
		) {
			const imageCount = contextTicketWrapper.ticket.attachmentImages.length;

			// Extract images and add metadata about source ticket
			contextTicketWrapper.ticket.attachmentImages.forEach(
				(image: any, imageIndex: number) => {
					contextImages.push({
						...image,
						sourceTicket:
							contextTicketWrapper.ticket.key ||
							`context-ticket-${ticketIndex}`,
						sourceTicketSummary:
							contextTicketWrapper.ticket.summary || 'Unknown',
						contextIndex: ticketIndex,
						imageIndex: imageIndex
					});
				}
			);

			// Remove the attachmentImages array from the nested ticket object
			delete contextTicketWrapper.ticket.attachmentImages;
			log.info(
				`Extracted ${imageCount} images from context ticket ${contextTicketWrapper.ticket.key}`
			);
		}

		// Also check the wrapper level (for backwards compatibility)
		if (
			contextTicketWrapper.attachmentImages &&
			Array.isArray(contextTicketWrapper.attachmentImages)
		) {
			const imageCount = contextTicketWrapper.attachmentImages.length;

			// Extract images and add metadata about source ticket
			contextTicketWrapper.attachmentImages.forEach((image: any, imageIndex: number) => {
				contextImages.push({
					...image,
					sourceTicket:
						contextTicketWrapper.key || `context-ticket-${ticketIndex}`,
					sourceTicketSummary: contextTicketWrapper.summary || 'Unknown',
					contextIndex: ticketIndex,
					imageIndex: imageIndex
				});
			});

			// Remove the attachmentImages array from the wrapper
			delete contextTicketWrapper.attachmentImages;
			log.info(
				`Extracted ${imageCount} images from context ticket wrapper ${contextTicketWrapper.key}`
			);
		}
	});

	return contextImages;
}

/**
 * Add context to a JiraTicket if context services are available
 * @param {JiraTicket} ticket - The ticket to enhance with context
 * @param {string} ticketId - The ticket ID for context lookup
 * @param {number} maxRelatedTickets - Maximum number of related tickets to fetch
 * @param {boolean} withSubtasks - Whether subtasks are included
 * @param {Object} log - Logger instance
 * @param {Object} jiraConfig - Jira configuration for the session
 * @param {Object} bitbucketConfig - Bitbucket configuration for the session
 */
export async function addContextToTask(
	ticket: any,
	ticketId: string,
	maxRelatedTickets: number,
	withSubtasks: boolean,
	log: Logger,
	jiraConfig?: any,
	bitbucketConfig?: any
): Promise<any> {
	try {
		log.info(`Starting addContextToTask for ticket ${ticketId}`);
		

		// Check if context services are available
		const jiraClient = new JiraClient(jiraConfig);
		
		// Log detailed Jira client state
		log.info('Created JiraClient in addContextToTask:', {
			enabled: jiraClient.enabled,
			hasClient: !!jiraClient.client,
			error: jiraClient.error,
			config: {
				hasBaseUrl: !!jiraClient.config.baseUrl,
				hasEmail: !!jiraClient.config.email,
				hasApiToken: !!jiraClient.config.apiToken,
				hasProject: !!jiraClient.config.project,
				baseUrl: jiraClient.config.baseUrl,
				email: jiraClient.config.email,
				project: jiraClient.config.project,
				workspace: bitbucketConfig.workspace || 'MISSING',
				hasUsername: !!bitbucketConfig.username,
				hasBitbucketApiToken: !!bitbucketConfig.apiToken,
			}
		});
		
		if (!jiraClient.isReady()) {
			log.error('Jira client not ready in addContextToTask, skipping context');
			const validation = jiraClient.validateConfig(log);
			log.error('Jira validation result:', validation);
			return;
		}

		const bitbucketClient = new BitbucketClient(bitbucketConfig);
		if (!bitbucketClient.enabled) {
			log.info('Bitbucket client not enabled in addContextToTask, skipping context');
			const validation = bitbucketClient.validateConfig(log);
			log.info('Bitbucket validation result:', validation);
			return;
		}

		// Initialize context services
		const relationshipResolver = new JiraRelationshipResolver(jiraClient);
		const prMatcher = new PRTicketMatcher(bitbucketClient, jiraClient);
		const contextAggregator = new ContextAggregator(
			relationshipResolver,
			bitbucketClient,
			prMatcher
		);

		log.info(`Fetching context for ticket ${ticketId}...`);

		// Extract repository information from ticket's development info if available
		let detectedRepositories: string[] = [];

		// Try to get repository info from development status first
		if (prMatcher) {
			try {
				const devStatusResult = await prMatcher.getJiraDevStatus(ticketId);
				if (devStatusResult.success && devStatusResult.data) {
					// Extract unique repository names from PRs
					const repoNames = devStatusResult.data
						.filter((pr: any) => pr.repository)
						.map((pr: any) => {
							// Handle both full paths and repo names
							const repo = pr.repository;
							if (repo && typeof repo === 'string') {
								return repo.includes('/') ? repo.split('/')[1] : repo;
							}
							return null;
						})
						.filter((repo: string | null): repo is string => repo !== null)
						.filter((repo, index, arr) => arr.indexOf(repo) === index); // Remove duplicates

					detectedRepositories = repoNames;
					log.info(
						`Detected repositories from development info: ${detectedRepositories.join(', ')}`
					);
				}
			} catch (devError: unknown) {
				const errorMessage = devError instanceof Error ? devError.message : String(devError);
				log.warn(
					`Could not detect repositories from development info: ${errorMessage}`
				);
			}
		}

		// Get context with configurable maxRelated parameter
		// Use detected repositories for more targeted PR searches
		const contextPromise = contextAggregator.aggregateContext(ticketId, {
			depth: 2,
			maxRelated: maxRelatedTickets,
			detectedRepositories: detectedRepositories, // Pass detected repos for smarter PR matching
			log: {
				info: (msg) => log.info(msg),
				warn: (msg) => log.warn(msg),
				error: (msg) => log.error(msg),
				debug: (msg) =>
					log.debug ? log.debug(msg) : log.info(`[DEBUG] ${msg}`) // Fallback for debug
			}
		});

		// 30-second timeout for context retrieval (matches working test)
		const timeoutPromise = new Promise((_, reject) =>
			setTimeout(() => reject(new Error('Context retrieval timeout')), 30000)
		);

		// CRITICAL FIX: Fetch main ticket PR data BEFORE context aggregation and deduplication
		// This ensures the main ticket's PR data is available during deduplication
		if (!ticket.pullRequests || ticket.pullRequests.length === 0) {
			log.info(
				`Main ticket ${ticketId} has no PR data, fetching from development status...`
			);

			try {
				// Get PRs for the main ticket from Jira dev status
				const mainTicketPRs = await prMatcher.getJiraDevStatus(ticketId);

				if (
					mainTicketPRs.success &&
					mainTicketPRs.data &&
					mainTicketPRs.data.length > 0
				) {
					// The PRs are already enhanced by getJiraDevStatus
					ticket.pullRequests = mainTicketPRs.data;
					log.info(
						`Added ${mainTicketPRs.data.length} PRs to main ticket ${ticketId} BEFORE deduplication`
					);

											// Debug log PR details
						mainTicketPRs.data.forEach((pr: any) => {
							log.info(
								`Main ticket PR ${pr.id}: has diffStat=${!!pr.diffStat}, has filesChanged=${!!pr.filesChanged}`
							);
							if (pr.diffStat) {
								log.info(
									`  - Lines added: ${pr.diffStat.linesAdded}, Lines removed: ${pr.diffStat.linesRemoved}`
								);
							}
							if (pr.filesChanged && Array.isArray(pr.filesChanged)) {
								log.info(`  - Files changed: ${pr.filesChanged.length}`);
							} else if (typeof pr.filesChanged === 'number') {
								log.info(`  - Files changed: ${pr.filesChanged}`);
							}
						});
				}
			} catch (prError: any) {
				log.warn(`Failed to fetch PR data for main ticket: ${prError.message}`);
			}
		}

		const context = await Promise.race([contextPromise, timeoutPromise]) as any;

		if (context && typeof context === 'object' && 'relatedContext' in context && context.relatedContext) {
			// Extract attachment images from context tickets before processing
			const contextImages = extractAndRemoveContextImages(
				context.relatedContext,
				log
			);

			// Apply deduplication between subtasks and related context
			const deduplicatedData = deduplicateTickets(
				ticket.subtasks,
				context.relatedContext,
				log
			);

			// Replace the original structure with the unified deduplicated structure
			ticket.relatedTickets = deduplicatedData.relatedTickets;
			ticket.relationshipSummary = deduplicatedData.relationshipSummary;
			ticket.contextSummary = deduplicatedData.contextSummary;

			// Remove the old separate subtasks field since we now have unified relatedTickets
			// This eliminates duplication between subtasks and relatedTickets
			if (ticket.subtasks) {
				delete ticket.subtasks;
			}

			// Store context images for later use in the response
			if (contextImages.length > 0) {
				ticket._contextImages = contextImages;
				log.info(
					`Extracted ${contextImages.length} images from context tickets`
				);
			}
		} else {
			log.info('No context returned or no relatedContext property');
		}
	} catch (error: any) {
		log.warn(`Context retrieval failed: ${error.message}`);
		// Don't throw - context failure shouldn't break main functionality
	}
}
