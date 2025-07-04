import request from 'supertest';
import * as dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import { logger } from '../utils/logger';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { setupMcpServer } from '../server/mcpServer';

// Load environment variables from .env file
dotenv.config();

// NO MOCKING - This will call REAL Jira APIs!

describe('Get Task Tool Integration Tests (Real Jira API)', () => {
    let serverProcess: ChildProcess;
    let serverUrl: string;
    const PORT = 3333; // Use a different port for testing

    // Alternative approach: Create a test server that directly exposes the tool
    let testApp: any;
    let mcpServer: McpServer;
    let toolHandlers: Map<string, any> = new Map();

    beforeAll(async () => {
        // Restore console methods for integration tests (setup.ts mocks them)
        if ((console.log as any).mockRestore) {
            (console.log as any).mockRestore();
            (console.info as any).mockRestore();
            (console.warn as any).mockRestore();
            (console.error as any).mockRestore();
        }
        
        serverUrl = `http://localhost:${PORT}`;
        
        // Create a simple express app that directly calls the MCP tools
        const express = require('express');
        testApp = express();
        testApp.use(express.json());

        // Create MCP server instance
        mcpServer = new McpServer({
            name: 'test-server',
            version: '1.0.0'
        });

        // Mock registerTool to capture handlers
        const originalRegisterTool = mcpServer.registerTool.bind(mcpServer);
        mcpServer.registerTool = (name: string, config: any, handler: any) => {
            toolHandlers.set(name, handler);
            return originalRegisterTool(name, config, handler);
        };

        // Setup MCP server with tools
        const getSessionConfig = () => ({
            JIRA_API_URL: process.env.JIRA_API_URL,
            JIRA_EMAIL: process.env.JIRA_EMAIL,
            JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
            JIRA_PROJECT: process.env.JIRA_PROJECT,
            BITBUCKET_WORKSPACE: process.env.BITBUCKET_WORKSPACE,
            BITBUCKET_EMAIL: process.env.JIRA_EMAIL,
            BITBUCKET_API_TOKEN: process.env.BITBUCKET_API_TOKEN,
        });
        setupMcpServer(mcpServer, getSessionConfig);

        // Create endpoint to call tools directly
        testApp.post('/tools/:toolName', async (req: any, res: any) => {
            const { toolName } = req.params;
            const handler = toolHandlers.get(toolName);
            
            if (!handler) {
                return res.status(404).json({ error: `Tool ${toolName} not found` });
            }

            try {
                const result = await handler(req.body);
                res.json(result);
            } catch (error) {
                res.status(500).json({ error: (error as Error).message });
            }
        });

        // Health check
        testApp.get('/health', (req: any, res: any) => {
            res.json({ status: 'healthy' });
        });

        // Start the test server
        await new Promise<void>((resolve) => {
            const server = testApp.listen(PORT, () => {
                console.log(`Test server listening on port ${PORT}`);
                resolve();
            });
            
            // Store server reference for cleanup
            testApp.server = server;
        });
    }, 60000);

    afterAll(async () => {
        // Close the test server and all connections
        if (testApp?.server) {
            await new Promise<void>((resolve, reject) => {
                // Force close all connections
                testApp.server.close((err: any) => {
                    if (err) {
                        console.error('Error closing server:', err);
                        reject(err);
                    } else {
                        console.log('Test server closed');
                        resolve();
                    }
                });
                
                // Force close any keep-alive connections
                testApp.server.closeAllConnections();
            });
        }
        
        // Close logger transports to prevent open handles
        if (logger && logger.transports) {
            logger.transports.forEach((transport: any) => {
                if (transport.close) {
                    transport.close();
                }
            });
        }
        
        // Clean up any lingering timers or connections
        await new Promise(resolve => setTimeout(resolve, 200));
    });

    it('should respond to health check', async () => {
        const response = await request(serverUrl)
            .get('/health')
            .expect(200);

        expect(response.body).toHaveProperty('status', 'healthy');
    });

    it('should successfully fetch real Jira ticket JAR-692', async () => {
        // Real ticket ID from your Jira board
        const REAL_TICKET_ID = 'JAR-692';
        
        // First, let's verify Jira environment variables are loaded
        console.log('Jira config check:');
        console.log('- JIRA_API_URL:', process.env.JIRA_API_URL ? '✅ Set' : '❌ Missing');
        console.log('- JIRA_EMAIL:', process.env.JIRA_EMAIL ? '✅ Set' : '❌ Missing');
        console.log('- JIRA_API_TOKEN:', process.env.JIRA_API_TOKEN ? '✅ Set' : '❌ Missing');
        console.log('- JIRA_PROJECT:', process.env.JIRA_PROJECT ? '✅ Set' : '❌ Missing');
        
        // Call the tool directly via our test endpoint
        const response = await request(serverUrl)
            .post('/tools/get_jira_task')
            .send({ 
                id: REAL_TICKET_ID,
                includeImages: true,
                includeComments: true,
                includeContext: true
            });

        console.log(`\n📋 Fetching ticket: ${REAL_TICKET_ID}`);
        console.log('Response status:', response.status);
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('content');
        expect(Array.isArray(response.body.content)).toBe(true);
        
        // Check if we got a successful response or an error
        const responseText = response.body.content[0]?.text;
        console.log('Response preview:', responseText?.substring(0, 200) + '...');
        
        if (responseText && !responseText.includes('Error:') && !response.body.isError) {
            // Success! We got real Jira data
            const taskData = JSON.parse(responseText);
            
            console.log('\n✅ SUCCESS: Real Jira ticket retrieved!');
            console.log('- Ticket Key:', taskData.jiraKey || taskData.key);
            console.log('- Summary:', taskData.title || taskData.summary);  
            console.log('- Status:', taskData.status?.name || taskData.status);
            console.log('- Assignee:', taskData.assignee?.displayName || taskData.assignee || 'Unassigned');
            console.log('- Created:', taskData.created);
            console.log('- Updated:', taskData.updated);
            console.log('- Issue Type:', taskData.issueType);
            console.log('- Priority:', taskData.priority);
            console.log('- Parent Key:', taskData.parentKey);
            
            // Verify the ticket data structure (your jira-utils format)
            expect(taskData).toHaveProperty('jiraKey', REAL_TICKET_ID);
            expect(taskData).toHaveProperty('title'); // Your format uses 'title' not 'summary'
            expect(taskData).toHaveProperty('status');
            
            // Check if images were included
            if (response.body.content.length > 1) {
                const imageCount = response.body.content.filter((item: any) => item.type === 'image').length;
                console.log('- Images included:', imageCount);
            }
            
        } else {
            // Error case - log the details for debugging
            console.log('\n❌ FAILED: Could not retrieve Jira ticket');
            console.log('Error details:', responseText);
            
            // If it's a configuration error, provide helpful guidance
            if (responseText && responseText.includes('not properly configured')) {
                console.log('\n🔧 Troubleshooting tips:');
                console.log('1. Make sure your .env file is in the project root');
                console.log('2. Verify all required Jira environment variables are set');
                console.log('3. Check that your API token is valid and has proper permissions');
                console.log('4. Ensure the Jira URL format is correct (https://your-domain.atlassian.net)');
            }
            
            // Fail the test if we can't fetch the ticket
            throw new Error(`Failed to fetch ticket ${REAL_TICKET_ID}: ${responseText}`);
        }
    }, 30000); // 30 second timeout for real API calls

    it('should handle invalid ticket ID gracefully', async () => {
        // Test with a non-existent ticket ID in the same project
        const INVALID_TICKET_ID = 'JAR-99999';
        
        const response = await request(serverUrl)
            .post('/tools/get_jira_task')
            .send({ id: INVALID_TICKET_ID });

        console.log(`\n🔍 Testing invalid ticket: ${INVALID_TICKET_ID}`);
        console.log('Response status:', response.status);
        
        expect(response.status).toBe(200); // Should return 200 with error content
        expect(response.body).toHaveProperty('content');
        
        const responseText = response.body.content[0]?.text;
        console.log('Error response:', responseText?.substring(0, 200));
        
        // Should get a "not found" or similar error
        expect(responseText).toMatch(/Error:|not found|does not exist/i);
    }, 30000);

    it('should return error when task ID is missing', async () => {
        const response = await request(serverUrl)
            .post('/tools/get_jira_task')
            .send({ id: '' })
            .expect(200);

        const responseText = response.body.content[0].text;
        expect(responseText).toContain('Error: Task ID is required');
        expect(response.body).toHaveProperty('isError', true);
    });

    it('should test the test-tool endpoint', async () => {
        // Test the simple test-tool to verify the setup is working
        const response = await request(serverUrl)
            .post('/tools/test-tool')
            .send({ message: 'Integration test message' })
            .expect(200);

        expect(response.body.content[0].text).toContain('Test successful: Integration test message');
    });
}); 