import { logger } from '../utils/logger.js';
import { SafeTrade } from './safetrade.js';
import { TradeOgre } from './tradeogre.js';
import { VerusDefi } from './verusdefi.js';
import { Komodo } from './komodowallet.js';

// Initialize exchange instances
const safeTrade = new SafeTrade();
const tradeOgre = new TradeOgre();
const verusDefi = new VerusDefi();
const komodo = new Komodo();

// Export configured exchange instances
export const exchanges = [
    safeTrade,
    tradeOgre,
    verusDefi,
    komodo
];

// Export exchange status checker
export async function checkExchangeStatus() {
    const statuses = await Promise.all(
        exchanges.map(async (exchange) => {
            try {
                const status = exchange.getStatus();
                const price = await exchange.fetchPrice();
                return {
                    ...status,
                    price: price.success ? price.price : null,
                    operational: price.success
                };
            } catch (error) {
                logger.error(`Error checking ${exchange.name} status:`, error);
                return {
                    name: exchange.name,
                    operational: false,
                    error: error.message
                };
            }
        })
    );

    return statuses;
}