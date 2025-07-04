import { Anthropic } from '@anthropic-ai/sdk';

interface GenerateTextOptions {
	model?: string;
	maxTokens?: number;
	temperature?: number;
}

/**
 * Simplified text generation function that directly calls the Anthropic API
 * This is a standalone function that can be copied to other repos
 * 
 * @param prompt - The user prompt
 * @param systemPrompt - The system prompt
 * @param options - Optional configuration
 * @returns Generated text response
 */
export async function generateText(
	prompt: string, 
	systemPrompt: string, 
	options: GenerateTextOptions = {}
): Promise<string> {
	const {
		model = 'claude-sonnet-4-20250514',
		maxTokens = 50000,
		temperature = 0.25
	} = options;

	try {
		// Configure Anthropic client
		const anthropic = new Anthropic({
			apiKey: process.env.ANTHROPIC_API_KEY,
			defaultHeaders: {
				'anthropic-beta': 'output-128k-2025-02-19'
			}
		});

		// Make API call
		const response = await anthropic.messages.create({
			model: model,
			max_tokens: maxTokens,
			temperature: temperature,
			system: systemPrompt,
			messages: [
				{
					role: 'user',
					content: prompt
				}
			]
		});

		// Extract text from response
		const textContent = response.content
			.filter(block => block.type === 'text')
			.map(block => block.text)
			.join('');

		return textContent;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		throw new Error(`Failed to generate text: ${errorMessage}`);
	}
}