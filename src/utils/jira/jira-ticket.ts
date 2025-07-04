/**
 * jira-ticket.ts
 *
 * Class for managing Jira ticket data and converting between Task Master and Jira formats.
 * This class helps standardize Jira ticket operations by providing methods to:
 * 1. Convert markdown content to Atlassian Document Format (ADF)
 * 2. Format task data into proper Jira API request format
 * 3. Handle panel content formatting (details, acceptance criteria, test strategy)
 */

import { JiraClient } from './jira-client.js';
import { 
    JiraTicketData, 
    TaskMasterTask, 
    ADFDocument, 
    ADFNode, 
    JiraIssue, 
    JiraCreateIssueRequest,
    JiraComment
} from '../../types/jira.js';

/**
 * Class representing a Jira ticket with conversion utilities
 */
export class JiraTicket {
    public title: string;
    public description: string;
    public details: string;
    public acceptanceCriteria: string;
    public testStrategy: string;
    public priority: string;
    public issueType: string;
    public parentKey: string;
    public labels: string[];
    public assignee: string;
    public jiraKey: string;
    public dependencies: string[];
    public status: string;
    public attachments: any[];
    public comments: any[];
    public relatedContext: any;

    /**
     * Create a new JiraTicket
     * @param data - Initial ticket data
     */
    constructor(data: Partial<JiraTicketData> = {}) {
        this.title = data.title || '';
        this.description = data.description || '';
        this.details = data.details || '';
        this.acceptanceCriteria = data.acceptanceCriteria || '';
        this.testStrategy = data.testStrategy || '';
        this.priority = data.priority
            ? data.priority.charAt(0).toUpperCase() + data.priority.slice(1)
            : 'Medium';
        this.issueType = data.issueType || 'Task';
        this.parentKey = data.parentKey || '';
        this.labels = data.labels || [];
        this.assignee = data.assignee || '';
        this.jiraKey = data.jiraKey || '';
        this.dependencies = data.dependencies || [];
        this.status = data.status || '';
        this.attachments = data.attachments || [];
        this.comments = data.comments || [];
        this.relatedContext = data.relatedContext || null;
    }

    /**
     * Update multiple ticket properties at once
     * @param data - Object containing properties to update
     * @returns This instance for chaining
     */
    update(data: Partial<JiraTicketData & { implementationDetails?: string; testStrategyTdd?: string }> = {}): JiraTicket {
        if (data.title !== undefined) {
            this.title = data.title;
        }

        if (data.description !== undefined) {
            this.description = data.description;
        }

        if (
            data.details !== undefined ||
            data.implementationDetails !== undefined
        ) {
            this.details = data.details || data.implementationDetails || '';
        }

        if (data.acceptanceCriteria !== undefined) {
            this.acceptanceCriteria = data.acceptanceCriteria;
        }

        if (data.testStrategy !== undefined || data.testStrategyTdd !== undefined) {
            this.testStrategy = data.testStrategy || data.testStrategyTdd || '';
        }

        if (data.priority !== undefined) {
            this.priority = data.priority
                ? data.priority.charAt(0).toUpperCase() + data.priority.slice(1)
                : 'Medium';
        }

        if (data.issueType !== undefined) {
            this.issueType = data.issueType || 'Task';
        }

        if (data.parentKey !== undefined) {
            this.parentKey = data.parentKey;
        }

        if (data.labels !== undefined) {
            this.labels = Array.isArray(data.labels) ? data.labels : [];
        }

        if (data.assignee !== undefined) {
            this.assignee = data.assignee;
        }

        if (data.jiraKey !== undefined) {
            this.jiraKey = data.jiraKey;
        }

        if (data.dependencies !== undefined) {
            this.dependencies = Array.isArray(data.dependencies)
                ? data.dependencies
                : [];
        }

        if (data.status !== undefined) {
            this.status = data.status;
        }

        if (data.attachments !== undefined) {
            this.attachments = Array.isArray(data.attachments)
                ? data.attachments
                : [];
        }

        if (data.comments !== undefined) {
            this.comments = Array.isArray(data.comments) ? data.comments : [];
        }

        if (data.relatedContext !== undefined) {
            this.relatedContext = data.relatedContext;
        }

        return this;
    }

    /**
     * Add a single label
     * @param label - Label to add
     * @returns This instance for chaining
     */
    addLabel(label: string): JiraTicket {
        if (label && !this.labels.includes(label)) {
            this.labels.push(label);
        }
        return this;
    }

    /**
     * Add a single dependency
     * @param key - Issue key this ticket depends on
     * @returns This instance for chaining
     */
    addDependency(key: string): JiraTicket {
        if (key && !this.dependencies.includes(key)) {
            this.dependencies.push(key);
        }
        return this;
    }

    /**
     * Add context information to the ticket
     * @param context - Context data to add
     * @returns This instance for chaining
     */
    addContext(context: any): JiraTicket {
        if (context) {
            this.relatedContext = context;
        }
        return this;
    }

    /**
     * Format context for MCP tool responses
     * @returns Formatted context or null if no context
     */
    getFormattedContext(): any {
        if (!this.relatedContext) {
            return null;
        }

        return {
            summary: this.relatedContext.summary,
            relatedTickets: this.relatedContext.tickets.map((item: any) => ({
                key: item.ticket.key,
                title: item.ticket.title,
                status: item.ticket.status,
                relationship: item.relationship
            }))
        };
    }

    /**
     * Normalize markdown text by handling various formatting edge cases
     * @param text - Markdown text to normalize
     * @returns Normalized markdown text
     */
    private _normalizeMarkdown(text: string): string {
        if (!text) return '';

        // Convert to string if not already
        text = String(text);

        // Handle common markdown edge cases
        text = text
            // Normalize line endings
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Fix multiple consecutive newlines
            .replace(/\n{3,}/g, '\n\n')
            // Ensure headers have proper spacing
            .replace(/^(#{1,6})\s*(.+)$/gm, '$1 $2')
            // Ensure list items have proper spacing
            .replace(/^(\s*[-*+])\s*(.+)$/gm, '$1 $2')
            .replace(/^(\s*\d+\.)\s*(.+)$/gm, '$1 $2')
            // Clean up extra whitespace
            .replace(/[ \t]+$/gm, '') // Remove trailing whitespace
            .replace(/^\s*\n/, '') // Remove leading newlines
            .replace(/\n\s*$/, ''); // Remove trailing newlines and whitespace

        return text;
    }

    /**
     * Convert markdown text to Atlassian Document Format (ADF)
     * @param text - Markdown text to convert
     * @returns ADF document object
     */
    private _convertMarkdownToAdf(text: string): ADFDocument {
        if (!text) {
            return {
                version: 1,
                type: 'doc',
                content: []
            };
        }

        const normalizedText = this._normalizeMarkdown(text);
        const nodes = this._parseMarkdownToNodes(normalizedText);

        return {
            version: 1,
            type: 'doc',
            content: nodes
        };
    }

    /**
     * Parse markdown text into ADF nodes
     * @param text - Markdown text to parse
     * @returns Array of ADF nodes
     */
    private _parseMarkdownToNodes(text: string): ADFNode[] {
        if (!text) return [];

        const lines = text.split('\n');
        const nodes: ADFNode[] = [];
        let currentParagraph: string[] = [];
        let inCodeBlock = false;
        let codeBlockLanguage = '';
        let codeBlockContent: string[] = [];

        const flushParagraph = () => {
            if (currentParagraph.length > 0) {
                const paragraphText = currentParagraph.join('\n').trim();
                if (paragraphText) {
                    const content = this._parseInlineFormatting(paragraphText);
                    if (content.length > 0) {
                        nodes.push({
                            type: 'paragraph',
                            content
                        });
                    }
                }
                currentParagraph = [];
            }
        };

        const flushCodeBlock = () => {
            if (codeBlockContent.length > 0) {
                const codeText = codeBlockContent.join('\n');
                nodes.push({
                    type: 'codeBlock',
                    attrs: { language: codeBlockLanguage || null },
                    content: [
                        {
                            type: 'text',
                            text: codeText
                        }
                    ]
                });
                codeBlockContent = [];
                codeBlockLanguage = '';
            }
        };

        for (const line of lines) {
            // Handle code blocks
            if (line.startsWith('```')) {
                if (!inCodeBlock) {
                    flushParagraph();
                    inCodeBlock = true;
                    codeBlockLanguage = line.substring(3).trim();
                } else {
                    flushCodeBlock();
                    inCodeBlock = false;
                }
                continue;
            }

            if (inCodeBlock) {
                codeBlockContent.push(line);
                continue;
            }

            // Handle headers
            const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headerMatch) {
                flushParagraph();
                const level = headerMatch[1].length;
                const headerText = headerMatch[2];
                nodes.push({
                    type: 'heading',
                    attrs: { level },
                    content: this._parseInlineFormatting(headerText)
                });
                continue;
            }

            // Handle bullet lists
            const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
            if (bulletMatch) {
                flushParagraph();
                const indent = bulletMatch[1].length;
                const listText = bulletMatch[2];
                
                // Create or find existing bullet list
                let bulletList = nodes[nodes.length - 1];
                if (!bulletList || bulletList.type !== 'bulletList') {
                    bulletList = {
                        type: 'bulletList',
                        content: []
                    };
                    nodes.push(bulletList);
                }

                bulletList.content!.push({
                    type: 'listItem',
                    content: [
                        {
                            type: 'paragraph',
                            content: this._parseInlineFormatting(listText)
                        }
                    ]
                });
                continue;
            }

            // Handle numbered lists
            const numberedMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
            if (numberedMatch) {
                flushParagraph();
                const indent = numberedMatch[1].length;
                const listText = numberedMatch[2];
                
                // Create or find existing ordered list
                let orderedList = nodes[nodes.length - 1];
                if (!orderedList || orderedList.type !== 'orderedList') {
                    orderedList = {
                        type: 'orderedList',
                        content: []
                    };
                    nodes.push(orderedList);
                }

                orderedList.content!.push({
                    type: 'listItem',
                    content: [
                        {
                            type: 'paragraph',
                            content: this._parseInlineFormatting(listText)
                        }
                    ]
                });
                continue;
            }

            // Handle empty lines (paragraph breaks)
            if (line.trim() === '') {
                flushParagraph();
                continue;
            }

            // Regular paragraph content
            currentParagraph.push(line);
        }

        // Flush any remaining content
        flushParagraph();
        if (inCodeBlock) {
            flushCodeBlock();
        }

        return nodes;
    }

    /**
     * Parse inline formatting (bold, italic, code, links) in text
     * @param text - Text to parse for inline formatting
     * @returns Array of ADF nodes with inline formatting
     */
    private _parseInlineFormatting(text: string): ADFNode[] {
        if (!text) return [];

        // Process inline formatting
        const processed = this._processInlineFormatting(text);
        
        // If no formatting was found, return simple text node
        if (typeof processed === 'string') {
            return [{ type: 'text', text: processed }];
        }

        return processed;
    }

    /**
     * Process inline formatting recursively
     * @param text - Text to process
     * @returns Processed text or array of nodes
     */
    private _processInlineFormatting(text: string): string | ADFNode[] {
        if (!text) return text;

        // Handle inline code first (highest precedence)
        const codeMatch = text.match(/^(.*?)`([^`]+)`(.*)$/);
        if (codeMatch) {
            const before = codeMatch[1];
            const codeText = codeMatch[2];
            const after = codeMatch[3];
            
            const result: ADFNode[] = [];
            
            if (before) {
                const beforeProcessed = this._processInlineFormatting(before);
                if (typeof beforeProcessed === 'string') {
                    result.push({ type: 'text', text: beforeProcessed });
                } else {
                    result.push(...beforeProcessed);
                }
            }
            
            result.push({
                type: 'text',
                text: codeText,
                marks: [{ type: 'code' }]
            });
            
            if (after) {
                const afterProcessed = this._processInlineFormatting(after);
                if (typeof afterProcessed === 'string') {
                    result.push({ type: 'text', text: afterProcessed });
                } else {
                    result.push(...afterProcessed);
                }
            }
            
            return result;
        }

        // Handle links
        const linkMatch = text.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/);
        if (linkMatch) {
            const before = linkMatch[1];
            const linkText = linkMatch[2];
            const linkUrl = linkMatch[3];
            const after = linkMatch[4];
            
            const result: ADFNode[] = [];
            
            if (before) {
                const beforeProcessed = this._processInlineFormatting(before);
                if (typeof beforeProcessed === 'string') {
                    result.push({ type: 'text', text: beforeProcessed });
                } else {
                    result.push(...beforeProcessed);
                }
            }
            
            result.push({
                type: 'text',
                text: linkText,
                marks: [{ type: 'link', attrs: { href: linkUrl } }]
            });
            
            if (after) {
                const afterProcessed = this._processInlineFormatting(after);
                if (typeof afterProcessed === 'string') {
                    result.push({ type: 'text', text: afterProcessed });
                } else {
                    result.push(...afterProcessed);
                }
            }
            
            return result;
        }

        // Handle bold text
        const boldMatch = text.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/);
        if (boldMatch) {
            const before = boldMatch[1];
            const boldText = boldMatch[2];
            const after = boldMatch[3];
            
            const result: ADFNode[] = [];
            
            if (before) {
                const beforeProcessed = this._processInlineFormatting(before);
                if (typeof beforeProcessed === 'string') {
                    result.push({ type: 'text', text: beforeProcessed });
                } else {
                    result.push(...beforeProcessed);
                }
            }
            
            result.push({
                type: 'text',
                text: boldText,
                marks: [{ type: 'strong' }]
            });
            
            if (after) {
                const afterProcessed = this._processInlineFormatting(after);
                if (typeof afterProcessed === 'string') {
                    result.push({ type: 'text', text: afterProcessed });
                } else {
                    result.push(...afterProcessed);
                }
            }
            
            return result;
        }

        // Handle italic text
        const italicMatch = text.match(/^(.*?)\*([^*]+)\*(.*)$/);
        if (italicMatch) {
            const before = italicMatch[1];
            const italicText = italicMatch[2];
            const after = italicMatch[3];
            
            const result: ADFNode[] = [];
            
            if (before) {
                const beforeProcessed = this._processInlineFormatting(before);
                if (typeof beforeProcessed === 'string') {
                    result.push({ type: 'text', text: beforeProcessed });
                } else {
                    result.push(...beforeProcessed);
                }
            }
            
            result.push({
                type: 'text',
                text: italicText,
                marks: [{ type: 'em' }]
            });
            
            if (after) {
                const afterProcessed = this._processInlineFormatting(after);
                if (typeof afterProcessed === 'string') {
                    result.push({ type: 'text', text: afterProcessed });
                } else {
                    result.push(...afterProcessed);
                }
            }
            
            return result;
        }

        // No formatting found, return as-is
        return text;
    }

    /**
     * Create a panel with given type, title, and content
     * @param panelType - Type of panel ('info', 'note', 'warning', 'error', 'success')
     * @param title - Panel title
     * @param content - Panel content in markdown
     * @returns ADF panel node
     */
    private _createPanel(panelType: string, title: string, content: string): ADFNode {
        const panelContent: ADFNode[] = [];
        
        if (title) {
            panelContent.push({
                type: 'paragraph',
                content: [
                    {
                        type: 'text',
                        text: title,
                        marks: [{ type: 'strong' }]
                    }
                ]
            });
        }
        
        if (content) {
            const contentNodes = this._parseMarkdownToNodes(content);
            panelContent.push(...contentNodes);
        }
        
        return {
            type: 'panel',
            attrs: { panelType },
            content: panelContent
        };
    }

    /**
     * Convert ticket data to ADF format for Jira API
     * @returns ADF document
     */
    toADF(): ADFDocument {
        const content: ADFNode[] = [];

        // Add main description
        if (this.description) {
            const descriptionNodes = this._parseMarkdownToNodes(this.description);
            content.push(...descriptionNodes);
        }

        // Add implementation details panel
        if (this.details) {
            content.push(this._createPanel('info', 'Implementation Details', this.details));
        }

        // Add acceptance criteria panel
        if (this.acceptanceCriteria) {
            content.push(this._createPanel('success', 'Acceptance Criteria', this.acceptanceCriteria));
        }

        // Add test strategy panel
        if (this.testStrategy) {
            content.push(this._createPanel('note', 'Test Strategy (TDD)', this.testStrategy));
        }

        return {
            version: 1,
            type: 'doc',
            content
        };
    }

    /**
     * Convert to Jira API request format
     * @returns Jira create/update request data
     */
    toJiraRequestData(): JiraCreateIssueRequest {
        const fields: any = {
            project: {
                key: process.env.JIRA_PROJECT || 'PROJ'
            },
            summary: this.title,
            description: this.toADF(),
            issuetype: {
                name: this.issueType
            }
        };

        // Add priority if specified
        if (this.priority && this.priority !== 'Medium') {
            fields.priority = {
                name: this.priority
            };
        }

        // Add assignee if specified
        if (this.assignee) {
            fields.assignee = {
                accountId: this.assignee
            };
        }

        // Add parent if this is a subtask
        if (this.parentKey) {
            fields.parent = {
                key: this.parentKey
            };
        }

        // Add labels if any
        if (this.labels && this.labels.length > 0) {
            fields.labels = this.labels;
        }

        return { fields };
    }

    /**
     * Convert to Task Master format
     * @returns Task Master task object
     */
    toTaskMasterFormat(): TaskMasterTask {
        return {
            id: this.jiraKey,
            jiraKey: this.jiraKey,
            title: this.title,
            description: this.description,
            status: this.status,
            priority: this.priority.toLowerCase(),
            assignee: this.assignee,
            labels: this.labels,
            dependencies: this.dependencies,
            subtasks: [], // Will be populated externally if needed
            parentKey: this.parentKey,
            issueType: this.issueType,
            created: '', // Will be populated from Jira data
            updated: '', // Will be populated from Jira data
            acceptanceCriteria: this.acceptanceCriteria,
            testStrategy: this.testStrategy,
            details: this.details,
            attachments: this.attachments,
            comments: this.comments,
            relatedContext: this.relatedContext
        };
    }

    /**
     * Extract panels from ADF description
     * @param description - ADF description object
     * @returns Object with extracted panel content
     */
    static extractPanelsFromDescription(description: any): { details: string; acceptanceCriteria: string; testStrategy: string; mainDescription: string } {
        const result = {
            details: '',
            acceptanceCriteria: '',
            testStrategy: '',
            mainDescription: ''
        };

        if (!description || !description.content) {
            return result;
        }

        const mainContent: any[] = [];

        for (const node of description.content) {
            if (node.type === 'panel') {
                const panelText = this.extractTextFromNodes(node.content || []);
                const panelType = node.attrs?.panelType;
                
                // Extract title and content
                let title = '';
                let content = panelText;
                
                if (node.content && node.content.length > 0) {
                    const firstNode = node.content[0];
                    if (firstNode.type === 'paragraph' && firstNode.content && firstNode.content.length > 0) {
                        const firstText = firstNode.content[0];
                        if (firstText.marks && firstText.marks.some((mark: any) => mark.type === 'strong')) {
                            title = firstText.text || '';
                            // Extract remaining content after title
                            const remainingNodes = [...node.content];
                            remainingNodes.shift(); // Remove title paragraph
                            content = this.extractTextFromNodes(remainingNodes);
                        }
                    }
                }

                // Categorize based on title and panel type
                const titleLower = title.toLowerCase();
                
                if (titleLower.includes('implementation') || titleLower.includes('details')) {
                    result.details = content;
                } else if (titleLower.includes('acceptance') || titleLower.includes('criteria')) {
                    result.acceptanceCriteria = content;
                } else if (titleLower.includes('test') || titleLower.includes('tdd')) {
                    result.testStrategy = content;
                } else {
                    // Fallback based on panel type
                    if (panelType === 'info' && !result.details) {
                        result.details = content;
                    } else if (panelType === 'success' && !result.acceptanceCriteria) {
                        result.acceptanceCriteria = content;
                    } else if (panelType === 'note' && !result.testStrategy) {
                        result.testStrategy = content;
                    }
                }
            } else {
                mainContent.push(node);
            }
        }

        result.mainDescription = this.extractTextFromNodes(mainContent);
        return result;
    }

    /**
     * Extract text content from ADF nodes
     * @param nodes - Array of ADF nodes
     * @returns Plain text string
     */
    static extractTextFromNodes(nodes: ADFNode[], isInlineParagraph = false): string {
        if (!nodes || !Array.isArray(nodes)) {
            return '';
        }

        const textParts: string[] = [];

        for (const node of nodes) {
            switch (node.type) {
                case 'paragraph':
                    if (node.content) {
                        // For paragraph content, join text nodes without line breaks
                        const paragraphText = this.extractTextFromNodes(node.content, true);
                        if (paragraphText.trim()) {
                            textParts.push(paragraphText);
                        }
                    }
                    break;
                case 'text':
                    if (node.text) {
                        let text = node.text;
                        
                        // Apply formatting marks
                        if (node.marks && Array.isArray(node.marks)) {
                            for (const mark of node.marks) {
                                switch (mark.type) {
                                    case 'strong':
                                        text = `**${text}**`;
                                        break;
                                    case 'em':
                                        text = `*${text}*`;
                                        break;
                                    case 'code':
                                        text = `\`${text}\``;
                                        break;
                                    case 'link':
                                        const href = mark.attrs?.href || '#';
                                        text = `[${text}](${href})`;
                                        break;
                                    // Add other mark types as needed
                                }
                            }
                        }
                        
                        textParts.push(text);
                    }
                    break;
                case 'heading':
                    if (node.content) {
                        const level = node.attrs?.level || 1;
                        const headingText = this.extractTextFromNodes(node.content, true);
                        const headerPrefix = '#'.repeat(level);
                        textParts.push(`${headerPrefix} ${headingText}`);
                    }
                    break;
                case 'bulletList':
                    if (node.content) {
                        for (const listItem of node.content) {
                            if (listItem.type === 'listItem' && listItem.content) {
                                // List item content should be treated as a single line
                                const itemText = this.extractTextFromNodes(listItem.content, true);
                                if (itemText.trim()) {
                                    textParts.push(`- ${itemText}`);
                                }
                            }
                        }
                    }
                    break;
                case 'orderedList':
                    if (node.content) {
                        for (let i = 0; i < node.content.length; i++) {
                            const listItem = node.content[i];
                            if (listItem.type === 'listItem' && listItem.content) {
                                // List item content should be treated as a single line
                                const itemText = this.extractTextFromNodes(listItem.content, true);
                                if (itemText.trim()) {
                                    textParts.push(`${i + 1}. ${itemText}`);
                                }
                            }
                        }
                    }
                    break;
                case 'taskList':
                    if (node.content) {
                        for (const taskItem of node.content) {
                            if (taskItem.type === 'taskItem' && taskItem.content) {
                                // Convert task item to checkbox based on state
                                const itemText = this.extractTextFromNodes(taskItem.content, true);
                                if (itemText.trim()) {
                                    const isChecked = taskItem.attrs?.state === 'DONE';
                                    const checkbox = isChecked ? '[x]' : '[ ]';
                                    textParts.push(`- ${checkbox} ${itemText}`);
                                }
                            }
                        }
                    }
                    break;
                case 'codeBlock':
                    if (node.content) {
                        const codeText = this.extractTextFromNodes(node.content, true);
                        const language = node.attrs?.language || '';
                        textParts.push(`\`\`\`${language}\n${codeText}\n\`\`\``);
                    }
                    break;
                default:
                    if (node.content) {
                        const nestedText = this.extractTextFromNodes(node.content);
                        if (nestedText.trim()) {
                            textParts.push(nestedText);
                        }
                    }
                    break;
            }
        }

        // If we're processing inline paragraph content, join without line breaks
        // Otherwise, join with appropriate line breaks for block-level elements
        if (isInlineParagraph) {
            return textParts.join('');
        } else {
            // For block-level elements, we need to be smarter about spacing
            // List items should be separated by single newlines, other blocks by double newlines
            let result = '';
            for (let i = 0; i < textParts.length; i++) {
                const part = textParts[i];
                if (i > 0) {
                    // If current or previous part is a list item, use single newline
                    const isCurrentListItem = part.startsWith('- ') || /^\d+\. /.test(part);
                    const isPreviousListItem = textParts[i - 1].startsWith('- ') || /^\d+\. /.test(textParts[i - 1]);
                    
                    if (isCurrentListItem || isPreviousListItem) {
                        result += '\n';
                    } else {
                        result += '\n\n';
                    }
                }
                result += part;
            }
            return result.trim();
        }
    }

    /**
     * Extract plain text description from ADF, excluding panels
     * @param description - ADF description object
     * @returns Plain text description
     */
    static extractPlainTextDescription(description: any): string {
        if (!description || !description.content) {
            return '';
        }

        const nonPanelNodes = description.content.filter((node: any) => node.type !== 'panel');
        return this.extractTextFromNodes(nonPanelNodes);
    }

    /**
     * Parse structured description from full description text
     * @param fullDescription - Full description text
     * @returns Parsed description components
     */
    static parseStructuredDescription(fullDescription: string): { description: string; details: string; acceptanceCriteria: string; testStrategy: string } {
        if (!fullDescription) {
            return {
                description: '',
                details: '',
                acceptanceCriteria: '',
                testStrategy: ''
            };
        }

        const lines = fullDescription.split('\n');
        const result = {
            description: '',
            details: '',
            acceptanceCriteria: '',
            testStrategy: ''
        };

        let currentSection = 'description';
        let currentContent: string[] = [];

        const flushSection = () => {
            const content = currentContent.join('\n').trim();
            if (content) {
                switch (currentSection) {
                    case 'description':
                        result.description = content;
                        break;
                    case 'details':
                        result.details = content;
                        break;
                    case 'acceptanceCriteria':
                        result.acceptanceCriteria = content;
                        break;
                    case 'testStrategy':
                        result.testStrategy = content;
                        break;
                }
            }
            currentContent = [];
        };

        for (const line of lines) {
            const lowerLine = line.toLowerCase().trim();
            
            // Check for section headers
            if (this._isImplementationDetailsHeader(lowerLine)) {
                flushSection();
                currentSection = 'details';
                continue;
            } else if (this._isAcceptanceCriteriaHeader(lowerLine)) {
                flushSection();
                currentSection = 'acceptanceCriteria';
                continue;
            } else if (this._isTestStrategyHeader(lowerLine)) {
                flushSection();
                currentSection = 'testStrategy';
                continue;
            }

            // Add line to current section
            currentContent.push(line);
        }

        // Flush the last section
        flushSection();

        return result;
    }

    /**
     * Check if line is an implementation details header
     * @param lowerLine - Lowercase line to check
     * @returns True if it's an implementation details header
     */
    static _isImplementationDetailsHeader(lowerLine: string): boolean {
        return lowerLine.includes('implementation') && 
               (lowerLine.includes('detail') || lowerLine.includes('spec') || lowerLine.includes('technical'));
    }

    /**
     * Check if line is an acceptance criteria header
     * @param lowerLine - Lowercase line to check
     * @returns True if it's an acceptance criteria header
     */
    static _isAcceptanceCriteriaHeader(lowerLine: string): boolean {
        return (lowerLine.includes('acceptance') && lowerLine.includes('criteria')) ||
               lowerLine.includes('requirements') ||
               (lowerLine.includes('done') && lowerLine.includes('when'));
    }

    /**
     * Check if line is a test strategy header
     * @param lowerLine - Lowercase line to check
     * @returns True if it's a test strategy header
     */
    static _isTestStrategyHeader(lowerLine: string): boolean {
        return (lowerLine.includes('test') && 
                (lowerLine.includes('strategy') || lowerLine.includes('plan') || lowerLine.includes('approach'))) ||
               lowerLine.includes('tdd') ||
               (lowerLine.includes('testing') && lowerLine.includes('strategy'));
    }

    /**
     * Extract non-panel content from description
     * @param description - Description content
     * @returns Non-panel content
     */
    static _extractNonPanelContent(description: string): string {
        // This is a simplified implementation
        // In a full implementation, you'd parse the ADF and extract non-panel nodes
        const lines = description.split('\n');
        const nonPanelLines = lines.filter(line => {
            const lowerLine = line.toLowerCase().trim();
            return !this._isImplementationDetailsHeader(lowerLine) &&
                   !this._isAcceptanceCriteriaHeader(lowerLine) &&
                   !this._isTestStrategyHeader(lowerLine);
        });
        return nonPanelLines.join('\n').trim();
    }

    /**
     * Extract comments from Jira comment objects
     * @param comments - Array of Jira comment objects
     * @returns Array of simplified comment objects
     */
    static extractCommentsFromJira(comments: JiraComment[]): any[] {
        if (!comments || !Array.isArray(comments)) {
            return [];
        }

        return comments.map(comment => ({
            id: comment.id,
            author: comment.author?.displayName || 'Unknown',
            authorEmail: comment.author?.emailAddress || '',
            body: this.extractTextFromNodes(comment.body?.content || []),
            created: comment.created,
            updated: comment.updated
        }));
    }

    /**
     * Convert string to camelCase
     * @param str - String to convert
     * @returns CamelCase string
     */
    static convertToCamelCase(str: string): string {
        return str
            .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => {
                return index === 0 ? word.toLowerCase() : word.toUpperCase();
            })
            .replace(/\s+/g, '');
    }

    /**
     * Convert Jira priority to Task Master format
     * @param jiraPriority - Jira priority object
     * @returns Task Master priority string
     */
    static convertJiraPriorityToTaskMaster(jiraPriority: any): string {
        if (!jiraPriority || !jiraPriority.name) {
            return 'medium';
        }
        return jiraPriority.name.toLowerCase();
    }

    /**
     * Convert Jira status to Task Master format
     * @param jiraStatus - Jira status object
     * @returns Task Master status string
     */
    static convertJiraStatusToTaskMaster(jiraStatus: any): string {
        if (!jiraStatus || !jiraStatus.name) {
            return 'pending';
        }

        const statusName = jiraStatus.name.toLowerCase();
        
        // Map common Jira statuses to Task Master statuses
        if (statusName.includes('done') || statusName.includes('closed') || statusName.includes('resolved')) {
            return 'done';
        } else if (statusName.includes('review')) {
            return 'in-review';
        } else if (statusName.includes('progress') || statusName.includes('development')) {
            return 'in-progress';
        } else {
            return 'pending';
        }
    }

    /**
     * Create JiraTicket from Task Master task data
     * @param task - Task Master task object
     * @returns JiraTicket instance
     */
    static fromTaskMaster(task: TaskMasterTask): JiraTicket {
        return new JiraTicket({
            title: task.title,
            description: task.description,
            details: task.details,
            acceptanceCriteria: task.acceptanceCriteria,
            testStrategy: task.testStrategy,
            priority: task.priority,
            issueType: task.issueType,
            parentKey: task.parentKey,
            labels: task.labels,
            jiraKey: task.jiraKey,
            dependencies: task.dependencies,
            status: task.status,
            attachments: task.attachments,
            comments: task.comments
        });
    }

    /**
     * Create JiraTicket from Jira issue data
     * @param jiraIssue - Jira issue object
     * @returns JiraTicket instance
     */
    static async fromJiraIssue(jiraIssue: JiraIssue): Promise<JiraTicket> {
        const fields = jiraIssue.fields;
        
        // Extract structured content from description
        const panels = this.extractPanelsFromDescription(fields.description);
        
        const ticket = new JiraTicket({
            title: fields.summary,
            description: panels.mainDescription,
            details: panels.details,
            acceptanceCriteria: panels.acceptanceCriteria,
            testStrategy: panels.testStrategy,
            priority: this.convertJiraPriorityToTaskMaster(fields.priority),
            issueType: fields.issuetype.name,
            parentKey: fields.parent?.key || '',
            labels: fields.labels || [],
            assignee: fields.assignee?.accountId || '',
            jiraKey: jiraIssue.key,
            status: this.convertJiraStatusToTaskMaster(fields.status),
            attachments: fields.attachment || [],
            comments: this.extractCommentsFromJira(fields.comment?.comments || [])
        });

        return ticket;
    }

    /**
     * Convert the ticket to markdown format for LLM processing
     * @returns Markdown representation of the ticket
     */
    toMarkdown(): string {
        let markdown = '';
        
        // Title
        if (this.title) {
            markdown += `## Title\n${this.title}\n\n`;
        }
        
        // Description
        if (this.description) {
            markdown += `## Description\n${this.description}\n\n`;
        }
        
        // Implementation Details
        if (this.details) {
            markdown += `## Implementation Details\n${this.details}\n\n`;
        }
        
        // Acceptance Criteria
        if (this.acceptanceCriteria) {
            markdown += `## Acceptance Criteria\n${this.acceptanceCriteria}\n\n`;
        }
        
        // Test Strategy
        if (this.testStrategy) {
            markdown += `## Test Strategy (TDD)\n${this.testStrategy}\n\n`;
        }
        
        return markdown.trim();
    }

    /**
     * Create a JiraTicket from markdown format
     * @param markdown - Markdown representation of the ticket
     * @returns New JiraTicket instance
     */
    static fromMarkdown(markdown: string): JiraTicket {
        const sections: { [key: string]: string } = {};
        
        // Split markdown into sections
        const lines = markdown.split('\n');
        let currentSection = '';
        let currentContent: string[] = [];
        
        for (const line of lines) {
            // Check if this is a section header
            if (line.startsWith('## ')) {
                // Save previous section if it exists
                if (currentSection && currentContent.length > 0) {
                    sections[currentSection] = currentContent.join('\n').trim();
                }
                
                // Start new section
                currentSection = line.slice(3).trim().toLowerCase();
                currentContent = [];
            } else if (currentSection) {
                // Add line to current section
                currentContent.push(line);
            }
        }
        
        // Save final section
        if (currentSection && currentContent.length > 0) {
            sections[currentSection] = currentContent.join('\n').trim();
        }
        
        // Map sections to ticket properties
        return new JiraTicket({
            title: sections['title'] || '',
            description: sections['description'] || '',
            details: sections['implementation details'] || '',
            acceptanceCriteria: sections['acceptance criteria'] || '',
            testStrategy: sections['test strategy (tdd)'] || sections['test strategy'] || ''
        });
    }

    } 