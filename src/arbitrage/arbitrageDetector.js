import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class ArbitrageDetector extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            minSpreadPercent: config.minSpreadPercent || 0.5,    // 0.5% minimum spread
            minVolumeUSD: config.minVolumeUSD || 1000,          // $1000 minimum volume
            maxSlippage: config.maxSlippage || 0.3,             // 0.3% maximum slippage
            minProfitUSD: config.minProfitUSD || 1.0,          // $1 minimum profit
            ...config
        };
        this.lastCheck = new Map();
    }

    detectArbitrage(prices) {
        try {
            const opportunities = [];
            const exchanges = this._getUniqueExchanges(prices);

            for (const buyExchange of exchanges) {
                for (const sellExchange of exchanges) {
                    if (buyExchange === sellExchange) continue;

                    const opportunity = this._checkPair(
                        prices.get(buyExchange),
                        prices.get(sellExchange)
                    );

                    if (opportunity) {
                        opportunities.push(opportunity);
                    }
                }
            }

            return this._filterBestOpportunities(opportunities);
        } catch (error) {
            logger.error('Error detecting arbitrage:', error);
            return [];
        }
    }

    _checkPair(buyPrice, sellPrice) {
        if (!this._validatePrices(buyPrice, sellPrice)) {
            return null;
        }

        const spread = this._calculateSpread(buyPrice.price, sellPrice.price);
        if (spread.lessThan(this.config.minSpreadPercent / 100)) {
            return null;
        }

        const volume = Decimal.min(
            buyPrice.volume || 0,
            sellPrice.volume || 0
        );
        
        if (volume.lessThan(this.config.minVolumeUSD)) {
            return null;
        }

        const profit = this._calculateProfit(buyPrice.price, sellPrice.price, volume);
        if (profit.lessThan(this.config.minProfitUSD)) {
            return null;
        }

        return {
            buyExchange: buyPrice.exchange,
            sellExchange: sellPrice.exchange,
            buyPrice: buyPrice.price,
            sellPrice: sellPrice.price,
            spread: spread.toString(),
            volume: volume.toString(),
            profit: profit.toString(),
            timestamp: Date.now()
        };
    }

    _validatePrices(buyPrice, sellPrice) {
        if (!buyPrice || !sellPrice) return false;

        const maxAge = 5000; // 5 seconds
        const now = Date.now();

        if (now - buyPrice.timestamp > maxAge || 
            now - sellPrice.timestamp > maxAge) {
            return false;
        }

        return true;
    }

    _calculateSpread(buyPrice, sellPrice) {
        return new Decimal(sellPrice)
            .minus(buyPrice)
            .div(buyPrice)
            .mul(100);
    }

    _calculateProfit(buyPrice, sellPrice, volume) {
        const cost = new Decimal(buyPrice).mul(volume);
        const revenue = new Decimal(sellPrice).mul(volume);
        
        // Account for fees and slippage
        const totalFees = cost.mul(0.002); // Assuming 0.2% total fees
        const slippage = cost.mul(this.config.maxSlippage / 100);
        
        return revenue
            .minus(cost)
            .minus(totalFees)
            .minus(slippage);
    }

    _getUniqueExchanges(prices) {
        return [...new Set(Array.from(prices.keys()))];
    }

    _filterBestOpportunities(opportunities) {
        return opportunities
            .sort((a, b) => new Decimal(b.profit).minus(a.profit))
            .slice(0, 5); // Return top 5 opportunities
    }

    getMetrics() {
        return {
            lastCheck: Object.fromEntries(this.lastCheck),
            config: this.config
        };
    }
}