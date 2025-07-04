import { Logger } from '../types/jira';

export interface SessionConfig {
    JIRA_EMAIL?: string;
    JIRA_API_TOKEN?: string;
    JIRA_PROJECT?: string;
    BITBUCKET_EMAIL?: string;
    BITBUCKET_API_TOKEN?: string;
    [key: string]: any;
}

export interface JiraConfig {
    baseUrl?: string;
    email?: string;
    apiToken?: string;
    project?: string;
}

export interface BitbucketConfig {
    workspace?: string;
    username?: string;
    apiToken?: string;
}

export interface ConfigResult {
    jiraConfig: JiraConfig;
    bitbucketConfig: BitbucketConfig;
}

/**
 * Extracts and validates Jira and Bitbucket configurations from session
 * @param getSessionConfig - Function to get session configuration
 * @param logger - Logger instance for debugging
 * @param options - Configuration options
 * @returns Object containing jiraConfig and bitbucketConfig
 */
export function useSessionConfigs(
    getSessionConfig?: () => SessionConfig,
    logger?: Logger,
    options: {
        includeJira?: boolean;
        includeBitbucket?: boolean;
        logConfigs?: boolean;
    } = {}
): ConfigResult {
    const {
        includeJira = true,
        includeBitbucket = true,
        logConfigs = true
    } = options;

    // Get session-specific config if available
    const sessionConfig = getSessionConfig ? getSessionConfig() : {};

    // Build Jira configuration
    const jiraConfig: JiraConfig = includeJira ? {
        baseUrl: process.env.JIRA_API_URL,
        email: sessionConfig.JIRA_EMAIL,
        apiToken: sessionConfig.JIRA_API_TOKEN,
        project: sessionConfig.JIRA_PROJECT,
    } : {};

    // Build Bitbucket configuration
    const bitbucketConfig: BitbucketConfig = includeBitbucket ? {
        workspace: process.env.BITBUCKET_WORKSPACE,
        username: sessionConfig.BITBUCKET_EMAIL,
        apiToken: sessionConfig.BITBUCKET_API_TOKEN,
    } : {};

    // Log configurations if requested and logger is available
    if (logConfigs && logger) {
        if (includeJira) {
            logger.info('Final Jira config:', {
                baseUrl: jiraConfig.baseUrl ? jiraConfig.baseUrl : 'MISSING',
                hasEmail: !!jiraConfig.email,
                hasToken: !!jiraConfig.apiToken,
                project: jiraConfig.project || 'MISSING'
            });
        }

        if (includeBitbucket) {
            logger.info('Final Bitbucket config:', {
                workspace: bitbucketConfig.workspace || 'MISSING',
                hasUsername: !!bitbucketConfig.username,
                hasToken: !!bitbucketConfig.apiToken
            });
        }
    }

    return {
        jiraConfig,
        bitbucketConfig
    };
}

/**
 * Convenience function for tools that only need Jira configuration
 * @param getSessionConfig - Function to get session configuration
 * @param logger - Logger instance for debugging
 * @returns Jira configuration object
 */
export function useJiraConfig(
    getSessionConfig?: () => SessionConfig,
    logger?: Logger
): JiraConfig {
    const { jiraConfig } = useSessionConfigs(getSessionConfig, logger, {
        includeJira: true,
        includeBitbucket: false,
        logConfigs: true
    });
    return jiraConfig;
}

/**
 * Convenience function for tools that only need Bitbucket configuration
 * @param getSessionConfig - Function to get session configuration
 * @param logger - Logger instance for debugging
 * @returns Bitbucket configuration object
 */
export function useBitbucketConfig(
    getSessionConfig?: () => SessionConfig,
    logger?: Logger
): BitbucketConfig {
    const { bitbucketConfig } = useSessionConfigs(getSessionConfig, logger, {
        includeJira: false,
        includeBitbucket: true,
        logConfigs: true
    });
    return bitbucketConfig;
} 