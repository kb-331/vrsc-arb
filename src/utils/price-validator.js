import { logger } from './logger.js';
import Decimal from 'decimal.js';

export class PriceValidator {
    constructor(config = {}) {
        this.config = {
            maxPriceDeviation: config.maxPriceDeviation || 0.1,  // 10% max deviation
            minValidSources: config.minValidSources || 2,        // Minimum valid price sources
            priceValidityMs: config.priceValidityMs || 30000,    // 30 seconds
            maxStalePrice: config.maxStalePrice || 300000,       // 5 minutes
            minPrice: config.minPrice || 0.00001,               // Minimum valid price
            maxPrice: config.maxPrice || 1000000,               // Maximum valid price
            ...config
        };

        this.priceHistory = new Map();
        this.lastValidation = new Map();
    }

    validatePrice(price, context = {}) {
        try {
            if (!this._isValidNumber(price)) {
                logger.warn('Invalid price value:', price);
                return false;
            }

            if (!this._isWithinRange(price)) {
                logger.warn('Price outside valid range:', price);
                return false;
            }

            if (!this._isWithinDeviation(price, context.recentPrices)) {
                logger.warn('Price deviation too high:', {
                    price,
                    recentPrices: context.recentPrices
                });
                return false;
            }

            if (context.timestamp && !this._isPriceFresh(context.timestamp)) {
                logger.warn('Price is stale:', {
                    price,
                    timestamp: context.timestamp
                });
                return false;
            }

            this._updatePriceHistory(context.exchange, price);
            return true;

        } catch (error) {
            logger.error('Price validation error:', error);
            return false;
        }
    }

    _isValidNumber(price) {
        try {
            const decimal = new Decimal(price);
            return decimal.isPositive() && decimal.isFinite();
        } catch {
            return false;
        }
    }

    _isWithinRange(price) {
        const priceDecimal = new Decimal(price);
        return priceDecimal.gte(this.config.minPrice) && 
               priceDecimal.lte(this.config.maxPrice);
    }

    _isWithinDeviation(price, recentPrices = []) {
        if (!recentPrices.length) return true;

        const priceDecimal = new Decimal(price);
        const average = this._calculateAverage(recentPrices);
        const deviation = priceDecimal.minus(average).abs().div(average);

        return deviation.lte(this.config.maxPriceDeviation);
    }

    _isPriceFresh(timestamp) {
        return Date.now() - timestamp < this.config.maxStalePrice;
    }

    _calculateAverage(prices) {
        if (!prices || prices.length === 0) return new Decimal(0);
        
        return prices
            .reduce((sum, price) => sum.plus(new Decimal(price)), new Decimal(0))
            .div(prices.length);
    }

    _updatePriceHistory(exchange, price) {
        if (!exchange) return;

        if (!this.priceHistory.has(exchange)) {
            this.priceHistory.set(exchange, []);
        }

        const history = this.priceHistory.get(exchange);
        history.push({
            price,
            timestamp: Date.now()
        });

        // Keep only recent prices
        const cutoff = Date.now() - this.config.priceValidityMs;
        this.priceHistory.set(
            exchange,
            history.filter(entry => entry.timestamp > cutoff)
        );
    }

    getRecentPrices(exchange, count = 10) {
        const history = this.priceHistory.get(exchange) || [];
        return history
            .slice(-count)
            .map(entry => entry.price);
    }

    getPriceStats(exchange) {
        const prices = this.getRecentPrices(exchange);
        if (prices.length === 0) return null;

        const decimalPrices = prices.map(p => new Decimal(p));
        const average = this._calculateAverage(prices);
        const variance = decimalPrices.reduce(
            (sum, price) => sum.plus(price.minus(average).pow(2)),
            new Decimal(0)
        ).div(prices.length);

        return {
            count: prices.length,
            average: average.toString(),
            stdDev: variance.sqrt().toString(),
            min: Decimal.min(...decimalPrices).toString(),
            max: Decimal.max(...decimalPrices).toString()
        };
    }

    clearHistory(exchange) {
        if (exchange) {
            this.priceHistory.delete(exchange);
        } else {
            this.priceHistory.clear();
        }
    }
}