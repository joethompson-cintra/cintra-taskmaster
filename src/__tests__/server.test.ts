// @ts-ignore
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
// @ts-ignore
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { setupMcpServer } from '../server/mcpServer';

describe('MCP Server Integration Tests', () => {
    let server: McpServer;

    beforeEach(async () => {
        server = new McpServer({
            name: 'test-server',
            version: '1.0.0'
        }, {
            capabilities: {
                logging: {},
                tools: {},
                resources: {},
                prompts: {}
            }
        });

        setupMcpServer(server);
    });

    test('should create server successfully', () => {
        expect(server).toBeDefined();
    });

    test('should call echo tool through MCP protocol', async () => {
        const registeredTools = (server as any)._registeredTools;
        const echoTool = registeredTools['echo'];
        expect(echoTool).toBeDefined();
        
        const result = await echoTool.callback({ text: 'Hello World' });
        
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toBe('Echo: Hello World');
    });
 
    test('should call greet tool through MCP protocol', async () => {
        const registeredTools = (server as any)._registeredTools;
        const greetTool = registeredTools['greet'];
        expect(greetTool).toBeDefined();
        
        // Test English greeting
        const result = await greetTool.callback({ name: 'Alice', language: 'en' });
        
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toBe('Hello, Alice! Welcome to our MCP server.');

        // Test Spanish greeting
        const spanishResult = await greetTool.callback({ name: 'Carlos', language: 'es' });
        expect(spanishResult.content[0].text).toBe('¡Hola, Carlos! Bienvenido a nuestro servidor MCP.');
    });

    test('should call system-info tool through MCP protocol', async () => {
        const registeredTools = (server as any)._registeredTools;
        const systemInfoTool = registeredTools['system-info'];
        expect(systemInfoTool).toBeDefined();
        
        const result = await systemInfoTool.callback({});
        
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain('System Information:');
        expect(result.content[0].text).toContain('nodeVersion');
        expect(result.content[0].text).toContain('platform');
    });

    test('should access server-status resource through MCP protocol', async () => {
        const registeredResources = (server as any)._registeredResources;
        const serverStatusResource = registeredResources['server://status'];
        expect(serverStatusResource).toBeDefined();
        
        const result = await serverStatusResource.readCallback();
        
        expect(result).toBeDefined();
        expect(result.contents).toBeDefined();
        expect(result.contents[0].uri).toBe('server://status');
        expect(result.contents[0].mimeType).toBe('application/json');
        expect(result.contents[0].text).toContain('healthy');
    });

    test('should access config resource through MCP protocol', async () => {
        const registeredResources = (server as any)._registeredResources;
        const configResource = registeredResources['server://config'];
        expect(configResource).toBeDefined();
        
        const result = await configResource.readCallback();
        
        expect(result).toBeDefined();
        expect(result.contents).toBeDefined();
        expect(result.contents[0].uri).toBe('server://config');
        expect(result.contents[0].mimeType).toBe('application/json');
        
        const config = JSON.parse(result.contents[0].text);
        expect(config.name).toBe('typescript-mcp-server');
        expect(config.version).toBe('1.0.0');
        expect(config.capabilities).toContain('tools');
    });

    test('should call welcome prompt through MCP protocol', async () => {
        const registeredPrompts = (server as any)._registeredPrompts;
        const welcomePrompt = registeredPrompts['welcome'];
        expect(welcomePrompt).toBeDefined();
        
        const result = await welcomePrompt.callback({ username: 'TestUser' });
        
        expect(result).toBeDefined();
        expect(result.messages).toBeDefined();
        expect(result.messages[0].role).toBe('user');
        expect(result.messages[0].content.type).toBe('text');
        expect(result.messages[0].content.text).toBe('Welcome to MCP Server, TestUser! How can I help you today?');
    });

    test('should call help prompt through MCP protocol', async () => {
        const registeredPrompts = (server as any)._registeredPrompts;
        const helpPrompt = registeredPrompts['help'];
        expect(helpPrompt).toBeDefined();
        
        // Test tools help
        const result = await helpPrompt.callback({ topic: 'tools' });
        
        expect(result).toBeDefined();
        expect(result.messages).toBeDefined();
        expect(result.messages[0].role).toBe('assistant');
        expect(result.messages[0].content.type).toBe('text');
        expect(result.messages[0].content.text).toBe('Available tools: echo, greet, system-info. Use these to interact with the server.');

        // Test general help
        const generalResult = await helpPrompt.callback({ topic: 'general' });
        expect(generalResult.messages[0].content.text).toBe('This is a TypeScript MCP server starter template. Use /health for status checks.');
    });

    test('should have registered tools', () => {
        const registeredTools = (server as any)._registeredTools;
        expect(registeredTools).toBeDefined();
        expect(Object.keys(registeredTools).length).toBeGreaterThan(0);
        
        // Check that our tools are registered
        expect(registeredTools['echo']).toBeDefined();
        expect(registeredTools['greet']).toBeDefined();
        expect(registeredTools['system-info']).toBeDefined();
    });

    test('should have registered resources', () => {
        const registeredResources = (server as any)._registeredResources;
        expect(registeredResources).toBeDefined();
        expect(Object.keys(registeredResources).length).toBeGreaterThan(0);
        
        // Check that our resources are registered
        expect(registeredResources['server://status']).toBeDefined();
        expect(registeredResources['server://config']).toBeDefined();
    });

    test('should have registered prompts', () => {
        const registeredPrompts = (server as any)._registeredPrompts;
        expect(registeredPrompts).toBeDefined();
        expect(Object.keys(registeredPrompts).length).toBeGreaterThan(0);
        
        // Check that our prompts are registered
        expect(registeredPrompts['welcome']).toBeDefined();
        expect(registeredPrompts['help']).toBeDefined();
    });
}); 