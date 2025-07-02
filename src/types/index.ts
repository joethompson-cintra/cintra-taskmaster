// Custom types for the MCP server

export interface ServerConfig {
    name: string;
    version: string;
    environment: string;
    port: number;
    baseUrl: string;
}

export interface AuthConfig {
    clientId: string;
    clientSecret: string;
    authorizationUrl: string;
    tokenUrl: string;
    revocationUrl: string;
    issuerUrl: string;
}

export interface SessionInfo {
    sessionId: string;
    userId?: string;
    scopes: string[];
    createdAt: Date;
    lastActivity: Date;
}

export interface ToolResult {
    content: Array<{
        type: 'text' | 'image';
        text?: string;
        data?: string;
        mimeType?: string;
    }>;
}

export interface ResourceContent {
    uri: string;
    mimeType: string;
    text?: string;
    blob?: Uint8Array;
}

export interface PromptMessage {
    role: 'user' | 'assistant' | 'system';
    content: {
        type: 'text' | 'image';
        text?: string;
        data?: string;
        mimeType?: string;
    };
}

export interface ErrorResponse {
    error: string;
    code?: string;
    details?: Record<string, unknown>;
} 