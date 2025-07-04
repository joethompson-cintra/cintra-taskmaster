// Jira-specific TypeScript type definitions

export interface JiraConfig {
    baseUrl: string;
    email: string;
    apiToken: string;
    project: string;
}

export interface JiraValidationResult {
    success: boolean;
    missingFields: string[];
}

export interface JiraErrorResponse {
    success: false;
    error: {
        code: string;
        message: string;
        details?: any;
    };
}

export interface JiraSuccessResponse<T = any> {
    success: true;
    data: T;
}

export type JiraResponse<T = any> = JiraSuccessResponse<T> | JiraErrorResponse;

// Jira API Response Types
export interface JiraUser {
    accountId: string;
    accountType: string;
    displayName: string;
    emailAddress?: string;
    active: boolean;
    avatarUrls?: {
        '16x16': string;
        '24x24': string;
        '32x32': string;
        '48x48': string;
    };
}

export interface JiraProject {
    id: string;
    key: string;
    name: string;
    projectTypeKey: string;
    simplified: boolean;
    style: string;
    isPrivate: boolean;
    avatarUrls?: {
        '16x16': string;
        '24x24': string;
        '32x32': string;
        '48x48': string;
    };
}

export interface JiraIssueType {
    id: string;
    name: string;
    subtask: boolean;
    hierarchyLevel: number;
    iconUrl: string;
}

export interface JiraPriority {
    id: string;
    name: string;
    iconUrl: string;
}

export interface JiraStatus {
    id: string;
    name: string;
    statusCategory: {
        id: number;
        key: string;
        colorName: string;
        name: string;
    };
}

export interface JiraIssueLink {
    id: string;
    type: {
        id: string;
        name: string;
        inward: string;
        outward: string;
    };
    inwardIssue?: JiraIssue;
    outwardIssue?: JiraIssue;
}

export interface JiraAttachment {
    id: string;
    filename: string;
    author: JiraUser;
    created: string;
    size: number;
    mimeType: string;
    content: string;
    thumbnail?: string;
}

export interface JiraComment {
    id: string;
    author: JiraUser;
    body: any; // ADF format
    created: string;
    updated: string;
    visibility?: {
        type: string;
        value: string;
    };
}

export interface JiraTransition {
    id: string;
    name: string;
    to: {
        id: string;
        name: string;
    };
    fields?: Record<string, any>;
}

export interface JiraRemoteLink {
    id: number;
    self: string;
    globalId: string;
    application: {
        name: string;
        type: string;
    };
    relationship: string;
    object: {
        url: string;
        title: string;
        summary?: string;
        icon?: {
            url16x16: string;
            title: string;
        };
    };
}

export interface JiraIssue {
    id: string;
    key: string;
    self: string;
    fields: {
        summary: string;
        description?: any; // ADF format
        status: JiraStatus;
        priority: JiraPriority;
        issuetype: JiraIssueType;
        project: JiraProject;
        assignee?: JiraUser;
        reporter: JiraUser;
        creator: JiraUser;
        created: string;
        updated: string;
        resolutiondate?: string;
        labels: string[];
        components: Array<{
            id: string;
            name: string;
        }>;
        fixVersions: Array<{
            id: string;
            name: string;
            released: boolean;
            releaseDate?: string;
        }>;
        parent?: JiraIssue;
        subtasks: JiraIssue[];
        issuelinks: JiraIssueLink[];
        attachment: JiraAttachment[];
        comment: {
            comments: JiraComment[];
            total: number;
        };
        customfield_10014?: string; // Epic Link
        customfield_10015?: string; // Epic Name
        customfield_10016?: number; // Story Points
        [key: string]: any; // Allow additional custom fields
    };
    changelog?: {
        histories: Array<{
            id: string;
            author: JiraUser;
            created: string;
            items: Array<{
                field: string;
                fieldtype: string;
                from: string;
                fromString: string;
                to: string;
                toString: string;
            }>;
        }>;
    };
}

export interface JiraSearchResult {
    expand: string;
    startAt: number;
    maxResults: number;
    total: number;
    issues: JiraIssue[];
}

export interface JiraCreateIssueRequest {
    fields: {
        project: {
            key: string;
        };
        summary: string;
        description?: any; // ADF format
        issuetype: {
            name: string;
        };
        priority?: {
            name: string;
        };
        assignee?: {
            accountId: string;
        };
        parent?: {
            key: string;
        };
        labels?: string[];
        components?: Array<{
            name: string;
        }>;
        customfield_10014?: string; // Epic Link
        [key: string]: any;
    };
}

export interface JiraUpdateIssueRequest {
    fields?: {
        summary?: string;
        description?: any; // ADF format
        priority?: {
            name: string;
        };
        assignee?: {
            accountId: string;
        };
        labels?: string[];
        components?: Array<{
            name: string;
        }>;
        [key: string]: any;
    };
}

// Task Master specific types
export interface JiraTicketData {
    title: string;
    description: string;
    details?: string;
    acceptanceCriteria?: string;
    testStrategy?: string;
    priority?: string;
    issueType?: string;
    parentKey?: string;
    labels?: string[];
    assignee?: string;
    jiraKey?: string;
    dependencies?: string[];
    status?: string;
    attachments?: any[];
    comments?: any[];
    relatedContext?: any;
}

export interface TaskMasterTask {
    id: string;
    jiraKey: string;
    title: string;
    description: string;
    status: string;
    priority: string;
    assignee?: string;
    labels: string[];
    dependencies: string[];
    subtasks: TaskMasterTask[];
    parentKey?: string;
    issueType: string;
    created: string;
    updated: string;
    acceptanceCriteria?: string;
    testStrategy?: string;
    testStrategyTdd?: string;
    details?: string;
    implementationDetails?: string;
    attachments?: any[];
    comments?: any[];
    relatedContext?: any;
    pullRequests?: PullRequest[];
    relatedTickets?: ContextItem[];
    relationshipSummary?: any;
    contextSummary?: any;
}

// Atlassian Document Format (ADF) types
export interface ADFNode {
    type: string;
    attrs?: Record<string, any>;
    content?: ADFNode[];
    text?: string;
    marks?: Array<{
        type: string;
        attrs?: Record<string, any>;
    }>;
}

export interface ADFDocument {
    version: number;
    type: 'doc';
    content: ADFNode[];
}

// Relationship Resolver types
export interface RelationshipData {
    issueKey: string;
    issue: any;
    relationship: string;
    depth: number;
    direction: 'inward' | 'outward' | 'upward' | 'downward';
    linkType?: string;
}

export interface RelationshipGraphMetadata {
    totalRelated: number;
    maxDepthReached: number;
    relationshipTypes: string[];
    circularReferencesDetected: boolean;
}

export interface RelationshipGraphData {
    sourceIssue: string;
    relationships: RelationshipData[];
    metadata: RelationshipGraphMetadata;
}

// Context Aggregator types
export interface ContextItem {
    ticket: TaskMasterTask;
    relationship: string;
    relevanceScore?: number;
}

export interface ContextSummary {
    summary: string;
    tickets: ContextItem[];
}

// Bitbucket/PR related types
export interface PullRequest {
    id: string;
    title: string;
    description: string;
    state: string;
    author: {
        name: string;
        emailAddress: string;
    };
    reviewers: Array<{
        user: {
            name: string;
            emailAddress: string;
        };
        approved: boolean;
    }>;
    commits?: Array<{
        id: string;
        displayId: string;
        message: string;
        author: {
            name: string;
            emailAddress: string;
        };
    }>;
    createdDate: number;
    updatedDate: number;
    links: {
        self: Array<{
            href: string;
        }>;
    };
}

// Utility types for token management
export interface TokenEstimate {
    text: string;
    estimatedTokens: number;
}

export interface TrimOptions {
    maxTokens: number;
    prioritizeImages?: boolean;
    keepMinimumTickets?: number;
}

export interface TrimStatistics {
    originalRelatedTickets: number;
    removedTickets: number;
    removedImages: number;
    trimmedPRs: number;
    trimmedFields: number;
}

// Options interfaces for various operations
export interface FetchOptions {
    log?: any;
    includeComments?: boolean;
    includeContext?: boolean;
    includeImages?: boolean;
    maxRelatedTickets?: number;
    withSubtasks?: boolean;
    fields?: string;
    expand?: string;
    comment_limit?: number;
    properties?: string;
    update_history?: boolean;
    maxTokens?: number;
    jiraConfig?: {
        baseUrl?: string;
        email?: string;
        apiToken?: string;
        project?: string;
    };
    bitbucketConfig?: {
        workspace?: string;
        username?: string;
        apiToken?: string;
    };
}

export interface SearchOptions {
    fields?: string;
    expand?: string;
    maxResults?: number;
    startAt?: number;
    validateQuery?: boolean;
    log?: Logger;
}

export interface CreateOptions {
    log?: any;
    validate?: boolean;
    notifyUsers?: boolean;
}

export interface UpdateOptions {
    log?: any;
    notifyUsers?: boolean;
    overrideScreenSecurity?: boolean;
    overrideEditableFields?: boolean;
}

export interface TransitionOptions {
    log?: any;
    skipRemoteOnlyCondition?: boolean;
}

// Image compression types
export interface ImageCompressionOptions {
    maxSizeKB?: number;
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
}

export interface CompressionResult {
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    base64Data: string;
    mimeType: string;
}

export interface AttachmentResponse {
    base64: string;
    mimeType: string;
    size: number;
    originalSize: number;
    attachmentId: string;
    isThumbnail: boolean;
    compressed: boolean;
    filename?: string;
}

// Logger interface
export interface Logger {
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
}

// Circuit breaker and caching types
export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
}

export interface CircuitBreakerState {
    failureCount: number;
    lastFailureTime: number;
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

// Field error types for validation
export interface FieldError {
    field: string;
    message: string;
    suggestion?: string;
}

export interface ValidationErrors {
    errors: FieldError[];
    warnings: string[];
}

export interface FindNextTaskOptions {
    mcpLog?: Logger;
}

export interface UpdateIssuesOptions {
    session?: any;
    projectRoot?: string;
    mcpLog?: Logger;
}

export interface ExpandTaskOptions {
    reportProgress?: (message: string, level?: string) => void;
    mcpLog?: Logger;
    session?: any;
    force?: boolean;
}

export interface GenerateSubtasksOptions {
    reportProgress?: (message: string, level?: string) => void;
    mcpLog?: Logger;
    silentMode?: boolean;
    session?: any;
}

export interface AnalyzeComplexityOptions {
    session?: any;
    model?: string;
}

export interface FieldErrorSuggestion {
    field: string;
    message: string;
    suggestion: string;
}

export interface JiraApiError extends Error {
    response?: {
        status?: number;
        data?: any;
        headers?: any;
    };
    config?: {
        url?: string;
        method?: string;
        baseURL?: string;
        headers?: any;
    };
    isAxiosError?: boolean;
    code?: string;
}

export interface PriorityValues {
    [key: string]: number;
    high: number;
    medium: number;
    low: number;
}

export interface IssueTypeMap {
    [key: string]: {
        isSubtask: boolean;
        [key: string]: any;
    };
}

export interface RelationshipType {
    type: string;
    primary?: boolean;
} 