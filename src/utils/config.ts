import { z } from 'zod';
import { logger } from './logger.js';

// Define the schema for optional environment variables
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
    
    // Optional configuration
    ALLOWED_ORIGINS: z.string().optional(),
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info')
});

export type Config = z.infer<typeof envSchema>;

export function validateEnvironment(): Config {
    try {
        const config = envSchema.parse(process.env);
        logger.info('Environment variables validated successfully');
        return config;
    } catch (error) {
        logger.error('Environment validation failed:', error);
        
        if (error instanceof z.ZodError) {
            const missingVars = error.issues.map(issue => 
                `${issue.path.join('.')}: ${issue.message}`
            ).join('\n');
            
            logger.error('Missing or invalid environment variables:\n' + missingVars);
            logger.error('Please check your .env file and ensure all required variables are set');
        }
        
        process.exit(1);
    }
}

export function getConfig(): Config {
    return envSchema.parse(process.env);
}

// Export commonly used config values
export const isDevelopment = () => process.env.NODE_ENV === 'development';
export const isProduction = () => process.env.NODE_ENV === 'production';
export const isTest = () => process.env.NODE_ENV === 'test'; 