import { config } from 'dotenv';
import { logger } from './utils/logger.js';
import { PriceFeedManager } from './price/priceFeedManager.js';
import { HealthMonitor } from './health/healthMonitor.js';
import { ServiceMonitor } from './health/serviceMonitor.js';
import { PerformanceMonitor } from './health/performanceMonitor.js';

config();

async function main() {
    try {
        logger.info('Starting system');
        
        // Initialize health monitoring
        const healthMonitor = new HealthMonitor();
        const serviceMonitor = new ServiceMonitor();
        const performanceMonitor = new PerformanceMonitor();

        // Initialize price feed
        const priceFeedManager = new PriceFeedManager();

        // Register services for monitoring
        serviceMonitor.registerService('priceFeed', async () => {
            const status = await priceFeedManager.getExchangeStatus();
            return status.every(s => s.operational) ? 'healthy' : 'degraded';
        });

        // Start monitoring
        await healthMonitor.start();
        await serviceMonitor.startMonitoring();
        await priceFeedManager.initialize();

        // Set up performance thresholds
        performanceMonitor.setThreshold('priceUpdate', 1000); // 1 second
        performanceMonitor.setThreshold('orderExecution', 5000); // 5 seconds

        // Handle shutdown gracefully
        process.on('SIGINT', async () => {
            logger.info('Shutting down...');
            await healthMonitor.stop();
            await serviceMonitor.stopMonitoring();
            await priceFeedManager.shutdown();
            process.exit(0);
        });

    } catch (error) {
        logger.error('Critical error:', error);
        process.exit(1);
    }
}

main();