/**
 * pr-ticket-matcher.ts
 *
 * Service to identify relationships between Jira tickets and Bitbucket Pull Requests
 * through various linking mechanisms including commit message parsing, branch naming
 * conventions, and Bitbucket-Jira integration links.
 */

import { Logger } from '../../types/jira';

// Import BitbucketClient from the TypeScript file
import { BitbucketClient } from './bitbucket-client.js';

export interface JiraClient {
	fetchRemoteLinks(ticketKey: string): Promise<any>;
	getClient(): any;
}

export interface PRMatch {
	id: number;
	title: string;
	status: string;
	url: string;
	branch?: string;
	commits?: number;
	filesChanged?: number | FileChange[];
	createdDate?: string | null;
	updatedDate?: string | null;
	author?: string | null;
	confidence: number;
	matchSources: string[];
	description?: string;
	state?: string;
	mergeCommit?: string;
	commentCount?: number;
	taskCount?: number;
	diffStat?: {
		totalFiles: number;
		linesAdded: number;
		linesRemoved: number;
	};
	repository?: string;
	sourceBranch?: string;
	destinationBranch?: string;
	repositoryUrl?: string;
	created?: string;
	updated?: string;
	reviewers?: any[];
	source?: string;
	branchInfo?: {
		name: string;
		repository?: string;
		url: string;
		lastCommit?: any;
	};
}

export interface FileChange {
	path: string;
	status: string;
	linesAdded: number;
	linesRemoved: number;
	type: string;
}

export interface TicketMatch {
	ticketKey: string;
	confidence: number;
	sources: string[];
}

export interface FindPRsOptions {
	states?: string[];
	maxResults?: number;
}

export interface BatchMatchOptions {
	states?: string[];
	maxResults?: number;
}

export interface PRTicketResult {
	ticketKey: string;
	pullRequests: PRMatch[];
}

export interface TicketPRResult {
	prId: number;
	repoSlug: string;
	tickets: TicketMatch[];
}

export interface DevelopmentInfo {
	hasPRs: boolean;
	prCount: number;
	hasCommits?: boolean;
	commitCount?: number;
	prState?: string;
	lastUpdated?: string;
	sources?: string[];
}

export interface RemoteLinksResult {
	success: boolean;
	data: PRMatch[];
	developmentInfo?: DevelopmentInfo;
}

export interface CacheEntry {
	data: any;
	timestamp: number;
}

/**
 * Common patterns found in commit messages to identify ticket references
 */
const TICKET_PATTERNS: RegExp[] = [
	/([A-Z]{2,}-\d+):\s*/,           // "JAR-123: Fix bug"
	/([A-Z]{2,}-\d+)\s*-\s*/,       // "JAR-123 - Fix bug"
	/\[([A-Z]{2,}-\d+)\]/,          // "[JAR-123] Fix bug"
	/([A-Z]{2,}-\d+)\s*\|\s*/,      // "JAR-123 | Fix bug"
	/\b([A-Z]{2,}-\d+)\b/g,         // "JAR-123" as word boundary (for extraction only)
];

/**
 * Standard branch naming patterns
 */
const BRANCH_PATTERNS: RegExp[] = [
	/^feature\/([A-Z]{2,}-\d+)/,    // "feature/JAR-123-description"
	/^bugfix\/([A-Z]{2,}-\d+)/,     // "bugfix/JAR-123-fix"
	/^hotfix\/([A-Z]{2,}-\d+)/,     // "hotfix/JAR-123-urgent"
	/^([A-Z]{2,}-\d+)-/,            // "JAR-123-feature-description"
	/\/([A-Z]{2,}-\d+)-/,           // "any-prefix/JAR-123-description"
];

/**
 * Confidence score thresholds
 */
const CONFIDENCE_THRESHOLDS = {
	OFFICIAL_LINK: 95,    // Official Jira-Bitbucket links
	EXACT_BRANCH: 90,     // Exact branch name match
	COMMIT_TITLE: 85,     // Ticket in commit title
	COMMIT_MESSAGE: 75,   // Ticket in commit message
	BRANCH_PATTERN: 70,   // Standard branch pattern
	PARTIAL_MATCH: 50,    // Partial or weak indicators
	UNCERTAIN: 25         // Very uncertain matches
} as const;

/**
 * PRTicketMatcher class for identifying relationships between Jira tickets and Bitbucket PRs
 */
export class PRTicketMatcher {
	private bitbucketClient: BitbucketClient;
	private jiraClient: JiraClient;
	private cache: Map<string, CacheEntry>;
	private cacheTimeout: number;

	/**
	 * Create a new PRTicketMatcher instance
	 * @param bitbucketClient - BitbucketClient instance
	 * @param jiraClient - JiraClient instance
	 */
	constructor(bitbucketClient: BitbucketClient, jiraClient: JiraClient) {
		this.bitbucketClient = bitbucketClient;
		this.jiraClient = jiraClient;
		this.cache = new Map();
		this.cacheTimeout = 10 * 60 * 1000; // 10 minutes
	}

	/**
	 * Find all PRs related to a specific ticket
	 * @param ticketKey - Jira ticket key (e.g., "JAR-123")
	 * @param repoSlug - Repository name/slug
	 * @param options - Additional options
	 * @returns Result with PR matches and confidence scores
	 */
	async findPRsForTicket(ticketKey: string, repoSlug: string | null = null, options: FindPRsOptions = {}): Promise<{ success: boolean; data?: PRTicketResult; error?: any; fromCache?: boolean }> {
		try {
			const { states = ['OPEN', 'MERGED'], maxResults = 100 } = options;
			const cacheKey = `pr-ticket:${ticketKey}:${repoSlug || 'all-repos'}:${states.join(',')}`;
			
			// Check cache first
			const cached = this.getFromCache(cacheKey);
			if (cached) {
				return { success: true, data: cached, fromCache: true };
			}

			// Try Jira dev-status API first if no specific repository is provided
			// Note: This API may not be available on all Jira instances
			let devStatusFound = false;
			if (!repoSlug) {
				try {
					const devStatusResult = await this.getJiraDevStatus(ticketKey);
					if (devStatusResult.success && devStatusResult.data && devStatusResult.data.length > 0) {
						// Enhance dev-status PRs with Bitbucket diffstat data
						const enhancedDevStatusPRs: PRMatch[] = [];
						
						if (this.bitbucketClient && this.bitbucketClient.isReady()) {
							for (const pr of devStatusResult.data) {
								try {
									const repoName = pr.repository || repoSlug;
									const enhancedPR = await this.enhancePRWithBitbucketData(pr, repoName);
									enhancedDevStatusPRs.push(enhancedPR);
								} catch (enhanceError) {
									// If enhancement fails, use the original PR
									enhancedDevStatusPRs.push(pr);
								}
							}
						} else {
							// No Bitbucket client available, use original PRs
							enhancedDevStatusPRs.push(...devStatusResult.data);
						}
						
						const result: PRTicketResult = {
							ticketKey,
							pullRequests: enhancedDevStatusPRs
						};
						this.setCache(cacheKey, result);
						return { success: true, data: result, fromCache: false };
					}
					devStatusFound = true; // API exists but found no PRs
				} catch (devStatusError) {
					// Dev-status API not available, will continue with Bitbucket search
				}
			}

			// Fetch remote links from Jira first (highest confidence)
			const remoteLinksResult = await this.checkJiraRemoteLinks(ticketKey);
			const officialPRs: PRMatch[] = remoteLinksResult.success ? remoteLinksResult.data : [];
			const developmentInfo = remoteLinksResult.developmentInfo;

			// If we have development info indicating PRs exist, use targeted search
			const hasPRsFromJira = developmentInfo?.hasPRs || officialPRs.length > 0;
			
			let prResults: any[] = [];
			
			if (hasPRsFromJira) {
				// Development info indicates PRs exist, using targeted search
				
				// Use targeted search when we know PRs exist
				const targetedResults = await this.searchPRsByTicketKey(ticketKey, repoSlug, states);
				if (targetedResults.success && targetedResults.data) {
					prResults = targetedResults.data;
				} else {
					// Fall back to limited search if targeted search fails
					// Targeted search failed, falling back to limited search
					const fallbackResults = await this.fetchLimitedPRs(repoSlug, states, 50);
					if (fallbackResults.success && fallbackResults.data) {
						prResults = fallbackResults.data;
					} else {
						// If everything fails, return official links only
						if (officialPRs.length > 0) {
							const result: PRTicketResult = { ticketKey, pullRequests: officialPRs };
							this.setCache(cacheKey, result);
							return { success: true, data: result, fromCache: false };
						}
						return {
							success: false,
							error: fallbackResults.error || { message: 'No PRs found and fallback failed' },
							fromCache: false
						};
					}
				}
			} else {
				// No PR development info found, doing limited search
				
				// Do limited search when no PRs are expected
				const limitedResults = await this.fetchLimitedPRs(repoSlug, states, 50);
				if (limitedResults.success && limitedResults.data) {
					prResults = limitedResults.data;
				} else {
					return {
						success: false,
						error: limitedResults.error || { message: 'Limited search failed' },
						fromCache: false
					};
				}
			}

			// Analyze each PR for ticket relationships
			const matchedPRs: PRMatch[] = [];
			
			for (const pr of prResults) {
				const match = await this.analyzePRForTicket(pr, ticketKey, repoSlug);
				if (match.confidence > 0) {
					matchedPRs.push(match);
				}
			}

			// Merge official PRs with analyzed matches (remove duplicates, prefer higher confidence)
			const allMatches: PRMatch[] = [...officialPRs];
			
			for (const match of matchedPRs) {
				const existingIndex = allMatches.findIndex(existing => existing.id === match.id);
				if (existingIndex >= 0) {
					// Keep the match with higher confidence
					if (match.confidence > allMatches[existingIndex].confidence) {
						allMatches[existingIndex] = match;
					}
				} else {
					allMatches.push(match);
				}
			}

			// Sort by confidence score (highest first)
			allMatches.sort((a, b) => b.confidence - a.confidence);

			// Enhance all PRs with diffstat data if Bitbucket client is available
			const enhancedMatches: PRMatch[] = [];
			
			if (this.bitbucketClient && this.bitbucketClient.isReady()) {
				for (const match of allMatches) {
					try {
						// Extract repo name from the PR or use the provided repoSlug
						const repoName = match.repository || repoSlug;
						// Debug logging removed for MCP compatibility
						
						const enhancedPR = await this.enhancePRWithBitbucketData(match, repoName);
						
						enhancedMatches.push(enhancedPR);
					} catch (enhanceError) {
						// Enhancement failed, use the original match (logging removed for MCP compatibility)
						enhancedMatches.push(match);
					}
				}
			} else {
				// No Bitbucket client available, use original matches (logging removed for MCP compatibility)
				enhancedMatches.push(...allMatches);
			}

			const result: PRTicketResult = {
				ticketKey,
				pullRequests: enhancedMatches
			};

			this.setCache(cacheKey, result);
			return { success: true, data: result, fromCache: false };

		} catch (error: any) {
			return {
				success: false,
				error: {
					code: 'PR_TICKET_MATCHER_ERROR',
					message: `Failed to find PRs for ticket ${ticketKey}: ${error.message}`
				}
			};
		}
	}

	/**
	 * Find tickets mentioned in a specific PR (reverse lookup)
	 * @param prId - Pull request ID
	 * @param repoSlug - Repository name/slug
	 * @returns Result with ticket matches
	 */
	async findTicketsForPR(prId: number, repoSlug: string): Promise<{ success: boolean; data?: TicketPRResult; error?: any; fromCache?: boolean }> {
		try {
			const cacheKey = `ticket-pr:${prId}:${repoSlug}`;
			
			// Check cache first
			const cached = this.getFromCache(cacheKey);
			if (cached) {
				return { success: true, data: cached, fromCache: true };
			}

			// Fetch PR details
			const prResponse = await this.bitbucketClient.fetchPullRequests(repoSlug, {
				state: 'OPEN,MERGED,DECLINED'
			});

					if (!prResponse.success) {
			return {
				success: false,
				error: prResponse.error,
				fromCache: false
			};
		}

		const pr = prResponse.data?.pullRequests?.find((p: any) => p.id === prId);
		if (!pr) {
			return {
				success: false,
				error: {
					code: 'PR_NOT_FOUND',
					message: `Pull request ${prId} not found in repository ${repoSlug}`
				},
				fromCache: false
			};
		}

			// Extract ticket references from PR
			const ticketMatches = await this.extractTicketReferences(pr, repoSlug);

			const result: TicketPRResult = {
				prId,
				repoSlug,
				tickets: ticketMatches
			};

			this.setCache(cacheKey, result);
			return { success: true, data: result, fromCache: false };

		} catch (error: any) {
			return {
				success: false,
				error: {
					code: 'PR_TICKET_MATCHER_ERROR',
					message: `Failed to find tickets for PR ${prId}: ${error.message}`
				}
			};
		}
	}

	/**
	 * Efficient bulk matching for multiple tickets
	 * @param ticketKeys - Array of Jira ticket keys
	 * @param repoSlug - Repository name/slug
	 * @param options - Additional options
	 * @returns Result with bulk matches
	 */
	async batchMatchTickets(ticketKeys: string[], repoSlug: string, options: BatchMatchOptions = {}): Promise<{ success: boolean; data?: Record<string, PRTicketResult>; error?: any; fromCache?: boolean }> {
		try {
			const { states = ['OPEN', 'MERGED'], maxResults = 200 } = options;
			
			// Fetch all PRs once for efficiency
			const allPRs: any[] = [];
			let page = 1;
			let totalFetched = 0;

			while (totalFetched < maxResults) {
				const pageSize = Math.min(50, maxResults - totalFetched);
				
				for (const state of states) {
					const prResponse = await this.bitbucketClient.fetchPullRequests(repoSlug, {
						state,
						page,
						pagelen: pageSize
					});

					if (!prResponse.success) {
						return prResponse;
					}

					allPRs.push(...prResponse.data.pullRequests);
					totalFetched += prResponse.data.pullRequests.length;

					if (!prResponse.data.pagination.next) {
						break;
					}
				}

				page++;
				if (totalFetched >= maxResults) {
					break;
				}
			}

			// Analyze each ticket against all PRs
			const results: Record<string, PRTicketResult> = {};
			
			for (const ticketKey of ticketKeys) {
				const matchedPRs: PRMatch[] = [];
				
				// Check official Jira links first
				const remoteLinksResult = await this.checkJiraRemoteLinks(ticketKey);
				if (remoteLinksResult.success) {
					matchedPRs.push(...remoteLinksResult.data);
				}

				// Analyze PRs for this ticket
				for (const pr of allPRs) {
					const match = await this.analyzePRForTicket(pr, ticketKey, repoSlug);
					if (match.confidence > 0) {
						// Check for duplicates with official links
						const existingIndex = matchedPRs.findIndex(existing => existing.id === match.id);
						if (existingIndex >= 0) {
							if (match.confidence > matchedPRs[existingIndex].confidence) {
								matchedPRs[existingIndex] = match;
							}
						} else {
							matchedPRs.push(match);
						}
					}
				}

				// Sort by confidence
				matchedPRs.sort((a, b) => b.confidence - a.confidence);
				
				results[ticketKey] = {
					ticketKey,
					pullRequests: matchedPRs
				};
			}

			return { success: true, data: results, fromCache: false };

		} catch (error: any) {
			return {
				success: false,
				error: {
					code: 'PR_TICKET_MATCHER_ERROR',
					message: `Failed to batch match tickets: ${error.message}`
				}
			};
		}
	}

	/**
	 * Analyze a single PR for relationship to a specific ticket
	 * @param pr - Pull request object from Bitbucket API
	 * @param ticketKey - Jira ticket key
	 * @param repoSlug - Repository name/slug
	 * @returns PR object with confidence score and match sources
	 */
	async analyzePRForTicket(pr: any, ticketKey: string, repoSlug: string | null): Promise<PRMatch> {
		const matchSources: string[] = [];
		let confidence = 0;

		// Analyze branch name
		const branchScore = this.analyzeBranchName(pr.source?.branch?.name || '', ticketKey);
		if (branchScore > 0) {
			confidence = Math.max(confidence, branchScore);
			matchSources.push('branch-name');
		}

		// Analyze PR title
		const titleScore = this.analyzeText(pr.title || '', ticketKey);
		if (titleScore > 0) {
			confidence = Math.max(confidence, titleScore);
			matchSources.push('pr-title');
		}

		// Analyze PR description
		const descScore = this.analyzeText(pr.description || '', ticketKey);
		if (descScore > 0) {
			confidence = Math.max(confidence, Math.min(descScore, CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE));
			matchSources.push('pr-description');
		}

		// Analyze commit messages
		const commitScore = await this.analyzeCommitMessages(pr, ticketKey, repoSlug);
		if (commitScore > 0) {
			confidence = Math.max(confidence, commitScore);
			matchSources.push('commit-message');
		}

		// Return enhanced PR object if there's a match
		if (confidence > 0) {
			return {
				id: pr.id,
				title: pr.title,
				status: pr.state,
				url: pr.links?.html?.href || `https://bitbucket.org/${this.bitbucketClient.config.workspace}/${repoSlug}/pull-requests/${pr.id}`,
				branch: pr.source?.branch?.name,
				commits: pr.commit_count || 0,
				filesChanged: pr.diff_stats?.files_changed || 0,
				createdDate: pr.created_on,
				updatedDate: pr.updated_on,
				author: pr.author?.display_name || pr.author?.nickname,
				confidence,
				matchSources
			};
		}

		return { confidence: 0 } as PRMatch;
	}

	/**
	 * Extract ticket references from a PR (title, description, commits)
	 * @param pr - Pull request object
	 * @param repoSlug - Repository name/slug
	 * @returns Array of ticket matches with confidence scores
	 */
	async extractTicketReferences(pr: any, repoSlug: string): Promise<TicketMatch[]> {
		const tickets = new Map<string, TicketMatch>(); // Use Map to avoid duplicates

		// Extract from PR title
		const titleTickets = this.extractTicketsFromText(pr.title || '');
		titleTickets.forEach(ticket => {
			tickets.set(ticket, {
				ticketKey: ticket,
				confidence: CONFIDENCE_THRESHOLDS.COMMIT_TITLE,
				sources: ['pr-title']
			});
		});

		// Extract from PR description
		const descTickets = this.extractTicketsFromText(pr.description || '');
		descTickets.forEach(ticket => {
			if (tickets.has(ticket)) {
				tickets.get(ticket)!.sources.push('pr-description');
			} else {
				tickets.set(ticket, {
					ticketKey: ticket,
					confidence: CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE,
					sources: ['pr-description']
				});
			}
		});

		// Extract from branch name
		const branchTickets = this.extractTicketsFromBranch(pr.source?.branch?.name || '');
		branchTickets.forEach(ticket => {
			if (tickets.has(ticket)) {
				tickets.get(ticket)!.confidence = Math.max(
					tickets.get(ticket)!.confidence,
					CONFIDENCE_THRESHOLDS.BRANCH_PATTERN
				);
				tickets.get(ticket)!.sources.push('branch-name');
			} else {
				tickets.set(ticket, {
					ticketKey: ticket,
					confidence: CONFIDENCE_THRESHOLDS.BRANCH_PATTERN,
					sources: ['branch-name']
				});
			}
		});

		// Extract from commits
		const commitTickets = await this.extractTicketsFromCommits(pr, repoSlug);
		commitTickets.forEach(ticket => {
			if (tickets.has(ticket.ticketKey)) {
				tickets.get(ticket.ticketKey)!.confidence = Math.max(
					tickets.get(ticket.ticketKey)!.confidence,
					ticket.confidence
				);
				if (!tickets.get(ticket.ticketKey)!.sources.includes('commit-message')) {
					tickets.get(ticket.ticketKey)!.sources.push('commit-message');
				}
			} else {
				tickets.set(ticket.ticketKey, ticket);
			}
		});

		return Array.from(tickets.values());
	}

	/**
	 * Analyze commit messages for ticket references
	 * @param pr - Pull request object
	 * @param ticketKey - Jira ticket key to look for
	 * @param repoSlug - Repository name/slug
	 * @returns Confidence score (0-100)
	 */
	async analyzeCommitMessages(pr: any, ticketKey: string, repoSlug: string | null): Promise<number> {
		try {
			if (!repoSlug) return 0;
			
			const commitsResponse = await this.bitbucketClient.fetchPRCommits(repoSlug, pr.id);
			
			if (!commitsResponse.success) {
				return 0;
			}

			const commits = commitsResponse.data.commits || [];
			let maxScore = 0;

			for (const commit of commits) {
				const message = commit.message || '';
				const score = this.analyzeText(message, ticketKey);
				maxScore = Math.max(maxScore, score);
			}

			return maxScore;

		} catch (error) {
			// If commit fetching fails, don't fail the entire analysis
			return 0;
		}
	}

	/**
	 * Extract ticket references from commit messages
	 * @param pr - Pull request object
	 * @param repoSlug - Repository name/slug
	 * @returns Array of ticket matches from commits
	 */
	async extractTicketsFromCommits(pr: any, repoSlug: string): Promise<TicketMatch[]> {
		try {
			const commitsResponse = await this.bitbucketClient.fetchPRCommits(repoSlug, pr.id);
			
			if (!commitsResponse.success) {
				return [];
			}

			const commits = commitsResponse.data.commits || [];
			const tickets = new Map<string, TicketMatch>();

			for (const commit of commits) {
				const message = commit.message || '';
				const commitTickets = this.extractTicketsFromText(message);
				
				commitTickets.forEach(ticket => {
					if (tickets.has(ticket)) {
						// Keep highest confidence
						tickets.get(ticket)!.confidence = Math.max(
							tickets.get(ticket)!.confidence,
							CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE
						);
					} else {
						tickets.set(ticket, {
							ticketKey: ticket,
							confidence: CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE,
							sources: ['commit-message']
						});
					}
				});
			}

			return Array.from(tickets.values());

		} catch (error) {
			return [];
		}
	}

	/**
	 * Analyze branch name for ticket reference
	 * @param branchName - Branch name to analyze
	 * @param ticketKey - Jira ticket key to look for
	 * @returns Confidence score (0-100)
	 */
	analyzeBranchName(branchName: string, ticketKey: string): number {
		if (!branchName || !ticketKey) {
			return 0;
		}

		const upperBranch = branchName.toUpperCase();
		const upperTicket = ticketKey.toUpperCase();

		// Check for exact patterns (case insensitive)
		for (const pattern of BRANCH_PATTERNS) {
			const match = upperBranch.match(pattern);
			if (match && match[1] === upperTicket) {
				return CONFIDENCE_THRESHOLDS.EXACT_BRANCH;
			}
		}

		// Check for ticket anywhere in branch name
		if (upperBranch.includes(upperTicket)) {
			return CONFIDENCE_THRESHOLDS.BRANCH_PATTERN;
		}

		return 0;
	}

	/**
	 * Analyze text (commit message, PR title, etc.) for ticket reference
	 * @param text - Text to analyze
	 * @param ticketKey - Jira ticket key to look for
	 * @returns Confidence score (0-100)
	 */
	analyzeText(text: string, ticketKey: string): number {
		if (!text || !ticketKey) {
			return 0;
		}

		const upperText = text.toUpperCase();
		const upperTicket = ticketKey.toUpperCase();

		// Check for structured patterns (highest confidence) - case insensitive
		// Skip the last pattern which is for extraction only
		for (let i = 0; i < TICKET_PATTERNS.length - 1; i++) {
			const pattern = TICKET_PATTERNS[i];
			const match = upperText.match(pattern);
			if (match && match[1] === upperTicket) {
				// Higher confidence for patterns at the start
				if (pattern.source.includes('^')) {
					return CONFIDENCE_THRESHOLDS.COMMIT_TITLE;
				}
				return CONFIDENCE_THRESHOLDS.COMMIT_MESSAGE;
			}
		}

		// Check for ticket anywhere in text (lower confidence)
		if (upperText.includes(upperTicket)) {
			return CONFIDENCE_THRESHOLDS.PARTIAL_MATCH;
		}

		return 0;
	}

	/**
	 * Extract all ticket references from text
	 * @param text - Text to analyze
	 * @returns Array of ticket keys found
	 */
	extractTicketsFromText(text: string): string[] {
		if (!text) {
			return [];
		}

		const tickets = new Set<string>();

		// Use all patterns to find tickets
		for (const pattern of TICKET_PATTERNS) {
			const matches = text.matchAll(new RegExp(pattern, 'g'));
			for (const match of matches) {
				if (match[1]) {
					tickets.add(match[1].toUpperCase());
				}
			}
		}

		return Array.from(tickets);
	}

	/**
	 * Extract ticket references from branch name
	 * @param branchName - Branch name to analyze
	 * @returns Array of ticket keys found
	 */
	extractTicketsFromBranch(branchName: string): string[] {
		if (!branchName) {
			return [];
		}

		const tickets = new Set<string>();

		// Use branch-specific patterns
		for (const pattern of BRANCH_PATTERNS) {
			const match = branchName.match(pattern);
			if (match && match[1]) {
				tickets.add(match[1].toUpperCase());
			}
		}

		return Array.from(tickets);
	}

	/**
	 * Cache management methods
	 */
	private getFromCache(key: string): any {
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
			return cached.data;
		}
		this.cache.delete(key);
		return null;
	}

	private setCache(key: string, data: any): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now()
		});
	}

	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Check Jira remote links and development custom field for official Bitbucket-Jira connections
	 * @param ticketKey - Jira ticket key
	 * @returns Result with official PR links and development info
	 */
	async checkJiraRemoteLinks(ticketKey: string): Promise<RemoteLinksResult> {
		const bitbucketPRs: PRMatch[] = [];
		let developmentInfo: DevelopmentInfo = { hasPRs: false, prCount: 0, hasCommits: false, commitCount: 0 };
		
		try {
			// First, check traditional remote links
			const remoteLinksResult = await this.jiraClient.fetchRemoteLinks(ticketKey);
			
			if (remoteLinksResult.success) {
				const remoteLinks = remoteLinksResult.data || [];

				for (const link of remoteLinks) {
					const url = link.object?.url || '';
					
					// Check if this is a Bitbucket PR URL
					const prMatch = url.match(/bitbucket\.org\/([^\/]+)\/([^\/]+)\/pull-requests\/(\d+)/);
					if (prMatch) {
						const [, workspace, repo, prId] = prMatch;
						
						bitbucketPRs.push({
							id: parseInt(prId, 10),
							title: link.object?.title || `PR #${prId}`,
							status: 'UNKNOWN', // We'd need to fetch from Bitbucket to get status
							url: url,
							branch: 'unknown',
							commits: 0,
							filesChanged: 0,
							createdDate: null,
							updatedDate: null,
							author: null,
							confidence: CONFIDENCE_THRESHOLDS.OFFICIAL_LINK,
							matchSources: ['jira-link']
						});
					}
				}
			}
		} catch (remoteLinksError) {
			// Remote links failed, continue with development field
		}
		
		try {
			// Second, check development custom field (customfield_10000)
			const client = this.jiraClient.getClient();
			const rawResponse = await client.get(`/rest/api/3/issue/${ticketKey}`);
			const rawIssue = rawResponse.data;
			
			if (rawIssue.fields.customfield_10000) {
				const devFieldStr = rawIssue.fields.customfield_10000;
				
				// Parse the development field JSON
				const jsonStart = devFieldStr.indexOf('json=') + 5;
				if (jsonStart > 4) {
					const jsonPart = devFieldStr.substring(jsonStart);
					
					// Find the end of the JSON object by counting braces
					let braceCount = 0;
					let jsonEnd = 0;
					for (let i = 0; i < jsonPart.length; i++) {
						if (jsonPart[i] === '{') braceCount++;
						if (jsonPart[i] === '}') braceCount--;
						if (braceCount === 0 && jsonPart[i] === '}') {
							jsonEnd = i + 1;
							break;
						}
					}
					
					if (jsonEnd > 0) {
						const jsonStr = jsonPart.substring(0, jsonEnd);
						const parsedDevInfo = JSON.parse(jsonStr);
						
						if (parsedDevInfo.cachedValue?.summary?.pullrequest) {
							const prSummary = parsedDevInfo.cachedValue.summary.pullrequest;
							
							// Update development info with PR information
							developmentInfo = {
								hasPRs: prSummary.overall?.count > 0,
								prCount: prSummary.overall?.count || 0,
								prState: prSummary.overall?.state,
								lastUpdated: prSummary.overall?.lastUpdated,
								sources: Object.keys(prSummary.byInstanceType || {})
							};
						}
					}
				}
			}
		} catch (devError) {
			// Development field parsing failed, continue with remote links only
		}

		return { success: true, data: bitbucketPRs, developmentInfo };
	}

	/**
	 * Get PR and commit information from Jira's official dev-status API
	 * @param ticketKey - Jira ticket key
	 * @returns Result with PR data from dev-status API
	 */
	async getJiraDevStatus(ticketKey: string): Promise<{ success: boolean; data?: PRMatch[]; error?: any; developmentInfo?: DevelopmentInfo }> {
		try {
			const client = this.jiraClient.getClient();
			
			// First get the issue ID
			const issueResponse = await client.get(`/rest/api/3/issue/${ticketKey}`);
			const issueId = issueResponse.data.id;

			const prMatches: PRMatch[] = [];
			let developmentInfo: DevelopmentInfo = { hasPRs: false, prCount: 0, hasCommits: false, commitCount: 0 };

			// Try to get pull request details
			try {
				const prResponse = await client.get(`/rest/dev-status/latest/issue/detail?issueId=${issueId}&applicationType=bitbucket&dataType=pullrequest`);
				
				if (prResponse.data && prResponse.data.detail && prResponse.data.detail.length > 0) {
					for (const detail of prResponse.data.detail) {
						if (detail.pullRequests && detail.pullRequests.length > 0) {
							developmentInfo.hasPRs = true;
							developmentInfo.prCount += detail.pullRequests.length;

							for (const pr of detail.pullRequests) {
								const prMatch: PRMatch = {
									id: pr.id,
									title: pr.name,
									url: pr.url,
									status: pr.status,
									author: pr.author?.name,
									sourceBranch: pr.source?.branch,
									destinationBranch: pr.destination?.branch,
									repository: pr.repositoryName,
									repositoryUrl: pr.repositoryUrl,
									created: pr.created,
									updated: pr.lastUpdate,
									commentCount: pr.commentCount,
									reviewers: pr.reviewers || [],
									confidence: CONFIDENCE_THRESHOLDS.OFFICIAL_LINK,
									source: 'jira_dev_status_api',
									matchSources: ['jira-dev-status']
								};
								
								// Enhance with detailed Bitbucket data if available
								if (this.bitbucketClient && this.bitbucketClient.isReady()) {
									try {
										const enhancedPR = await this.enhancePRWithBitbucketData(prMatch, pr.repositoryName);
										prMatches.push(enhancedPR);
									} catch (enhanceError) {
										// If enhancement fails, use the basic PR data
										prMatches.push(prMatch);
									}
								} else {
									prMatches.push(prMatch);
								}
							}
						}
					}
				}
			} catch (prError) {
				// Dev-status PR API failed, continue without official links
			}

			return {
				success: true,
				data: prMatches,
				developmentInfo
			};

		} catch (error: any) {
			// If dev-status API is not available (404), return empty result instead of error
			if (error.response?.status === 404) {
				return {
					success: true,
					data: [],
					developmentInfo: { hasPRs: false, prCount: 0, hasCommits: false, commitCount: 0 }
				};
			}
			
			return {
				success: false,
				error: {
					code: 'JIRA_DEV_STATUS_ERROR',
					message: `Failed to get dev-status for ${ticketKey}: ${error.message}`
				}
			};
		}
	}

	/**
	 * Search for PRs by ticket key using targeted approach
	 * @param ticketKey - Jira ticket key
	 * @param repoSlug - Repository slug
	 * @param states - PR states to search
	 * @returns Search results
	 */
	async searchPRsByTicketKey(ticketKey: string, repoSlug: string | null, states: string[] = ['MERGED', 'OPEN']): Promise<{ success: boolean; data?: PRMatch[]; error?: any }> {
		try {
			if (!repoSlug) {
				return { success: false, error: { message: 'Repository slug is required for targeted search' } };
			}

			const matchingPRs: any[] = [];
			
			// Search through a limited number of recent PRs looking for ticket key matches
			// This is much more efficient than fetching all PRs
			for (const state of states) {
				const prResponse = await this.bitbucketClient.fetchPullRequests(repoSlug, {
					state,
					page: 1,
					pagelen: 50 // Only check recent 50 PRs per state
				});

				if (!prResponse.success) {
					continue; // Skip this state if it fails
				}

				// Filter PRs that match the ticket key
				const prsForState = prResponse.data.pullRequests.filter((pr: any) => {
					// Check if ticket key appears in PR title, description, or branch name
					const title = (pr.title || '').toUpperCase();
					const description = (pr.description || '').toUpperCase();
					const sourceBranch = (pr.source?.branch?.name || '').toUpperCase();
					const destinationBranch = (pr.destination?.branch?.name || '').toUpperCase();
					
					const ticketKeyUpper = ticketKey.toUpperCase();
					
					// More flexible matching - handle different formats
					const ticketParts = ticketKeyUpper.split('-');
					const projectKey = ticketParts[0]; // e.g., "GROOT"
					const ticketNumber = ticketParts[1]; // e.g., "286"
					
					// Check for exact ticket key
					const exactMatch = title.includes(ticketKeyUpper) ||
														description.includes(ticketKeyUpper) ||
														sourceBranch.includes(ticketKeyUpper) ||
														destinationBranch.includes(ticketKeyUpper);
					
					// Check for flexible formats like "groot-286", "groot_286", etc.
					const flexibleFormats = [
						`${projectKey}-${ticketNumber}`,
						`${projectKey}_${ticketNumber}`,
						`${projectKey}${ticketNumber}`,
						`${projectKey.toLowerCase()}-${ticketNumber}`,
						`${projectKey.toLowerCase()}_${ticketNumber}`,
						`${projectKey.toLowerCase()}${ticketNumber}`
					];
					
					const flexibleMatch = flexibleFormats.some(format => 
						title.includes(format.toUpperCase()) ||
						description.includes(format.toUpperCase()) ||
						sourceBranch.includes(format.toUpperCase()) ||
						destinationBranch.includes(format.toUpperCase())
					);
					
					return exactMatch || flexibleMatch;
				});

				matchingPRs.push(...prsForState);
			}

			return { success: true, data: matchingPRs };
		} catch (error: any) {
			return {
				success: false,
				error: {
					code: 'TARGETED_SEARCH_ERROR',
					message: `Targeted PR search failed: ${error.message}`
				}
			};
		}
	}

	/**
	 * Fetch a limited number of PRs for fallback scenarios
	 * @param repoSlug - Repository slug
	 * @param states - PR states to search
	 * @param limit - Maximum number of PRs to fetch
	 * @returns Limited PR results
	 */
	async fetchLimitedPRs(repoSlug: string | null, states: string[] = ['MERGED', 'OPEN'], limit: number = 50): Promise<{ success: boolean; data?: PRMatch[]; error?: any }> {
		try {
			if (!repoSlug) {
				return { success: false, error: { message: 'Repository slug is required' } };
			}

			const prResults: any[] = [];
			let totalFetched = 0;

			for (const state of states) {
				if (totalFetched >= limit) break;

				const pageSize = Math.min(25, limit - totalFetched);
				const prResponse = await this.bitbucketClient.fetchPullRequests(repoSlug, {
					state,
					page: 1,
					pagelen: pageSize
				});

				if (!prResponse.success) {
					continue; // Skip this state if it fails
				}

				prResults.push(...prResponse.data.pullRequests);
				totalFetched += prResponse.data.pullRequests.length;
			}

			return { success: true, data: prResults };
		} catch (error: any) {
			return {
				success: false,
				error: {
					code: 'LIMITED_FETCH_ERROR',
					message: `Limited PR fetch failed: ${error.message}`
				}
			};
		}
	}

	/**
	 * Enhance a PR object with detailed data from Bitbucket API
	 * @param prMatch - Basic PR object from Jira dev-status
	 * @param repositoryName - Repository name
	 * @returns Enhanced PR object with description, files, and diffstat
	 */
	async enhancePRWithBitbucketData(prMatch: PRMatch, repositoryName: string | null): Promise<PRMatch> {
		try {
			if (!repositoryName || !prMatch.id) {
				return prMatch;
			}

			// Extract repository name from full name if needed
			const repoName = repositoryName && repositoryName.includes('/') 
				? repositoryName.split('/')[1] 
				: repositoryName || 'unknown';
			
			// Skip enhancement if we don't have a valid repo name or PR ID
			if (!repoName || repoName === 'unknown') {
				return prMatch;
			}

			// Fetch detailed PR data from Bitbucket
			const client = this.bitbucketClient.getClient();
			const workspace = this.bitbucketClient.config.workspace;
			
			const prDetailResponse = await client.get(
				`/repositories/${workspace}/${repoName}/pullrequests/${prMatch.id}`
			);
			
			if (prDetailResponse.data) {
				const prDetail = prDetailResponse.data;
				
				// Create enhanced PR object with all the detailed data
				const enhancedPR: PRMatch = {
					...prMatch,
					description: prDetail.description || '',
					state: prDetail.state || prMatch.status,
					created: prDetail.created_on || prMatch.created,
					updated: prDetail.updated_on || prMatch.updated,
					mergeCommit: prDetail.merge_commit?.hash,
					commentCount: prDetail.comment_count || 0,
					taskCount: prDetail.task_count || 0,
					commits: prMatch.commits || 0,
					filesChanged: [],
					diffStat: {
						totalFiles: 0,
						linesAdded: 0,
						linesRemoved: 0
					}
				};

				return enhancedPR;
			}
			
			return prMatch;
		} catch (error) {
			// Failed to enhance PR with Bitbucket data
			return prMatch;
		}
	}
} 