import { feeFetcher } from './fetch-fees.js';
import { logger } from './logger.js';

async function testFees() {
    try {
        // Test fee fetching for all exchanges
        const fees = await feeFetcher.getAllFees();
        console.log('Exchange Fees:', fees);

        // Test individual exchanges
        const exchanges = ['safetrade', 'tradeogre', 'verusdefi', 'komodo'];
        for (const exchange of exchanges) {
            const fee = await feeFetcher.getFees(exchange);
            console.log(`${exchange} fees:`, fee);
        }
    } catch (error) {
        logger.error('Fee test failed:', error);
    }
}

testFees();