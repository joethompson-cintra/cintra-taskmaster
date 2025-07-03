/**
 * Creates error response for tools
 * @param {string} errorMessage - Error message to include in response
 * @returns {Object} - Error content response object in McpServer format
 */
export function createErrorResponse(errorMessage: string) {
	return {
		content: [
			{
				type: 'text' as const,
				text: `Error: ${errorMessage}`
			}
		],
		isError: true
	};
}