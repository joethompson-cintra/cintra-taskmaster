import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

const logLevel = process.env.LOG_LEVEL || 'info';
const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { 
        service: 'typescript-mcp-auth-server' 
    },
    transports: [
        // Write all logs with importance level of 'error' or higher to error.log with rotation
        new DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: '14d', // Keep logs for 14 days
            maxSize: '20m',  // Rotate when file reaches 20MB
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            )
        }),
        // Write all logs to combined.log with rotation
        new DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '30d', // Keep logs for 30 days
            maxSize: '20m',  // Rotate when file reaches 20MB
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            )
        })
    ]
});

// In development, add console logging with readable format (safe for MCP)
// In production, disable console logging to avoid MCP protocol interference
if (isDevelopment) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({
                format: 'HH:mm:ss'
            }),
            winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
                const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
                return `${timestamp} [${service}] ${level}: ${message} ${metaStr}`;
            })
        )
    }));
}
// Note: Console logging is disabled in production to prevent MCP protocol issues

export default logger; 