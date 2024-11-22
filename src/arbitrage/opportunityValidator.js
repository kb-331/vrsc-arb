import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class OpportunityValidator {
    constructor(config = {}) {
        this.config = {
            maxAge: config.maxAge || 5000,           // 5 seconds
            minVolume: config.minVolume || 1000,     // $1000
            maxSlippage: config.maxSlippage || 0.3,  // 0.3%
            minProfit: config.minProfit || 1.0,      // $1
            ...config
        };
    }

    validateOpportunity(opportunity, marketData) {
        try {
            const checks = [
                this._validateTiming(opportunity),
                this._validateVolume(opportunity, marketData),
                this._validatePrices(opportunity, marketData),
                this._validateProfitability(opportunity)
            ];

            const failures = checks.filter(check => !check.isValid);
            
            return {
                isValid: failures.length === 0,
                errors: failures.map(f => f.reason)
            };
        } catch (error) {
            logger.error('Error validating opportunity:', error);
            return {
                isValid: false,
                errors: [error.message]
            };
        }
    }

    _validateTiming(opportunity) {
        const age = Date.now() - opportunity.timestamp;
        
        if (age > this.config.maxAge) {
            return {
                isValid: false,
                reason: 'Opportunity too old'
            };
        }

        return { isValid: true };
    }

    _validateVolume(opportunity, marketData) {
        const volume = new Decimal(opportunity.volume);
        
        if (volume.lessThan(this.config.minVolume)) {
            return {
                isValid: false,
                reason: 'Insufficient volume'
            };
        }

        // Check against market depth
        if (marketData?.depth) {
            const buyDepth = new Decimal(marketData.depth.buy || 0);
            const sellDepth = new Decimal(marketData.depth.sell || 0);
            
            if (volume.greaterThan(buyDepth) || volume.greaterThan(sellDepth)) {
                return {
                    isValid: false,
                    reason: 'Insufficient market depth'
                };
            }
        }

        return { isValid: true };
    }

    _validatePrices(opportunity, marketData) {
        if (!marketData?.currentPrices) {
            return { isValid: true };
        }

        const buyPrice = new Decimal(opportunity.buyPrice);
        const sellPrice = new Decimal(opportunity.sellPrice);
        const currentBuyPrice = new Decimal(marketData.currentPrices.buy);
        const currentSellPrice = new Decimal(marketData.currentPrices.sell);

        const buySlippage = buyPrice
            .minus(currentBuyPrice)
            .div(currentBuyPrice)
            .abs();
            
        const sellSlippage = sellPrice
            .minus(currentSellPrice)
            .div(currentSellPrice)
            .abs();

        if (buySlippage.greaterThan(this.config.maxSlippage) || 
            sellSlippage.greaterThan(this.config.maxSlippage)) {
            return {
                isValid: false,
                reason: 'Price slippage too high'
            };
        }

        return { isValid: true };
    }

    _validateProfitability(opportunity) {
        const profit = new Decimal(opportunity.profit);
        
        if (profit.lessThan(this.config.minProfit)) {
            return {
                isValid: false,
                reason: 'Insufficient profit'
            };
        }

        return { isValid: true };
    }
}