/**
 * tools/get-jira-attachment.ts
 * Tool to get Jira attachments with automatic file type detection and text extraction
 */

import { z } from 'zod';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { logger } from '../../utils/logger';
import { JiraClient } from '../../utils/jira/jira-client';
import { createErrorResponse } from '../../utils/utils';
import { useSessionConfigs } from '../../utils/config';

export function registerGetJiraAttachmentTool(server: McpServer, getSessionConfig?: () => any): void {

    server.registerTool('get_jira_attachment', {
        title: 'Get Jira Attachment',
        description: 'Get Jira attachments with automatic file type detection and text extraction. Images return as base64, documents/code files return extracted text content.',
        inputSchema: {
            ticketId: z
                .string()
                .describe(
                    'The Jira ticket ID to fetch attachments from (e.g., PROJ-123). Required if attachmentId is not provided.'
                ),
            attachmentId: z
                .string()
                .optional()
                .describe(
                    'The specific attachment ID to fetch. If provided, only this attachment will be fetched.'
                ),
            thumbnail: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    'Whether to fetch thumbnails instead of full images (images only)'
                ),
            fileTypes: z
                .array(z.string())
                .optional()
                .describe(
                    'Filter attachments by file types: "image", "document", "code", "text". If not specified, all supported types are included.'
                ),
            imagesOnly: z
                .boolean()
                .optional()
                .default(false)
                .describe('Legacy compatibility: if true, only fetch image attachments')
        },
    }, async (args: {
        ticketId: string;
        attachmentId?: string;
        thumbnail?: boolean;
        fileTypes?: string[];
        imagesOnly?: boolean;
    }) => {
        try {
            // Get configurations using the shared config hook
            const { jiraConfig } = useSessionConfigs(getSessionConfig, logger);

            const {
                ticketId,
                attachmentId,
                thumbnail = false,
                fileTypes,
                imagesOnly = false
            } = args;

            // Validate required parameters
            if (!ticketId && !attachmentId) {
                logger.error('Either ticketId or attachmentId must be provided');
                return createErrorResponse('Either ticketId or attachmentId must be provided');
            }

            logger.info(
                `Getting Jira attachments from ticket: ${ticketId} (thumbnail: ${thumbnail}, types: ${fileTypes ? fileTypes.join(',') : 'all'})`
            );

            // Initialize the JiraClient with session-specific configuration
            const jiraClient = new JiraClient(jiraConfig);

            // Check if Jira is enabled
            if (!jiraClient.isReady()) {
                logger.error('Jira integration is not properly configured');
                return createErrorResponse('Jira integration is not properly configured');
            }

            // Get attachment metadata
            logger.info(`Fetching attachment metadata for issue: ${ticketId}`);
            const metadataResult = await jiraClient.fetchAttachmentMetadata(ticketId, { log: logger });

            if (!metadataResult.success) {
                logger.error(`Failed to fetch attachment metadata: ${metadataResult.error?.message || 'Unknown error'}`);
                return createErrorResponse(`Failed to fetch Jira ticket ${ticketId}: ${metadataResult.error?.message || 'Unknown error'}`);
            }

            if (!metadataResult.data.attachments || metadataResult.data.attachments.length === 0) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Jira ticket ${ticketId} has no attachments`
                    }]
                };
            }

            let attachmentsToProcess = metadataResult.data.attachments;

            // Filter by specific attachment ID if provided
            if (attachmentId) {
                attachmentsToProcess = attachmentsToProcess.filter(
                    (att: any) => att.id === attachmentId
                );
                if (attachmentsToProcess.length === 0) {
                    return createErrorResponse(`Attachment ${attachmentId} not found in ticket ${ticketId}`);
                }
            }

            // Filter by file types if specified
            if (imagesOnly) {
                attachmentsToProcess = attachmentsToProcess.filter(
                    (att: any) => att.mimeType && att.mimeType.startsWith('image/')
                );
            } else if (fileTypes && fileTypes.length > 0) {
                attachmentsToProcess = attachmentsToProcess.filter((att: any) => {
                    const type = detectFileType(att.mimeType, att.filename);
                    return fileTypes.includes(type);
                });
            }

            if (attachmentsToProcess.length === 0) {
                return {
                    content: [{
                        type: 'text' as const,
                        text: `No matching attachments found in ticket ${ticketId}`
                    }]
                };
            }

            logger.info(`Processing ${attachmentsToProcess.length} attachment(s)...`);

            const content: Array<{
                type: 'text';
                text: string;
            } | {
                type: 'image';
                data: string;
                mimeType: string;
            }> = [];
            const errors: any[] = [];

            // Add summary header
            content.push({
                type: 'text' as const,
                text: `Found ${attachmentsToProcess.length} attachment(s) in Jira ticket ${ticketId}:`
            });

            // Process each attachment
            for (let i = 0; i < attachmentsToProcess.length; i++) {
                const attachment = attachmentsToProcess[i];
                logger.info(`Processing attachment ${i + 1}/${attachmentsToProcess.length}: ${attachment.filename}`);

                try {
                    const result = await processAttachment(
                        attachment,
                        jiraClient,
                        { thumbnail },
                        logger
                    );

                    if (result.success) {
                        // Add attachment info
                        content.push({
                            type: 'text' as const,
                            text: `\nAttachment ${i + 1}: ${result.filename} (${result.mimeType}, ${Math.round(result.size / 1024)}KB)`
                        });

                        // Add content based on type
                        if (result.contentType === 'image') {
                            content.push({
                                type: 'image' as const,
                                data: result.base64,
                                mimeType: result.mimeType
                            });
                        } else if (result.contentType === 'text') {
                            content.push({
                                type: 'text' as const,
                                text: `--- File Content ---\n${result.content}`
                            });
                        }
                    } else {
                        errors.push({
                            filename: attachment.filename,
                            error: result.error
                        });
                    }
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    logger.error(`Error processing attachment ${attachment.filename}: ${errorMessage}`);
                    errors.push({
                        filename: attachment.filename,
                        error: errorMessage
                    });
                }
            }

            // Add error summary if needed
            if (errors.length > 0) {
                content.push({
                    type: 'text' as const,
                    text: `\n--- Processing Errors ---`
                });
                errors.forEach((error, index) => {
                    content.push({
                        type: 'text' as const,
                        text: `Error ${index + 1}: ${error.filename} - ${error.error}`
                    });
                });
            }

            logger.info(`Attachment processing completed. Successfully processed ${attachmentsToProcess.length - errors.length} out of ${attachmentsToProcess.length} attachments`);

            return { content };
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error(`Error in get-jira-attachment tool: ${errorMessage}\n${errorStack}`);
            return createErrorResponse(`Failed to get Jira attachments: ${errorMessage}`);
        }
    });
}

// Simple file type detection
function detectFileType(mimeType: string, filename: string): string {
    if (mimeType && mimeType.startsWith('image/')) return 'image';

    const documentTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/msword'
    ];
    if (documentTypes.includes(mimeType)) return 'document';

    if (mimeType && mimeType.startsWith('text/')) return 'code';

    if (filename) {
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        const codeExts = [
            '.js',
            '.ts',
            '.py',
            '.java',
            '.html',
            '.css',
            '.json',
            '.md',
            '.txt'
        ];
        if (codeExts.includes(ext)) return 'code';
    }

    return 'other';
}

// Process a single attachment
async function processAttachment(
    attachment: any,
    jiraClient: JiraClient,
    options: { thumbnail?: boolean },
    log: typeof logger
): Promise<any> {
    try {
        log.info(`Processing attachment: ${attachment.filename} (${attachment.mimeType})`);

        // Download the attachment
        log.info(`Downloading attachment: ${attachment.id}`);

        const downloadResult = await jiraClient.fetchAttachmentAsBase64(
            attachment.id,
            {
                log: log,
                thumbnail: options.thumbnail || false,
                compress: false
            }
        );

        if (!downloadResult.success) {
            return {
                success: false,
                error: `Download failed: ${downloadResult.error?.message || 'Unknown error'}`
            };
        }

        const fileType = detectFileType(attachment.mimeType, attachment.filename);

        // Handle images
        if (fileType === 'image') {
            return {
                success: true,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
                contentType: 'image',
                base64: downloadResult.data.base64
            };
        }

        // Handle text/document files
        if (fileType === 'document' || fileType === 'code') {
            const buffer = Buffer.from(downloadResult.data.base64, 'base64');
            const textResult = await extractText(
                buffer,
                attachment.mimeType,
                attachment.filename,
                log
            );

            return {
                success: true,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
                contentType: 'text',
                content:
                    textResult.text ||
                    `[Could not extract text: ${textResult.error || 'Unknown error'}]`
            };
        }

        return {
            success: false,
            error: `Unsupported file type: ${fileType}`
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.error(`Attachment processing failed: ${errorMessage}`);
        return {
            success: false,
            error: errorMessage
        };
    }
}

// Simple text extraction
async function extractText(
    buffer: Buffer,
    mimeType: string,
    filename: string,
    log: typeof logger
): Promise<{ text?: string; error?: string }> {
    // Helper function to suppress console output from external libraries
    const suppressConsoleOutput = async (fn: () => Promise<any>) => {
        const originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            info: console.info,
            debug: console.debug
        };

        // Suppress all console output
        console.log = () => {};
        console.warn = () => {};
        console.error = () => {};
        console.info = () => {};
        console.debug = () => {};

        try {
            return await fn();
        } finally {
            // Restore original console methods
            console.log = originalConsole.log;
            console.warn = originalConsole.warn;
            console.error = originalConsole.error;
            console.info = originalConsole.info;
            console.debug = originalConsole.debug;
        }
    };

    try {
        // PDF files
        if (mimeType === 'application/pdf') {
            try {
                return await suppressConsoleOutput(async () => {
                    const unpdf = await import('unpdf');
                    const uint8Array = new Uint8Array(buffer);
                    const result = await unpdf.extractText(uint8Array);
                    return { text: result?.text || result || '' };
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return { error: `PDF extraction failed: ${errorMessage}` };
            }
        }

        // DOCX files
        if (
            mimeType ===
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ) {
            try {
                return await suppressConsoleOutput(async () => {
                    const mammoth = await import('mammoth');
                    const result = await mammoth.default.extractRawText({ buffer });
                    return { text: result.value };
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return { error: `DOCX extraction failed: ${errorMessage}` };
            }
        }

        // Excel files
        if (
            mimeType ===
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            mimeType === 'application/vnd.ms-excel'
        ) {
            try {
                return await suppressConsoleOutput(async () => {
                    const XLSX = await import('xlsx');
                    const workbook = XLSX.read(buffer, { type: 'buffer' });
                    const sheets: string[] = [];

                    workbook.SheetNames.forEach((sheetName) => {
                        const worksheet = workbook.Sheets[sheetName];
                        const sheetData = XLSX.utils.sheet_to_json(worksheet, {
                            header: 1,
                            defval: ''
                        });
                        const sheetText = sheetData
                            .filter((row: any) => row.some((cell: any) => cell !== ''))
                            .map((row: any) => row.join('\t'))
                            .join('\n');
                        if (sheetText.trim()) {
                            sheets.push(`=== Sheet: ${sheetName} ===\n${sheetText}`);
                        }
                    });

                    return { text: sheets.join('\n\n') };
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return { error: `Excel extraction failed: ${errorMessage}` };
            }
        }

        // Text/code files
        if ((mimeType && mimeType.startsWith('text/')) || isCodeFile(filename)) {
            try {
                return await suppressConsoleOutput(async () => {
                    const iconv = await import('iconv-lite');
                    let text;
                    try {
                        text = iconv.default.decode(buffer, 'utf8');
                        if (text.includes('\uFFFD')) throw new Error('Invalid UTF-8');
                    } catch {
                        text = iconv.default.decode(buffer, 'latin1');
                    }
                    return { text };
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                return { error: `Text extraction failed: ${errorMessage}` };
            }
        }

        return { error: 'Unsupported file type for text extraction' };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return { error: `Extraction failed: ${errorMessage}` };
    }
}

// Check if file is a code file
function isCodeFile(filename: string): boolean {
    const codeExts = [
        '.js',
        '.ts',
        '.py',
        '.java',
        '.html',
        '.css',
        '.json',
        '.md',
        '.txt',
        '.log'
    ];
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return codeExts.includes(ext);
} 