/**
 * bitbucket-client.ts
 *
 * Class for interacting with Bitbucket API. Encapsulates authentication, requests,
 * and provides methods for Bitbucket operations including pull requests and commits.
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { Logger } from '../../types/jira';

// Type definitions for Bitbucket API
export interface BitbucketConfig {
	workspace: string;
	username: string;
	apiToken: string;
}

export interface BitbucketValidationResult {
	success: boolean;
	missingFields: string[];
}

export interface BitbucketErrorResponse {
	success: false;
	error: {
		code: string;
		message: string;
		status?: number;
		originalError?: string;
		[key: string]: any;
	};
}

export interface BitbucketSuccessResponse<T = any> {
	success: true;
	data: T;
	message?: string;
}

export type BitbucketResponse<T = any> = BitbucketSuccessResponse<T> | BitbucketErrorResponse;

export interface PullRequestOptions {
	state?: string;
	page?: number;
	pagelen?: number;
}

export interface CommitOptions {
	page?: number;
	pagelen?: number;
}

export interface PaginationInfo {
	page: number;
	size: number;
	pagelen: number;
	next: string | null;
}

export interface PullRequestsData {
	pullRequests: any[];
	pagination: PaginationInfo;
}

export interface DiffStatData {
	diffStat: any[];
	totalFiles: number;
}

export interface CommitsData {
	commits: any[];
	pagination: PaginationInfo;
}

/**
 * BitbucketClient class for interacting with Bitbucket API
 */
export class BitbucketClient {
	public config: BitbucketConfig;
	public enabled: boolean;
	public client: AxiosInstance | null;
	public error?: string;

	/**
	 * Create a new BitbucketClient instance
	 * @param config - Optional Bitbucket configuration to override environment variables
	 */
	constructor(config?: Partial<BitbucketConfig>) {
		this.config = config as BitbucketConfig;
		
		// Check if configuration has all required fields
		this.enabled = !!(this.config.workspace && this.config.username && this.config.apiToken);

		if (this.enabled) {
			try {
				this.client = this.createClient(this.config);
			} catch (error: any) {
				this.client = null;
				this.error = error.message;
			}
		} else {
			this.client = null;
		}
	}

	/**
	 * Create an authenticated Axios instance for Bitbucket API requests
	 * @param config - Bitbucket configuration
	 * @returns Axios instance configured for Bitbucket
	 */
	createClient(config: BitbucketConfig): AxiosInstance {
		const { username, apiToken } = config;

		if (!username || !apiToken) {
			throw new Error(
				'Missing required Bitbucket API configuration. Please set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN environment variables.'
			);
		}

		// Create Basic Auth header manually - axios auth object doesn't work properly with Bitbucket API tokens
		const basicAuth = Buffer.from(`${username}:${apiToken}`).toString('base64');

		return axios.create({
			baseURL: 'https://api.bitbucket.org/2.0',
			headers: {
				'Authorization': `Basic ${basicAuth}`,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			timeout: 10000 // 10 second timeout
		});
	}

	/**
	 * Validates the current Bitbucket configuration
	 * @param log - Logger object
	 * @returns Validation result with success flag and error message if invalid
	 */
	validateConfig(log?: Logger): BitbucketValidationResult {
		const result: BitbucketValidationResult = {
			success: true,
			missingFields: []
		};

		// Check required fields
		if (!this.config.workspace) {
			result.success = false;
			result.missingFields.push('workspace');
		}

		if (!this.config.username) {
			result.success = false;
			result.missingFields.push('username');
		}

		if (!this.config.apiToken) {
			result.success = false;
			result.missingFields.push('apiToken');
		}

		// Log validation result if a logger is provided
		if (log && !result.success) {
			log.error(
				`Bitbucket configuration validation failed. Missing fields: ${result.missingFields.join(', ')}`
			);
			log.error(
				'Please set the following environment variables or configuration values:'
			);
			if (result.missingFields.includes('workspace')) {
				log.error(
					'- BITBUCKET_WORKSPACE: Your Bitbucket workspace name'
				);
			}
			if (result.missingFields.includes('username')) {
				log.error(
					'- BITBUCKET_EMAIL: Your Bitbucket username'
				);
			}
			if (result.missingFields.includes('apiToken')) {
				log.error(
					'- BITBUCKET_API_TOKEN: Universal API token from your Atlassian account'
				);
			}
		}

		return result;
	}

	/**
	 * Get the initialized Bitbucket API client or throw an error if not available
	 * @returns Axios Bitbucket client instance
	 * @throws If Bitbucket is not enabled or client failed to initialize
	 */
	getClient(): AxiosInstance {
		if (!this.enabled) {
			throw new Error(
				'Bitbucket integration is not enabled. Please configure the required environment variables.'
			);
		}

		if (!this.client) {
			throw new Error(
				`Bitbucket client initialization failed: ${this.error || 'Unknown error'}`
			);
		}

		return this.client;
	}

	/**
	 * Check if Bitbucket integration is enabled and client is ready
	 * @returns True if Bitbucket client is ready to use
	 */
	isReady(): boolean {
		return this.enabled && !!this.client;
	}

	/**
	 * Standard error response generator for Bitbucket operations
	 * @param code - Error code
	 * @param message - Error message
	 * @param details - Additional error details
	 * @returns Standard error response object
	 */
	createErrorResponse(code: string, message: string, details: Record<string, any> | null = null): BitbucketErrorResponse {
		return {
			success: false,
			error: {
				code,
				message,
				...(details || {})
			}
		};
	}

	/**
	 * Fetch pull requests for a repository
	 * @param repoSlug - Repository name/slug
	 * @param options - Additional options for the request
	 * @returns Pull requests data or error response
	 */
	async fetchPullRequests(repoSlug: string, options: PullRequestOptions = {}): Promise<BitbucketResponse<PullRequestsData>> {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			const { workspace } = this.config;
			const { state, page = 1, pagelen = 50 } = options;

			// Build query parameters
			const params: Record<string, any> = { page, pagelen };
			if (state) {
				params.state = state;
			}

			const response: AxiosResponse = await client.get(
				`/repositories/${workspace}/${repoSlug}/pullrequests`,
				{ params }
			);

			return {
				success: true,
				data: {
					pullRequests: response.data.values || [],
					pagination: {
						page: response.data.page || 1,
						size: response.data.size || 0,
						pagelen: response.data.pagelen || 50,
						next: response.data.next || null
					}
				}
			};
		} catch (error: any) {
			if (error.response?.status === 401) {
				return this.createErrorResponse(
					'BITBUCKET_AUTH_ERROR',
					'Authentication failed. Please check your Bitbucket credentials.',
					{ status: error.response.status }
				);
			}

			if (error.response?.status === 404) {
				return this.createErrorResponse(
					'BITBUCKET_REPO_NOT_FOUND',
					`Repository ${repoSlug} not found in workspace ${this.config.workspace}`,
					{ status: error.response.status }
				);
			}

			if (error.response?.status === 429) {
				return this.createErrorResponse(
					'BITBUCKET_RATE_LIMIT',
					'Rate limit exceeded. Please try again later.',
					{ status: error.response.status }
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_REQUEST_ERROR',
				`Failed to fetch pull requests: ${error.message}`,
				{ originalError: error.message }
			);
		}
	}

	/**
	 * Fetch diff statistics for a pull request
	 * @param repoSlug - Repository name/slug
	 * @param prId - Pull request ID
	 * @param options - Additional options for the request
	 * @returns Diff statistics or error response
	 */
	async fetchPRDiffStat(repoSlug: string, prId: number, options: Record<string, any> = {}): Promise<BitbucketResponse<DiffStatData>> {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			const { workspace } = this.config;

			const response: AxiosResponse = await client.get(
				`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diffstat`
			);

			return {
				success: true,
				data: {
					diffStat: response.data.values || [],
					totalFiles: response.data.size || 0
				}
			};
		} catch (error: any) {
			if (error.response?.status === 404) {
				return this.createErrorResponse(
					'BITBUCKET_PR_NOT_FOUND',
					`Pull request ${prId} not found in repository ${repoSlug}`,
					{ status: error.response.status }
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_REQUEST_ERROR',
				`Failed to fetch PR diff statistics: ${error.message}`,
				{ originalError: error.message }
			);
		}
	}

	/**
	 * Fetch commits for a pull request
	 * @param repoSlug - Repository name/slug
	 * @param prId - Pull request ID
	 * @param options - Additional options for the request
	 * @returns PR commits or error response
	 */
	async fetchPRCommits(repoSlug: string, prId: number, options: CommitOptions = {}): Promise<BitbucketResponse<CommitsData>> {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			const { workspace } = this.config;
			const { page = 1, pagelen = 50 } = options;

			const response: AxiosResponse = await client.get(
				`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/commits`,
				{ params: { page, pagelen } }
			);

			return {
				success: true,
				data: {
					commits: response.data.values || [],
					pagination: {
						page: response.data.page || 1,
						size: response.data.size || 0,
						pagelen: response.data.pagelen || 50,
						next: response.data.next || null
					}
				}
			};
		} catch (error: any) {
			if (error.response?.status === 404) {
				return this.createErrorResponse(
					'BITBUCKET_PR_NOT_FOUND',
					`Pull request ${prId} not found in repository ${repoSlug}`,
					{ status: error.response.status }
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_REQUEST_ERROR',
				`Failed to fetch PR commits: ${error.message}`,
				{ originalError: error.message }
			);
		}
	}

	/**
	 * Test the Bitbucket connection by making a simple API call
	 * @returns Connection test result
	 */
	async testConnection(): Promise<BitbucketResponse<{ message: string }>> {
		try {
			if (!this.isReady()) {
				return this.createErrorResponse(
					'BITBUCKET_NOT_ENABLED',
					'Bitbucket client is not enabled or ready'
				);
			}

			const client = this.getClient();
			
			// Test with a simple user info call
			await client.get('/user');

			return {
				success: true,
				data: { message: 'Bitbucket connection successful' },
				message: 'Bitbucket connection successful'
			};
		} catch (error: any) {
			if (error.response?.status === 401) {
				return this.createErrorResponse(
					'BITBUCKET_AUTH_ERROR',
					'Authentication failed. Please check your Bitbucket credentials.'
				);
			}

			return this.createErrorResponse(
				'BITBUCKET_CONNECTION_ERROR',
				`Connection test failed: ${error.message}`
			);
		}
	}
} 