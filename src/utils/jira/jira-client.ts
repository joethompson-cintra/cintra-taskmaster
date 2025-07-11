/**
 * jira-client.ts
 *
 * Class for interacting with Jira API. Encapsulates authentication, requests,
 * and provides methods for Jira operations.
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { JiraTicket } from './jira-ticket';
import { compressImageIfNeeded } from './jira-utils';
import { 
    JiraConfig, 
    JiraResponse, 
    JiraErrorResponse, 
    JiraSuccessResponse,
    JiraValidationResult,
    JiraIssue,
    JiraSearchResult,
    JiraTransition,
    JiraComment,
    JiraRemoteLink,
    FetchOptions,
    SearchOptions,
    CreateOptions,
    UpdateOptions,
    TransitionOptions,
    AttachmentResponse,
    Logger
} from '../../types/jira.js';

interface DefaultLoggerImpl {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
}

const defaultLogger: DefaultLoggerImpl = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
};

/**
 * JiraClient class for interacting with Jira API
 */
export class JiraClient {
    public config: JiraConfig;
    public enabled: boolean;
    public client: AxiosInstance | null;
    public error?: string;

    /**
     * Create a new JiraClient instance
     * @param config - Optional Jira configuration to override environment variables
     */
    constructor(config?: Partial<JiraConfig>) {
        this.config = config ? config as JiraConfig : JiraClient.getJiraConfig();
        
        // Check if configuration has all required fields
        this.enabled = !!(this.config.baseUrl && this.config.email && this.config.apiToken && this.config.project);

        if (this.enabled) {
            try {
                this.client = this.createJiraClient(this.config);
            } catch (error) {
                this.client = null;
                this.error = (error as Error).message;
            }
        } else {
            this.client = null;
        }
    }

    /**
     * Get Jira API configuration from environment variables or CONFIG
     * @returns Jira API configuration
     */
    static getJiraConfig(): JiraConfig {
        return {
            baseUrl: process.env.JIRA_API_URL || '',
            email: process.env.JIRA_EMAIL || '',
            apiToken: process.env.JIRA_API_TOKEN || '',
            project: process.env.JIRA_PROJECT || ''
        };
    }



    /**
     * Create an authenticated Axios instance for Jira API requests
     * @param config - Jira configuration
     * @returns Axios instance configured for Jira
     */
    createJiraClient(config: JiraConfig): AxiosInstance {
        const { baseUrl, email, apiToken } = config;

        if (!baseUrl || !email || !apiToken) {
            throw new Error(
                'Missing required Jira API configuration. Please set JIRA_API_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.'
            );
        }

        return axios.create({
            baseURL: baseUrl,
            auth: {
                username: email,
                password: apiToken
            },
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            }
        });
    }

    /**
     * Validates the current Jira configuration
     * @param log - Logger object
     * @returns Validation result with success flag and error message if invalid
     */
    validateConfig(log?: Logger): JiraValidationResult {
        const result: JiraValidationResult = {
            success: true,
            missingFields: []
        };

        // Check required fields
        if (!this.config.baseUrl) {
            result.success = false;
            result.missingFields.push('baseUrl');
        }

        if (!this.config.email) {
            result.success = false;
            result.missingFields.push('email');
        }

        if (!this.config.apiToken) {
            result.success = false;
            result.missingFields.push('apiToken');
        }

        if (!this.config.project) {
            result.success = false;
            result.missingFields.push('project');
        }

        // Log validation result if a logger is provided
        if (log && !result.success) {
            log.error(
                `Jira configuration validation failed. Missing fields: ${result.missingFields.join(', ')}`
            );
            log.error(
                'Please set the following environment variables or configuration values:'
            );
            if (result.missingFields.includes('baseUrl')) {
                log.error(
                    '- JIRA_API_URL: Your Jira instance URL (e.g., "https://your-domain.atlassian.net")'
                );
            }
            if (result.missingFields.includes('email')) {
                log.error(
                    '- JIRA_EMAIL: Email address associated with your Jira account'
                );
            }
            if (result.missingFields.includes('apiToken')) {
                log.error(
                    '- JIRA_API_TOKEN: API token generated from your Atlassian account'
                );
            }
            if (result.missingFields.includes('project')) {
                log.error('- JIRA_PROJECT: Your Jira project key (e.g., "PROJ")');
            }
        }

        return result;
    }

    /**
     * Get the initialized Jira API client or throw an error if not available
     * @returns Axios Jira client instance
     * @throws Error If Jira is not enabled or client failed to initialize
     */
    getClient(): AxiosInstance {
        if (!this.enabled) {
            throw new Error(
                'Jira integration is not enabled. Please configure the required environment variables.'
            );
        }

        if (!this.client) {
            throw new Error(
                `Jira client initialization failed: ${this.error || 'Unknown error'}`
            );
        }

        return this.client;
    }

    /**
     * Check if Jira integration is enabled and client is ready
     * @returns True if Jira client is ready to use
     */
    isReady(): boolean {
        return this.enabled && !!this.client;
    }

    /**
     * Standard error response generator for Jira operations
     * @param code - Error code
     * @param message - Error message
     * @param details - Additional error details
     * @returns Standard error response object
     */
    createErrorResponse(code: string, message: string, details?: any): JiraErrorResponse {
        return {
            success: false,
            error: {
                code,
                message,
                ...(details ? { details } : {})
            }
        };
    }

    /**
     * Fetch a single Jira issue by its key
     * @param issueKey - Jira issue key to fetch
     * @param options - Additional options
     * @returns Result with success status and issue data/error
     */
    async fetchIssue(issueKey: string, options: FetchOptions = {}): Promise<JiraResponse<JiraTicket>> {
        const log = options.log || defaultLogger;
        const expand = options.expand !== undefined ? options.expand : true;
        const includeImages = options.includeImages !== undefined ? options.includeImages : true;
        const includeComments = options.includeComments !== undefined ? options.includeComments : false;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            log.info(
                `Fetching Jira issue with key: ${issueKey}${includeImages === false ? ' (excluding images)' : ''}${includeComments ? ' (including comments)' : ''}`
            );

            // Build fields list based on options
            let fields = 'summary,description,status,priority,issuetype,parent,issuelinks,subtasks,attachment,labels';
            if (includeComments) {
                fields += ',comment';
            }

            const client = this.getClient();
            const response: AxiosResponse<JiraIssue> = await client.get(`/rest/api/3/issue/${issueKey}`, {
                params: {
                    fields: fields,
                    ...(expand ? { expand: 'renderedFields' } : {})
                }
            });

            if (!response.data) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'Invalid response from Jira API'
                );
            }

            const jiraTicket = await JiraTicket.fromJiraIssue(response.data);

            // Conditionally fetch image attachments if they exist and includeImages is true
            if (
                includeImages &&
                jiraTicket.attachments &&
                jiraTicket.attachments.length > 0
            ) {
                log.info(
                    `Found ${jiraTicket.attachments.length} attachments, checking for images...`
                );

                // Extract attachment IDs for image attachments only
                const imageAttachments = jiraTicket.attachments.filter(
                    (att: any) => att.mimeType && att.mimeType.startsWith('image/')
                );

                if (imageAttachments.length > 0) {
                    log.info(
                        `Fetching ${imageAttachments.length} image attachments as base64...`
                    );

                    const attachmentIds = imageAttachments.map((att: any) => att.id);

                    // Fetch attachment images as base64
                    const attachmentsResult = await this.fetchAttachmentsAsBase64(
                        attachmentIds,
                        {
                            log,
                            thumbnail: false, // Use full images, not thumbnails
                            compress: true, // Enable compression for MCP injection
                            imageTypes: [
                                'image/jpeg',
                                'image/jpg',
                                'image/png',
                                'image/gif',
                                'image/bmp',
                                'image/webp',
                                'image/svg+xml'
                            ],
                            attachmentMetadata: imageAttachments // Pass the attachment metadata
                        }
                    );

                    if (attachmentsResult.success) {
                        // Add base64 data to the ticket
                        (jiraTicket as any).attachmentImages = attachmentsResult.data.attachments;
                        (jiraTicket as any).attachmentImageStats = {
                            totalAttachments: jiraTicket.attachments.length,
                            totalImages: attachmentsResult.data.totalFetched,
                            totalErrors: attachmentsResult.data.totalErrors,
                            isThumbnail: false
                        };

                        if (attachmentsResult.data.errors.length > 0) {
                            log.warn(
                                `Failed to fetch ${attachmentsResult.data.errors.length} attachment images`
                            );
                        } else {
                            log.info(
                                `Successfully fetched ${attachmentsResult.data.totalFetched} image attachments`
                            );
                        }
                    } else {
                        log.error(
                            `Failed to fetch attachment images: ${attachmentsResult.error?.message}`
                        );
                    }
                }
            }

            return {
                success: true,
                data: jiraTicket
            };
        } catch (error) {
            log.error(`Error fetching Jira issue: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to fetch issue: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Search for Jira issues using JQL
     * @param jql - JQL query string
     * @param options - Additional options
     * @returns Result with success status and array of JiraTicket objects
     */
    async searchIssues(jql: string, options: SearchOptions = {}): Promise<JiraResponse<JiraTicket[]>> {
        const log = (options as any).log || defaultLogger;
        const maxResults = options.maxResults || 100;
        const expand = options.expand !== undefined ? options.expand : true;
        const includeComments = (options as any).includeComments !== undefined ? (options as any).includeComments : false;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            log.info(`Searching Jira issues with JQL: ${jql}${includeComments ? ' (including comments)' : ''}`);

            // Build fields list based on options
            let fields = options.fields || 'summary,description,status,priority,issuetype,parent,issuelinks,subtasks,attachment';
            if (includeComments) {
                fields += ',comment';
            }

            const client = this.getClient();
            const response: AxiosResponse<JiraSearchResult> = await client.get('/rest/api/3/search', {
                params: {
                    jql,
                    maxResults,
                    fields: fields,
                    ...(expand ? { expand: 'renderedFields' } : {})
                }
            });

            if (!response.data || !response.data.issues) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'Invalid response from Jira API'
                );
            }

            // Convert each issue to a JiraTicket object
            const jiraTickets = await Promise.all(
                response.data.issues.map((issue: JiraIssue) => JiraTicket.fromJiraIssue(issue))
            );

            // Return the modified response with JiraTicket objects
            return {
                success: true,
                data: jiraTickets
            };
        } catch (error) {
            log.error(`Error searching Jira issues: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to search issues: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Create a new Jira issue
     * @param issueData - Data for the new issue
     * @param options - Additional options
     * @returns Result with success status and created issue data/error
     */
    async createIssue(issueData: JiraTicket, options: CreateOptions = {}): Promise<JiraResponse<any>> {
        const log = options.log || defaultLogger;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            log.info('Creating new Jira issue');

            const client = this.getClient();
            const response: AxiosResponse<any> = await client.post(
                '/rest/api/3/issue',
                issueData.toJiraRequestData()
            );

            if (!response.data) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'Invalid response from Jira API'
                );
            }

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            log.error(`Error creating Jira issue: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to create issue: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Update an existing Jira issue
     * @param issueKey - Key of the issue to update
     * @param issueData - Updated issue data
     * @param options - Additional options
     * @returns Result with success status and updated issue data/error
     */
    async updateIssue(issueKey: string, issueData: any, options: UpdateOptions = {}): Promise<JiraResponse<{ issueKey: string }>> {
        const log = options.log || defaultLogger;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            log.info(`Updating Jira issue ${issueKey}`);

            const client = this.getClient();
            await client.put(
                `/rest/api/3/issue/${issueKey}`,
                issueData
            );

            // Jira returns 204 No Content for successful updates
            return {
                success: true,
                data: { issueKey }
            };
        } catch (error) {
            log.error(`Error updating Jira issue: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to update issue: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Transition a Jira issue to a new status
     * @param issueKey - Key of the issue to transition
     * @param transitionName - Name of the transition to perform
     * @param options - Additional options
     * @returns Result with success status and transition data/error
     */
    async transitionIssue(issueKey: string, transitionName: string, options: TransitionOptions = {}): Promise<JiraResponse<{ issueKey: string; transition: string }>> {
        const log = options.log || defaultLogger;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            log.info(`Transitioning Jira issue ${issueKey} to ${transitionName}`);

            // First, get available transitions
            const client = this.getClient();
            const transitionsResponse: AxiosResponse<{ transitions: JiraTransition[] }> = await client.get(
                `/rest/api/3/issue/${issueKey}/transitions`
            );

            if (!transitionsResponse.data || !transitionsResponse.data.transitions) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'Invalid transitions response from Jira API'
                );
            }

            // Find the transition ID by name
            const transition = transitionsResponse.data.transitions.find(
                (t: any) => t.name.toLowerCase() === transitionName.toLowerCase()
            );

            if (!transition) {
                return this.createErrorResponse(
                    'JIRA_INVALID_TRANSITION',
                    `Transition '${transitionName}' not found for issue ${issueKey}`,
                    {
                        availableTransitions: transitionsResponse.data.transitions.map(
                            (t: any) => t.name
                        )
                    }
                );
            }

            // Perform the transition
            await client.post(`/rest/api/3/issue/${issueKey}/transitions`, {
                transition: { id: transition.id }
            });

            return {
                success: true,
                data: { issueKey, transition: transitionName }
            };
        } catch (error) {
            log.error(`Error transitioning Jira issue: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to transition issue: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Get available transitions for a Jira issue
     * @param issueKey - Key of the issue to get transitions for
     * @param options - Additional options
     * @returns Result with success status and transitions data/error
     */
    async getTransitions(issueKey: string, options: TransitionOptions = {}): Promise<JiraResponse<{ transitions: JiraTransition[] }>> {
        const log = options.log || defaultLogger;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            log.info(`Getting transitions for Jira issue ${issueKey}`);

            const client = this.getClient();
            const response: AxiosResponse<{ transitions: JiraTransition[] }> = await client.get(
                `/rest/api/3/issue/${issueKey}/transitions`
            );

            if (!response.data || !response.data.transitions) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'Invalid transitions response from Jira API'
                );
            }

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            log.error(`Error getting Jira transitions: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to get transitions: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Add a comment to a Jira issue
     * @param issueKey - Key of the issue to add a comment to
     * @param commentText - Text content of the comment to add
     * @param options - Additional options
     * @returns Result with success status and comment data/error
     */
    async addComment(issueKey: string, commentText: string, options: CreateOptions = {}): Promise<JiraResponse<JiraComment>> {
        const log = options.log || defaultLogger;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            if (!issueKey) {
                return this.createErrorResponse(
                    'JIRA_INVALID_INPUT',
                    'Issue key is required'
                );
            }

            if (!commentText) {
                return this.createErrorResponse(
                    'JIRA_INVALID_INPUT',
                    'Comment text is required'
                );
            }

            log.info(`Adding comment to Jira issue ${issueKey}`);

            const client = this.getClient();
            const response: AxiosResponse<JiraComment> = await client.post(
                `/rest/api/3/issue/${issueKey}/comment`,
                {
                    body: {
                        type: 'doc',
                        version: 1,
                        content: [
                            {
                                type: 'paragraph',
                                content: [
                                    {
                                        type: 'text',
                                        text: commentText
                                    }
                                ]
                            }
                        ]
                    }
                }
            );

            if (!response.data) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'Invalid response from Jira API'
                );
            }

            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            log.error(`Error adding comment to Jira issue: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to add comment: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Fetch comments for a Jira issue
     * @param issueKey - The Jira issue key
     * @param options - Additional options
     * @returns Result with success status and comments data
     */
    async fetchComments(issueKey: string, options: FetchOptions = {}): Promise<JiraResponse<{ issueKey: string; comments: any[]; totalComments: number; maxResults: number; startAt: number }>> {
        const log = options.log || defaultLogger;
        const maxResults = 50;
        const orderBy = 'created';

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            if (!issueKey) {
                return this.createErrorResponse(
                    'JIRA_INVALID_INPUT',
                    'Issue key is required'
                );
            }

            log.info(`Fetching comments for issue: ${issueKey}`);

            const client = this.getClient();
            const response: AxiosResponse<{ comments: JiraComment[]; total: number; maxResults: number; startAt: number }> = await client.get(`/rest/api/3/issue/${issueKey}/comment`, {
                params: {
                    maxResults,
                    orderBy,
                    expand: 'renderedBody'
                }
            });

            if (!response.data) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'No comments data received from Jira API'
                );
            }

            const comments = response.data.comments || [];

            // Process comments using JiraTicket's extraction method
            const { JiraTicket } = await import('./jira-ticket');
            const formattedComments = JiraTicket.extractCommentsFromJira(comments);

            return {
                success: true,
                data: {
                    issueKey: issueKey,
                    comments: formattedComments,
                    totalComments: response.data.total || comments.length,
                    maxResults: response.data.maxResults || maxResults,
                    startAt: response.data.startAt || 0
                }
            };
        } catch (error) {
            // If the issue doesn't have comments or they're not accessible, return empty array instead of error
            if ((error as any).response?.status === 404) {
                log.info(`No comments found for issue ${issueKey}`);
                return {
                    success: true,
                    data: {
                        issueKey: issueKey,
                        comments: [],
                        totalComments: 0,
                        maxResults: maxResults,
                        startAt: 0
                    }
                };
            }

            log.error(`Error fetching comments: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to fetch comments: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Fetch attachment metadata without downloading the full content
     * @param issueKey - The Jira issue key
     * @param options - Additional options
     * @returns Result with success status and attachments metadata
     */
    async fetchAttachmentMetadata(issueKey: string, options: FetchOptions = {}): Promise<JiraResponse<{ issueKey: string; attachments: any[]; totalAttachments: number }>> {
        const log = options.log || defaultLogger;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            if (!issueKey) {
                return this.createErrorResponse(
                    'JIRA_INVALID_INPUT',
                    'Issue key is required'
                );
            }

            log.info(`Fetching attachment metadata for issue: ${issueKey}`);

            const client = this.getClient();
            const response: AxiosResponse<{ fields: { attachment: any[] } }> = await client.get(`/rest/api/3/issue/${issueKey}`, {
                params: {
                    fields: 'attachment'
                }
            });

            if (!response.data || !response.data.fields) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'No issue data received from Jira API'
                );
            }

            const attachments = response.data.fields.attachment || [];

            // Map to a cleaner format
            const attachmentMetadata = attachments.map((att: any) => ({
                id: att.id,
                filename: att.filename,
                author: att.author
                    ? {
                            accountId: att.author.accountId,
                            displayName: att.author.displayName,
                            emailAddress: att.author.emailAddress
                        }
                    : null,
                created: att.created,
                size: att.size,
                mimeType: att.mimeType,
                content: att.content, // URL for downloading
                thumbnail: att.thumbnail // URL for thumbnail if available
            }));

            return {
                success: true,
                data: {
                    issueKey: issueKey,
                    attachments: attachmentMetadata,
                    totalAttachments: attachmentMetadata.length
                }
            };
        } catch (error) {
            log.error(`Error fetching attachment metadata: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to fetch attachment metadata: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Fetch attachment content as base64 for MCP injection (supports all file types)
     * @param attachmentId - The attachment ID
     * @param options - Additional options
     * @returns Result with success status and base64 data/error
     */
    async fetchAttachmentAsBase64(attachmentId: string, options: any = {}): Promise<JiraResponse<AttachmentResponse>> {
        const log = options.log || defaultLogger;
        const thumbnail = options.thumbnail || false;
        const compress = options.compress !== undefined ? options.compress : true; // Default to compress

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            if (!attachmentId) {
                return this.createErrorResponse(
                    'JIRA_INVALID_INPUT',
                    'Attachment ID is required'
                );
            }

            log.info(
                `Fetching attachment ${attachmentId} as base64 (thumbnail: ${thumbnail}, compress: ${compress})`
            );

            const client = this.getClient();
            const endpoint = thumbnail
                ? `/rest/api/3/attachment/thumbnail/${attachmentId}`
                : `/rest/api/3/attachment/content/${attachmentId}`;

            const response: AxiosResponse<ArrayBuffer> = await client.get(endpoint, {
                responseType: 'arraybuffer'
            });

            if (!response.data) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'No attachment data received from Jira API'
                );
            }

            // Convert binary data to base64
            let base64Data = Buffer.from(response.data).toString('base64');

            // Get MIME type from response headers
            let mimeType =
                response.headers['content-type'] || 'application/octet-stream';
            let originalSize = response.data.byteLength;
            let compressedSize = originalSize;

                            // Apply compression if requested and it's an image
                if (compress && mimeType.startsWith('image/')) {
                    log.info('Compressing image for MCP injection...');
                    const compressionResult = await compressImageIfNeeded(
                        base64Data,
                        mimeType,
                        log
                    );
                    base64Data = compressionResult.base64Data;
                    mimeType = compressionResult.mimeType;
                    compressedSize = compressionResult.compressedSize;

                log.info(
                    `Image compression complete. Original: ${originalSize} bytes, Compressed: ${compressedSize} bytes`
                );
            }

            return {
                success: true,
                data: {
                    base64: base64Data,
                    mimeType: mimeType,
                    size: compressedSize,
                    originalSize: originalSize,
                    attachmentId: attachmentId,
                    isThumbnail: thumbnail,
                    compressed:
                        compress &&
                        mimeType.startsWith('image/') &&
                        compressedSize < originalSize
                }
            };
        } catch (error) {
            log.error(`Error fetching attachment as base64: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to fetch attachment: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Fetch multiple attachments as base64 for MCP injection (supports all file types)
     * @param attachmentIds - Array of attachment IDs
     * @param options - Additional options
     * @returns Result with success status and array of base64 data/error
     */
    async fetchAttachmentsAsBase64(attachmentIds: string[], options: any = {}): Promise<JiraResponse<{ attachments: any[]; errors: any[]; totalRequested: number; totalFetched: number; totalErrors: number }>> {
        const log = options.log || defaultLogger;
        const thumbnail = options.thumbnail || false;
        const compress = options.compress !== undefined ? options.compress : true; // Default to compress
        const attachmentMetadata = options.attachmentMetadata || [];
        const allFileTypes = options.allFileTypes || false;

        // Default to image types for backward compatibility, unless allFileTypes is true
        const imageTypes = allFileTypes
            ? []
            : options.imageTypes || [
                    'image/jpeg',
                    'image/jpg',
                    'image/png',
                    'image/gif',
                    'image/bmp',
                    'image/webp',
                    'image/svg+xml'
                ];

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
                return this.createErrorResponse(
                    'JIRA_INVALID_INPUT',
                    'Attachment IDs array is required and must not be empty'
                );
            }

            log.info(
                `Fetching ${attachmentIds.length} attachments as base64 (thumbnail: ${thumbnail}, compress: ${compress})`
            );

            const results: any[] = [];
            const errors: any[] = [];

            // Process attachments sequentially to avoid overwhelming the API
            for (const attachmentId of attachmentIds) {
                try {
                    const result = await this.fetchAttachmentAsBase64(attachmentId, {
                        log,
                        thumbnail,
                        compress
                    });

                    if (result.success) {
                        // Filter based on file types (all types if allFileTypes=true or imageTypes is empty)
                        const shouldInclude =
                            allFileTypes ||
                            imageTypes.length === 0 ||
                            imageTypes.includes(result.data.mimeType);

                        if (shouldInclude) {
                            // Find metadata for this attachment and add filename if available
                            const metadata = attachmentMetadata.find(
                                (meta: any) => meta.id === attachmentId
                            );
                            if (metadata && metadata.filename) {
                                result.data.filename = metadata.filename;
                            }
                            results.push(result.data);
                        } else {
                            log.info(
                                `Skipping attachment ${attachmentId} with MIME type ${result.data.mimeType} (not in allowed types)`
                            );
                        }
                    } else {
                        errors.push({
                            attachmentId,
                            error: result.error
                        });
                    }
                } catch (error) {
                    errors.push({
                        attachmentId,
                        error: {
                            code: 'ATTACHMENT_FETCH_ERROR',
                            message: (error as Error).message
                        }
                    });
                }
            }

            return {
                success: true,
                data: {
                    attachments: results,
                    errors: errors,
                    totalRequested: attachmentIds.length,
                    totalFetched: results.length,
                    totalErrors: errors.length
                }
            };
        } catch (error) {
            log.error(
                `Error fetching multiple attachments as base64: ${(error as Error).message}`
            );
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to fetch attachments: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }

    /**
     * Fetch remote links for a Jira issue
     * @param issueKey - The Jira issue key
     * @param options - Additional options
     * @returns Result with success status and remote links data
     */
    async fetchRemoteLinks(issueKey: string, options: FetchOptions = {}): Promise<JiraResponse<JiraRemoteLink[]>> {
        const log = options.log || defaultLogger;

        try {
            if (!this.isReady()) {
                return this.createErrorResponse(
                    'JIRA_NOT_ENABLED',
                    'Jira integration is not properly configured'
                );
            }

            if (!issueKey) {
                return this.createErrorResponse(
                    'JIRA_INVALID_INPUT',
                    'Issue key is required'
                );
            }

            log.info(`Fetching remote links for issue: ${issueKey}`);

            const client = this.getClient();
            const response: AxiosResponse<JiraRemoteLink[]> = await client.get(`/rest/api/3/issue/${issueKey}/remotelink`);

            if (!response.data) {
                return this.createErrorResponse(
                    'JIRA_INVALID_RESPONSE',
                    'No remote links data received from Jira API'
                );
            }

            // response.data should be an array of remote link objects
            const remoteLinks = Array.isArray(response.data) ? response.data : [];

            return {
                success: true,
                data: remoteLinks
            };
        } catch (error) {
            // If the issue doesn't have remote links or they're not accessible, return empty array instead of error
            if ((error as any).response?.status === 404) {
                log.info(`No remote links found for issue ${issueKey}`);
                return {
                    success: true,
                    data: []
                };
            }

            log.error(`Error fetching remote links: ${(error as Error).message}`);
            return this.createErrorResponse(
                'JIRA_REQUEST_ERROR',
                `Failed to fetch remote links: ${(error as Error).message}`,
                (error as any).response?.data
            );
        }
    }
} 