import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import { feeFetcher } from '../utils/fetch-fees.js';
import * as math from 'mathjs';

export class OpportunityAnalyzer extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            minProfitUSD: config.minProfitUSD || 1.0,
            minProfitPercent: config.minProfitPercent || 0.5,
            maxSlippagePercent: config.maxSlippagePercent || 0.3,
            minVolumeUSD: config.minVolumeUSD || 1000,
            maxPositionPercent: config.maxPositionPercent || 0.1,
            volatilityWindow: config.volatilityWindow || 24,
            ...config
        };
    }

    async analyzeOpportunity(opportunity) {
        try {
            logger.debug('Analyzing opportunity:', opportunity);

            // Calculate volatility
            const volatility = this._calculateVolatility(opportunity);
            if (volatility > 30) {
                logger.warn('High volatility detected:', volatility);
                return null;
            }

            // Rest of the code remains the same...
        } catch (error) {
            logger.error('Error analyzing opportunity:', error);
            return null;
        }
    }

    _calculateVolatility(opportunity) {
        try {
            const prices = [opportunity.buyPrice, opportunity.sellPrice];
            return math.std(prices) / math.mean(prices) * 100;
        } catch (error) {
            logger.error('Error calculating volatility:', error);
            return Infinity;
        }
    }

    // Rest of the code remains the same...
}