/**
 * Integration test for the update-task functionality
 * Tests the complete workflow: create -> get -> update -> verify
 */

import request from 'supertest';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger';
// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { setupMcpServer } from '../server/mcpServer';

// Load environment variables from .env file
dotenv.config();

// NO MOCKING - This will call REAL Jira APIs!

describe('Update Task Tool Integration Tests (Real Jira API)', () => {
    let serverUrl: string;
    const PORT = 3334; // Use a different port for testing

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

    it('should complete full workflow: create -> get -> update -> verify formatting preservation', async () => {
        const timestamp = Date.now();
        const testTaskTitle = `Test Task Update ADF Fix ${timestamp}`;
        
        // Step 1: Create a test task
        console.log('\n📝 Step 1: Creating test task...');
        const createResult = await request(serverUrl)
            .post('/tools/add_jira_issue')
            .send({
                title: testTaskTitle,
                description: 'Test task to verify ADF formatting preservation',
                acceptanceCriteria: `- [ ] First acceptance criterion with **Framework**: React Native
- [ ] Second criterion with *emphasis*
- [ ] Third criterion with code \`example\``,
                details: `## Implementation Steps
- **Framework**: React Native
- **Architecture**: Clean architecture
- **Database**: PostgreSQL`,
                testStrategy: 'Unit tests for all methods',
                priority: 'Medium',
                issueType: 'Task'
            });
        
        expect(createResult.status).toBe(200);
        expect(createResult.body).toHaveProperty('content');
        
        // Extract the task ID from the response
        const createResponseText = createResult.body.content[0]?.text;
        const taskIdMatch = createResponseText?.match(/JAR-\d+/);
        const taskId = taskIdMatch?.[0];
        
        expect(taskId).toBeDefined();
        expect(taskId).toMatch(/JAR-\d+/);
        
        console.log(`✅ Created test task: ${taskId}`);
        
        // Step 2: Get the task to verify initial state
        console.log('\n📋 Step 2: Fetching initial task state...');
        const getResult = await request(serverUrl)
            .post('/tools/get_jira_task')
            .send({
                id: taskId,
                includeImages: false,
                includeComments: false,
                includeContext: false
            });
        
        expect(getResult.status).toBe(200);
        expect(getResult.body).toHaveProperty('content');
        
        const initialTaskData = JSON.parse(getResult.body.content[0].text);
        console.log('Initial acceptance criteria:', initialTaskData.acceptanceCriteria);
        console.log('Initial details:', initialTaskData.details);
        
        // Verify initial state has unchecked boxes
        expect(initialTaskData.acceptanceCriteria).toContain('[ ]');
        expect(initialTaskData.details).toContain('**Framework**: React Native');
        
        // Step 3: Update acceptance criteria (mark as complete)
        console.log('\n🔄 Step 3: Updating acceptance criteria...');
        const updateResult = await request(serverUrl)
            .post('/tools/update_jira_task')
            .send({
                id: taskId,
                prompt: `- [x] First acceptance criterion with **Framework**: React Native
- [x] Second criterion with *emphasis*
- [x] Third criterion with code \`example\``
            });
        
        expect(updateResult.status).toBe(200);
        expect(updateResult.body).toHaveProperty('content');
        
        console.log('✅ Updated acceptance criteria');
        
        // Step 4: Verify the update worked AND formatting is preserved
        console.log('\n🔍 Step 4: Verifying update and formatting preservation...');
        const verifyResult = await request(serverUrl)
            .post('/tools/get_jira_task')
            .send({
                id: taskId,
                includeImages: false,
                includeComments: false,
                includeContext: false
            });
        
        expect(verifyResult.status).toBe(200);
        expect(verifyResult.body).toHaveProperty('content');
        
        const updatedTaskData = JSON.parse(verifyResult.body.content[0].text);
        console.log('Updated acceptance criteria:', updatedTaskData.acceptanceCriteria);
        console.log('Updated details (should be unchanged):', updatedTaskData.details);
        
        // Verify acceptance criteria was updated (boxes now checked)
        expect(updatedTaskData.acceptanceCriteria).toContain('[x]');
        expect(updatedTaskData.acceptanceCriteria).not.toContain('[ ]');
        
        // 🎯 CRITICAL: Verify that the details section formatting is preserved
        expect(updatedTaskData.details).toContain('**Framework**: React Native');
        expect(updatedTaskData.details).toContain('**Architecture**: Clean architecture');
        expect(updatedTaskData.details).toContain('**Database**: PostgreSQL');
        
        // Verify the details section wasn't corrupted (no extra line breaks)
        expect(updatedTaskData.details).not.toMatch(/Framework\s*\n\s*:/);
        expect(updatedTaskData.details).not.toMatch(/Architecture\s*\n\s*:/);
        expect(updatedTaskData.details).not.toMatch(/Database\s*\n\s*:/);
        
        console.log('✅ Formatting preserved! No corruption in unchanged sections.');
        
        // Step 5: Test updating a different section
        console.log('\n🔄 Step 5: Testing details section update...');
        const detailsUpdateResult = await request(serverUrl)
            .post('/tools/update_jira_task')
            .send({
                id: taskId,
                prompt: `## Implementation Steps
- **Framework**: React Native with TypeScript
- **Architecture**: Clean architecture with MVVM
- **Database**: PostgreSQL with Prisma ORM
- **Testing**: Jest and React Native Testing Library`
            });
        
        expect(detailsUpdateResult.status).toBe(200);
        console.log('✅ Updated implementation details');
        
        // Step 6: Final verification
        console.log('\n🔍 Step 6: Final verification...');
        const finalVerifyResult = await request(serverUrl)
            .post('/tools/get_jira_task')
            .send({
                id: taskId,
                includeImages: false,
                includeComments: false,
                includeContext: false
            });
        
        expect(finalVerifyResult.status).toBe(200);
        const finalTaskData = JSON.parse(finalVerifyResult.body.content[0].text);
        
        // Verify acceptance criteria is still updated (unchanged from step 3)
        expect(finalTaskData.acceptanceCriteria).toContain('[x]');
        expect(finalTaskData.acceptanceCriteria).toContain('**Framework**: React Native');
        
        // Verify details section was updated with new content
        expect(finalTaskData.details).toContain('React Native with TypeScript');
        expect(finalTaskData.details).toContain('Prisma ORM');
        expect(finalTaskData.details).toContain('Jest and React Native Testing Library');
        
        console.log('✅ All updates successful with formatting preserved!');
        console.log(`\n🎉 Test completed successfully for task: ${taskId}`);
        console.log('✅ ADF formatting preservation fix is working correctly!');
    }, 120000); // 2 minute timeout for full workflow
}); 