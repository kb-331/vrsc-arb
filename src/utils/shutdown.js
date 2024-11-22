import { logger } from './logger.js';

class ShutdownHandler {
    constructor() {
        this.handlers = new Set();
        this.isShuttingDown = false;
        this.setupHandlers();
    }

    setupHandlers() {
        // Handle process termination signals
        ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
            process.on(signal, () => this.shutdown(signal));
        });

        // Handle uncaught exceptions and rejections
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            this.shutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Rejection:', reason);
            this.shutdown('unhandledRejection');
        });
    }

    registerHandler(handler) {
        if (typeof handler !== 'function') {
            throw new Error('Shutdown handler must be a function');
        }
        this.handlers.add(handler);
    }

    async shutdown(signal) {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        logger.info(`Shutdown initiated (${signal})`);

        try {
            // Execute all shutdown handlers
            const promises = Array.from(this.handlers).map(handler => 
                handler().catch(error => 
                    logger.error('Error in shutdown handler:', error)
                )
            );

            await Promise.all(promises);
            logger.info('Shutdown completed successfully');
        } catch (error) {
            logger.error('Error during shutdown:', error);
        } finally {
            process.exit(0);
        }
    }
}

export const shutdownHandler = new ShutdownHandler();