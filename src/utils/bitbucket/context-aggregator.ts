/**
 * Context Aggregator for combining Jira relationship data with Bitbucket PR information
 * Provides intelligent filtering and formatting for optimal LLM consumption
 */

import { Logger, RelationshipData } from '../../types/jira';
import { JiraRelationshipResolver } from '../jira/jira-relationship-resolver';
import { BitbucketClient } from './bitbucket-client';
import { PRTicketMatcher } from './pr-ticket-matcher';

// Type definitions for Context Aggregator
export interface ContextConfig {
	maxRelated: number;
	maxAgeMonths: number;
	cacheTTL: number;
	enableFallback: boolean;
}

export interface AggregateContextOptions {
	depth?: number;
	includeTypes?: string[];
	repoSlug?: string | null;
	detectedRepositories?: string[];
	maxAge?: number;
	maxRelated?: number;
	log?: Logger;
}

export interface ContextTicket {
	ticket: any;
	relationship: string;
	direction: string;
	depth: number;
	pullRequests: any[];
	relevanceScore?: number;
	priorityScore?: number;
}

export interface ContextSummary {
	totalRelated: number;
	filteredOut: number;
	completedWork: number;
	activeWork: number;
	totalPRs: number;
	mergedPRs: number;
	averageRelevance: number;
	statusBreakdown: Record<string, number>;
}

export interface ContextSummaryInsights {
	overview: string;
	recentActivity: string;
	completedWork: string;
	implementationInsights: string[];
}

export interface RelatedContext {
	tickets: ContextTicket[];
	summary: ContextSummary;
	contextSummary: ContextSummaryInsights;
}

export interface ContextMetadata {
	contextGeneratedAt: string;
	repoSlug?: string | null;
	filteringApplied: boolean;
	totalRelated?: number;
	maxDepthReached?: number;
	relationshipTypes?: string[];
	fallbackMode?: boolean;
}

export interface AggregatedContext {
	sourceTicket: { key: string };
	relatedContext: RelatedContext;
	metadata: ContextMetadata;
}

export interface CacheEntry {
	data: AggregatedContext;
	expiry: number;
}

export interface CacheStats {
	total: number;
	valid: number;
	expired: number;
	hitRate: number;
}

export interface FileChangeSummary {
	added?: number;
	modified?: number;
	deleted?: number;
}

export interface PullRequest {
	id: string | number;
	status: string;
	fileChangeSummary?: FileChangeSummary;
	files?: Array<{ filename?: string }>;
	mergedDate?: string;
	updatedDate?: string;
	createdDate?: string;
	updated?: string;
	created?: string;
	diffStat?: any;
	filesChanged?: any;
	commits?: any;
	branchInfo?: any;
}

export interface Ticket {
	jiraKey: string;
	status?: string;
	updated?: string;
	created?: string;
	createdDate?: string;
	updatedDate?: string;
}

export class ContextAggregator {
	private jiraResolver: JiraRelationshipResolver;
	private bitbucketClient: BitbucketClient;
	private prMatcher: PRTicketMatcher;
	private cache: Map<string, CacheEntry>;
	private config: ContextConfig;
	private cacheHits: number = 0;
	private cacheRequests: number = 0;

	constructor(jiraResolver: JiraRelationshipResolver, bitbucketClient: BitbucketClient, prMatcher: PRTicketMatcher) {
		this.jiraResolver = jiraResolver;
		this.bitbucketClient = bitbucketClient;
		this.prMatcher = prMatcher;
		this.cache = new Map();
		
		// Configuration defaults
		this.config = {
			maxRelated: parseInt(process.env.CONTEXT_MAX_RELATED || '20') || 20,
			maxAgeMonths: parseInt(process.env.CONTEXT_MAX_AGE_MONTHS || '6') || 6,
			cacheTTL: parseInt(process.env.CONTEXT_CACHE_TTL || '300') || 300, // 5 minutes
			enableFallback: process.env.CONTEXT_ENABLE_FALLBACK !== 'false'
		};
	}

	/**
	 * Aggregate comprehensive context for a given issue
	 * @param issueKey - The Jira issue key
	 * @param options - Configuration options
	 * @returns Structured context object
	 */
	async aggregateContext(issueKey: string, options: AggregateContextOptions = {}): Promise<AggregatedContext> {
		const {
			depth = 2,
			includeTypes = ['parent', 'child', 'epic', 'story', 'dependency', 'relates'],
			repoSlug = null, // Let PR matcher search across all repositories
			detectedRepositories = [], // Repository names detected from main ticket's development info
			maxAge = this.config.maxAgeMonths,
			maxRelated = this.config.maxRelated,
			log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
		} = options;

		// Check cache first
		const cacheKey = this.generateCacheKey(issueKey, repoSlug, options);
		const cached = this.getFromCache(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			// Primary flow with full context
			const context = await this.buildFullContext(issueKey, {
				depth,
				includeTypes,
				repoSlug,
				detectedRepositories,
				maxAge,
				maxRelated,
				log
			});

			// Cache the result
			this.setCache(cacheKey, context);
			return context;

		} catch (error: any) {
			if (this.config.enableFallback) {
				// Fallback: Return Jira relationships only
				console.warn(`Bitbucket unavailable, returning Jira context only: ${error.message}`);
				return await this.getJiraOnlyContext(issueKey, { depth, includeTypes, maxAge, maxRelated });
			} else {
				throw error;
			}
		}
	}

	/**
	 * Build full context with both Jira and Bitbucket data
	 * @param issueKey - The Jira issue key
	 * @param options - Configuration options
	 * @returns Full context object
	 */
	async buildFullContext(issueKey: string, options: Required<AggregateContextOptions>): Promise<AggregatedContext> {
		const { depth, includeTypes, repoSlug, detectedRepositories = [], maxAge, maxRelated, log } = options;

		// 1. Get relationship graph from JiraRelationshipResolver
		const relationships = await this.jiraResolver.resolveRelationships(issueKey, {
			depth,
			includeTypes,
			log // Pass the logger to the relationship resolver
		});

		if (!relationships || !relationships.success || !relationships.data || !relationships.data.relationships) {
			return this.createEmptyContext(issueKey);
		}

		// 2. Batch fetch PRs for all related tickets in parallel
		const ticketKeys = relationships.data.relationships.map((r: RelationshipData) => r.issueKey);
		
		// Use detected repositories for smarter PR searches
		const prPromises = ticketKeys.map(async (key: string) => {
			try {
				// If we have detected repositories, try each one
				if (detectedRepositories && detectedRepositories.length > 0) {
					let allPRs: any[] = [];
					
					// Search in each detected repository
					for (const repo of detectedRepositories) {
						try {
							const repoResult = await this.prMatcher.findPRsForTicket(key, repo);
							if (repoResult.success && repoResult.data && repoResult.data.pullRequests) {
								allPRs.push(...repoResult.data.pullRequests);
							}
						} catch (repoError: any) {
							log.warn(`Failed to search repository ${repo} for ${key}: ${repoError.message}`);
						}
					}
					
					// If we found PRs in detected repos, return them
					if (allPRs.length > 0) {
						return { success: true, data: { pullRequests: allPRs } };
					}
				}
				
				// Fallback: search without specific repository (uses dev-status API)
				if (!repoSlug) {
					return await this.prMatcher.findPRsForTicket(key, null);
				} else {
					return await this.prMatcher.findPRsForTicket(key, repoSlug);
				}
			} catch (error: any) {
				console.warn(`Failed to fetch PRs for ${key}: ${error.message}`);
				return { success: false, data: { pullRequests: [] } }; // Return structured response on failure
			}
		});

		const prResults = await Promise.allSettled(prPromises);

		// 3. Combine relationship data with PR data
		const enrichedTickets: ContextTicket[] = relationships.data.relationships.map((relationship: any, index: number) => {
			const prResult = prResults[index];
			
			let pullRequests: any[] = [];
			if (prResult.status === 'fulfilled' && prResult.value) {
				if (prResult.value.success && prResult.value.data && prResult.value.data.pullRequests) {
					pullRequests = prResult.value.data.pullRequests;
					// Debug: Log PR data details
					if (pullRequests.length > 0 && relationship.issue.jiraKey === 'GROOT-287') {
						// Debug logging removed for MCP compatibility
					}
				} else if (Array.isArray(prResult.value)) {
					// Fallback for old format
					pullRequests = prResult.value;
				}
			}
			
			return {
				ticket: relationship.issue,
				relationship: relationship.relationship,
				direction: relationship.direction,
				depth: relationship.depth,
				pullRequests: pullRequests || []
			};
		});

		// 4. Apply intelligent filtering
		const filteredTickets = this.applyIntelligentFiltering(enrichedTickets, maxAge, maxRelated);
		
		// Track unique tickets before and after filtering for accurate filteredOut count
		const uniqueTicketsBefore = new Set(enrichedTickets.map(t => t.ticket.jiraKey)).size;

		// 5. Calculate relevance scores
		const scoredTickets = filteredTickets.map(ticket => ({
			...ticket,
			relevanceScore: this.calculateRelevanceScore(ticket.ticket, ticket.pullRequests, ticket.relationship)
		}));

		// 6. Sort by relevance and limit size
		const finalTickets = this.limitContextSize(scoredTickets, maxRelated);

		// 7. Generate summary and insights
		const summary = this.generateSummary(finalTickets, uniqueTicketsBefore);
		const contextSummary = this.generateContextSummary(finalTickets, summary);

		return {
			sourceTicket: { key: relationships.data.sourceIssue || issueKey },
			relatedContext: {
				tickets: finalTickets,
				summary,
				contextSummary
			},
			metadata: {
				...relationships.data.metadata,
				contextGeneratedAt: new Date().toISOString(),
				repoSlug,
				filteringApplied: enrichedTickets.length > finalTickets.length
			}
		};
	}

	/**
	 * Get Jira-only context as fallback
	 * @param issueKey - The Jira issue key
	 * @param options - Configuration options
	 * @returns Jira-only context object
	 */
	async getJiraOnlyContext(issueKey: string, options: Partial<AggregateContextOptions>): Promise<AggregatedContext> {
		const { depth, includeTypes, maxAge, maxRelated } = options;

		try {
			const relationships = await this.jiraResolver.resolveRelationships(issueKey, {
				depth,
				includeTypes
			});

			if (!relationships || !relationships.success || !relationships.data || !relationships.data.relationships) {
				return this.createEmptyContext(issueKey);
			}

			// Convert to enriched format and try to get PRs from Jira dev status API
			const enrichedTickets = await Promise.all(relationships.data.relationships.map(async (relationship: RelationshipData) => {
				let pullRequests: any[] = [];
				
				// Try to get PRs from Jira development status API (doesn't require Bitbucket configuration)
				if (this.prMatcher) {
					try {
						const prResult = await this.prMatcher.findPRsForTicket(relationship.issueKey, null);
						if (prResult.success && prResult.data && prResult.data.pullRequests) {
							pullRequests = prResult.data.pullRequests;
						}
					} catch (error: any) {
						// Silently ignore PR fetch errors in fallback mode
						console.debug(`Could not fetch PRs for ${relationship.issueKey} in fallback mode: ${error.message}`);
					}
				}
				
				return {
					ticket: relationship.issue,
					relationship: relationship.relationship,
					direction: relationship.direction,
					depth: relationship.depth,
					pullRequests,
					relevanceScore: this.calculateRelevanceScore(relationship.issue, pullRequests, relationship.relationship)
				};
			}));

			// Apply basic filtering and limiting
			const filteredTickets = this.filterByRecency(enrichedTickets, maxAge || this.config.maxAgeMonths);
			const finalTickets = this.limitContextSize(filteredTickets, maxRelated || this.config.maxRelated);

			// Track unique tickets for accurate filteredOut count
			const uniqueTicketsBefore = new Set(enrichedTickets.map((t: ContextTicket) => t.ticket.jiraKey)).size;
			const summary = this.generateSummary(finalTickets, uniqueTicketsBefore);
			const contextSummary = this.generateContextSummary(finalTickets, summary);

			return {
				sourceTicket: { key: relationships.data.sourceIssue || issueKey },
				relatedContext: {
					tickets: finalTickets,
					summary,
					contextSummary
				},
				metadata: {
					...relationships.data.metadata,
					contextGeneratedAt: new Date().toISOString(),
					fallbackMode: true,
					filteringApplied: enrichedTickets.length > finalTickets.length
				}
			};
		} catch (error: any) {
			console.error(`Failed to get Jira-only context for ${issueKey}: ${error.message}`);
			return this.createEmptyContext(issueKey);
		}
	}

	/**
	 * Apply intelligent filtering based on recency and relevance
	 * @param tickets - Array of enriched ticket objects
	 * @param maxAge - Maximum age in months
	 * @param maxRelated - Maximum number of related items
	 * @returns Filtered tickets
	 */
	applyIntelligentFiltering(tickets: ContextTicket[], maxAge: number, maxRelated: number): ContextTicket[] {
		// First deduplicate tickets by jiraKey, keeping the highest priority relationship
		const deduplicatedTickets = this.deduplicateTickets(tickets);
		
		// Then filter by recency
		const recentTickets = this.filterByRecency(deduplicatedTickets, maxAge);
		
		// Then apply additional relevance-based filtering if needed
		if (recentTickets.length <= maxRelated) {
			return recentTickets;
		}

		// If we still have too many, prioritize by relationship type and status
		return this.prioritizeByImportance(recentTickets, maxRelated);
	}

	/**
	 * Deduplicate tickets by jiraKey, keeping the highest priority relationship
	 * @param tickets - Array of ticket objects
	 * @returns Deduplicated tickets
	 */
	deduplicateTickets(tickets: ContextTicket[]): ContextTicket[] {
		// Priority order: parent > child > epic > story > dependency > relates
		const relationshipPriority: Record<string, number> = {
			'parent': 100,
			'child': 90,
			'epic': 80,
			'story': 75,
			'dependency': 70,
			'blocks': 65,
			'blocked': 65,
			'relates': 60
		};

		const ticketMap = new Map<string, ContextTicket>();

		for (const ticketData of tickets) {
			const jiraKey = ticketData.ticket.jiraKey;
			const currentPriority = relationshipPriority[ticketData.relationship] || 50;

			if (!ticketMap.has(jiraKey)) {
				// First time seeing this ticket
				ticketMap.set(jiraKey, ticketData);
			} else {
				// Ticket already exists, check if current relationship has higher priority
				const existingTicket = ticketMap.get(jiraKey)!;
				const existingPriority = relationshipPriority[existingTicket.relationship] || 50;

				if (currentPriority > existingPriority) {
					// Current relationship has higher priority, but preserve PR data from both
					const mergedTicket: ContextTicket = {
						...ticketData,
						pullRequests: this.mergePullRequests(existingTicket.pullRequests || [], ticketData.pullRequests || [])
					};
					ticketMap.set(jiraKey, mergedTicket);
				} else {
					// Keep existing ticket but merge PR data
					const existingWithMergedPRs: ContextTicket = {
						...existingTicket,
						pullRequests: this.mergePullRequests(existingTicket.pullRequests || [], ticketData.pullRequests || [])
					};
					ticketMap.set(jiraKey, existingWithMergedPRs);
				}
			}
		}

		return Array.from(ticketMap.values());
	}

	/**
	 * Merge pull requests from multiple sources, preserving the most detailed version of each PR
	 * @param existingPRs - Existing pull requests
	 * @param newPRs - New pull requests to merge
	 * @returns Merged pull requests array
	 */
	mergePullRequests(existingPRs: PullRequest[], newPRs: PullRequest[]): PullRequest[] {
		if (!existingPRs || existingPRs.length === 0) {
			return newPRs || [];
		}
		if (!newPRs || newPRs.length === 0) {
			return existingPRs;
		}

		const prMap = new Map<string | number, PullRequest>();
		
		// Add existing PRs to map
		existingPRs.forEach(pr => {
			if (pr.id) {
				prMap.set(pr.id, pr);
			}
		});
		
		// Add/merge new PRs, preferring more detailed versions
		newPRs.forEach(pr => {
			if (pr.id) {
				const existingPR = prMap.get(pr.id);
				if (!existingPR) {
					// New PR, add it
					prMap.set(pr.id, pr);
				} else {
					// PR exists, merge keeping the most detailed version
					// Prefer PR with diffstat/filesChanged data
					const hasNewDiffstat = pr.diffStat || pr.filesChanged;
					const hasExistingDiffstat = existingPR.diffStat || existingPR.filesChanged;
					
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
							filesChanged: pr.filesChanged || existingPR.filesChanged,
							commits: pr.commits || existingPR.commits,
							branchInfo: pr.branchInfo || existingPR.branchInfo
						});
					}
				}
			}
		});
		
		return Array.from(prMap.values());
	}

	/**
	 * Filter tickets by recency
	 * @param tickets - Array of ticket objects
	 * @param maxAgeMonths - Maximum age in months
	 * @returns Filtered tickets
	 */
	filterByRecency(tickets: ContextTicket[], maxAgeMonths: number = 6): ContextTicket[] {
		const cutoffDate = new Date();
		cutoffDate.setMonth(cutoffDate.getMonth() - maxAgeMonths);

		return tickets.filter(ticketData => {
			const ticket = ticketData.ticket;
			const pullRequests = ticketData.pullRequests || [];
			const relationship = ticketData.relationship;

			// Always preserve essential relationship types regardless of age
			// These provide crucial hierarchical context
			if (['parent', 'epic', 'child'].includes(relationship)) {
				return true;
			}

			// For other relationships, apply age filtering
			
			// Check ticket dates
			const ticketDate = this.getTicketDate(ticket);
			if (ticketDate && ticketDate > cutoffDate) {
				return true;
			}

			// Check PR dates
			const hasRecentPR = pullRequests.some(pr => {
				const prDate = this.getPRDate(pr);
				return prDate && prDate > cutoffDate;
			});

			return hasRecentPR;
		});
	}

	/**
	 * Prioritize tickets by importance when we need to limit the count
	 * @param tickets - Array of ticket objects
	 * @param maxCount - Maximum number to keep
	 * @returns Prioritized tickets
	 */
	prioritizeByImportance(tickets: ContextTicket[], maxCount: number): ContextTicket[] {
		// Priority order: parent > child > epic > dependency > relates
		const relationshipPriority: Record<string, number> = {
			'parent': 100,
			'child': 90,
			'epic': 80,
			'dependency': 70,
			'relates': 60,
			'blocks': 65,
			'blocked': 65
		};

		// Status priority: In Progress > Done > To Do > others
		const statusPriority: Record<string, number> = {
			'In Progress': 100,
			'Done': 90,
			'To Do': 80,
			'Review': 85,
			'Testing': 85
		};

		const scored = tickets.map(ticketData => {
			const relScore = relationshipPriority[ticketData.relationship] || 50;
			const statusScore = statusPriority[ticketData.ticket.status] || 50;
			const prScore = ticketData.pullRequests.length > 0 ? 20 : 0;
			
			return {
				...ticketData,
				priorityScore: relScore + statusScore + prScore
			};
		});

		return scored
			.sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
			.slice(0, maxCount);
	}

	/**
	 * Calculate relevance score for a ticket
	 * @param ticket - The ticket object
	 * @param pullRequests - Associated pull requests
	 * @param relationship - Relationship type
	 * @returns Relevance score (0-100)
	 */
	calculateRelevanceScore(ticket: Ticket, pullRequests: PullRequest[] = [], relationship: string = 'relates'): number {
		let score = 0;

		// Relationship proximity scoring
		const relationshipScores: Record<string, number> = {
			'parent': 100,
			'child': 90,
			'epic': 80,
			'dependency': 75,
			'relates': 60,
			'blocks': 70,
			'blocked': 70
		};
		score += relationshipScores[relationship] || 50;

		// Ticket status scoring
		const statusScores: Record<string, number> = {
			'Done': 90,
			'In Progress': 100,
			'Review': 85,
			'Testing': 85,
			'To Do': 70
		};
		score += (statusScores[ticket.status || ''] || 50) * 0.3;

		// PR status and activity scoring
		if (pullRequests && pullRequests.length > 0) {
			const prScore = pullRequests.reduce((acc, pr) => {
				let prPoints = 0;
				
				// PR status
				if (pr.status === 'MERGED') prPoints += 30;
				else if (pr.status === 'OPEN') prPoints += 20;
				else if (pr.status === 'DECLINED') prPoints += 5;

				// File changes (more changes = more relevant)
				if (pr.fileChangeSummary) {
					const totalFiles = (pr.fileChangeSummary.added || 0) + 
													 (pr.fileChangeSummary.modified || 0) + 
													 (pr.fileChangeSummary.deleted || 0);
					prPoints += Math.min(totalFiles * 2, 20);
				}

				// Recency bonus
				const prDate = this.getPRDate(pr);
				if (prDate) {
					const daysSince = (Date.now() - prDate.getTime()) / (1000 * 60 * 60 * 24);
					if (daysSince < 30) prPoints += 15;
					else if (daysSince < 90) prPoints += 10;
					else if (daysSince < 180) prPoints += 5;
				}

				return acc + prPoints;
			}, 0);

			score += Math.min(prScore * 0.4, 40); // Cap PR contribution
		}

		return Math.min(Math.round(score), 100);
	}

	/**
	 * Limit context size while preserving essential relationships
	 * @param tickets - Array of scored ticket objects
	 * @param maxRelated - Maximum number of related items
	 * @returns Limited ticket array
	 */
	limitContextSize(tickets: ContextTicket[], maxRelated: number = 20): ContextTicket[] {
		if (tickets.length <= maxRelated) {
			return tickets.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
		}

		// Ensure essential relationships (parent/child) are preserved
		const essential = tickets.filter(t => 
			['parent', 'child'].includes(t.relationship)
		);
		
		const nonEssential = tickets.filter(t => 
			!['parent', 'child'].includes(t.relationship)
		);

		// Sort by relevance score
		const sortedNonEssential = nonEssential.sort((a, b) => 
			(b.relevanceScore || 0) - (a.relevanceScore || 0)
		);

		// Take essential + top non-essential up to maxRelated
		const remainingSlots = maxRelated - essential.length;
		const selected = essential.concat(
			sortedNonEssential.slice(0, Math.max(0, remainingSlots))
		);

		return selected.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
	}

	/**
	 * Generate summary statistics
	 * @param finalTickets - Final filtered tickets
	 * @param uniqueOriginalCount - Count of unique tickets before filtering (excluding duplicates)
	 * @returns Summary object
	 */
	generateSummary(finalTickets: ContextTicket[], uniqueOriginalCount: number): ContextSummary {
		const totalPRs = finalTickets.reduce((acc, t) => acc + (t.pullRequests?.length || 0), 0);
		const mergedPRs = finalTickets.reduce((acc, t) => {
			return acc + (t.pullRequests?.filter(pr => pr.status === 'MERGED')?.length || 0);
		}, 0);

		const statusCounts = finalTickets.reduce((acc, t) => {
			const status = t.ticket.status || 'Unknown';
			acc[status] = (acc[status] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		const avgRelevance = finalTickets.length > 0 
			? Math.round(finalTickets.reduce((acc, t) => acc + (t.relevanceScore || 0), 0) / finalTickets.length)
			: 0;

		// Calculate actual unique tickets in final result
		const uniqueFinalCount = new Set(finalTickets.map(t => t.ticket.jiraKey)).size;

		return {
			totalRelated: finalTickets.length,
			filteredOut: uniqueOriginalCount - uniqueFinalCount, // Only count actually removed unique tickets
			completedWork: statusCounts['Done'] || 0,
			activeWork: (statusCounts['In Progress'] || 0) + (statusCounts['Review'] || 0) + (statusCounts['Testing'] || 0),
			totalPRs,
			mergedPRs,
			averageRelevance: avgRelevance,
			statusBreakdown: statusCounts
		};
	}

	/**
	 * Generate actionable context summary
	 * @param tickets - Final ticket array
	 * @param summary - Summary statistics
	 * @returns Context summary with insights
	 */
	generateContextSummary(tickets: ContextTicket[], summary: ContextSummary): ContextSummaryInsights {
		const insights: string[] = [];
		
		// Recent activity insights
		if (summary.activeWork > 0) {
			insights.push(`${summary.activeWork} related tickets currently in active development`);
		}
		
		// Implementation history insights
		if (summary.completedWork > 0 && summary.mergedPRs > 0) {
			insights.push(`${summary.completedWork} completed tickets with ${summary.mergedPRs} merged PRs provide implementation context`);
		}
		
		// Technology patterns from PRs
		const technologies = this.extractTechnologyPatterns(tickets);
		if (technologies.length > 0) {
			insights.push(`Common technologies used: ${technologies.slice(0, 3).join(', ')}`);
		}
		
		// Dependency insights
		const dependencies = tickets.filter(t => t.relationship === 'dependency');
		if (dependencies.length > 0) {
			insights.push(`${dependencies.length} dependency relationships require coordination`);
		}

		return {
			overview: `Found ${summary.totalRelated} related tickets with ${summary.totalPRs} associated PRs`,
			recentActivity: summary.activeWork > 0 
				? `${summary.activeWork} tickets currently in progress`
				: 'No active work found in related tickets',
			completedWork: summary.completedWork > 0
				? `${summary.completedWork} tickets completed with implementation details`
				: 'No completed work found for reference',
			implementationInsights: insights
		};
	}

	/**
	 * Extract technology patterns from PR file changes
	 * @param tickets - Array of ticket objects with PRs
	 * @returns Array of technology names
	 */
	extractTechnologyPatterns(tickets: ContextTicket[]): string[] {
		const fileExtensions = new Map<string, number>();
		
		tickets.forEach(ticket => {
			if (ticket.pullRequests) {
				ticket.pullRequests.forEach(pr => {
					if (pr.files) {
						pr.files.forEach((file: { filename?: string }) => {
							const ext = file.filename?.split('.').pop()?.toLowerCase();
							if (ext) {
								fileExtensions.set(ext, (fileExtensions.get(ext) || 0) + 1);
							}
						});
					}
				});
			}
		});

		// Map extensions to technologies
		const techMap: Record<string, string> = {
			'js': 'JavaScript',
			'ts': 'TypeScript',
			'jsx': 'React',
			'tsx': 'React/TypeScript',
			'vue': 'Vue.js',
			'py': 'Python',
			'java': 'Java',
			'cs': 'C#',
			'go': 'Go',
			'rs': 'Rust',
			'php': 'PHP',
			'rb': 'Ruby',
			'css': 'CSS',
			'scss': 'SCSS',
			'less': 'LESS',
			'sql': 'SQL',
			'json': 'JSON',
			'yml': 'YAML',
			'yaml': 'YAML',
			'md': 'Markdown'
		};

		return Array.from(fileExtensions.entries())
			.sort((a, b) => b[1] - a[1]) // Sort by frequency
			.map(([ext, count]) => techMap[ext])
			.filter(Boolean)
			.slice(0, 5); // Top 5 technologies
	}

	/**
	 * Get the most relevant date from a ticket
	 * @param ticket - The ticket object
	 * @returns The ticket date
	 */
	getTicketDate(ticket: Ticket): Date | null {
		// Try updated date first, then created date
		const dateStr = ticket.updated || ticket.created || ticket.createdDate || ticket.updatedDate;
		return dateStr ? new Date(dateStr) : null;
	}

	/**
	 * Get the most relevant date from a PR
	 * @param pr - The PR object
	 * @returns The PR date
	 */
	getPRDate(pr: PullRequest): Date | null {
		// Try merged date first, then updated, then created
		const dateStr = pr.mergedDate || pr.updatedDate || pr.createdDate || pr.updated || pr.created;
		return dateStr ? new Date(dateStr) : null;
	}

	/**
	 * Create empty context object
	 * @param issueKey - The issue key
	 * @returns Empty context object
	 */
	createEmptyContext(issueKey: string): AggregatedContext {
		return {
			sourceTicket: { key: issueKey },
			relatedContext: {
				tickets: [],
				summary: {
					totalRelated: 0,
					filteredOut: 0,
					completedWork: 0,
					activeWork: 0,
					totalPRs: 0,
					mergedPRs: 0,
					averageRelevance: 0,
					statusBreakdown: {}
				},
				contextSummary: {
					overview: 'No related tickets found',
					recentActivity: 'No active work found',
					completedWork: 'No completed work found',
					implementationInsights: []
				}
			},
			metadata: {
				contextGeneratedAt: new Date().toISOString(),
				totalRelated: 0,
				maxDepthReached: 0,
				relationshipTypes: [],
				filteringApplied: false
			}
		};
	}

	// Cache Management Methods

	/**
	 * Generate cache key for context data
	 * @param issueKey - The issue key
	 * @param repoSlug - Repository slug
	 * @param options - Options object
	 * @returns Cache key
	 */
	generateCacheKey(issueKey: string, repoSlug: string | null, options: AggregateContextOptions): string {
		const optionsStr = JSON.stringify({
			depth: options.depth || 2,
			includeTypes: options.includeTypes || ['parent', 'child', 'epic', 'dependency', 'relates'],
			maxAge: options.maxAge || this.config.maxAgeMonths,
			maxRelated: options.maxRelated || this.config.maxRelated
		});
		return `context:${issueKey}:${repoSlug || 'default'}:${Buffer.from(optionsStr).toString('base64')}`;
	}

	/**
	 * Get data from cache
	 * @param key - Cache key
	 * @returns Cached data or null
	 */
	getFromCache(key: string): AggregatedContext | null {
		this.cacheRequests++;
		const entry = this.cache.get(key);
		if (!entry) {
			return null;
		}

		// Check TTL
		if (Date.now() > entry.expiry) {
			this.cache.delete(key);
			return null;
		}

		this.cacheHits++;
		return entry.data;
	}

	/**
	 * Set data in cache
	 * @param key - Cache key
	 * @param data - Data to cache
	 */
	setCache(key: string, data: AggregatedContext): void {
		// Determine TTL based on data freshness
		const hasActiveWork = data.relatedContext?.summary?.activeWork > 0;
		const ttl = hasActiveWork ? this.config.cacheTTL : this.config.cacheTTL * 6; // 30 min for completed work

		const expiry = Date.now() + (ttl * 1000);
		this.cache.set(key, { data, expiry });

		// Clean up old entries if cache gets too large
		if (this.cache.size > 100) {
			this.cleanupCache();
		}
	}

	/**
	 * Clean up expired cache entries
	 */
	cleanupCache(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiry) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Clear all cache entries
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics
	 * @returns Cache statistics
	 */
	getCacheStats(): CacheStats {
		const now = Date.now();
		let expired = 0;
		let valid = 0;

		for (const [key, entry] of this.cache.entries()) {
			if (now > entry.expiry) {
				expired++;
			} else {
				valid++;
			}
		}

		return {
			total: this.cache.size,
			valid,
			expired,
			hitRate: this.cacheHits / Math.max(this.cacheRequests, 1)
		};
	}

	/**
	 * Create standardized error response
	 * @param code - Error code
	 * @param message - Error message
	 * @param details - Additional error details
	 * @returns Error response object
	 */
	createErrorResponse(code: string, message: string, details: any = null): { success: false; error: { code: string; message: string; details: any } } {
		return {
			success: false,
			error: { code, message, details }
		};
	}
}

export default ContextAggregator; 