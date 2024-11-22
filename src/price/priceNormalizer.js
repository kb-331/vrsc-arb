import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class PriceNormalizer extends EventEmitter {
    constructor() {
        super();
        this.priceCache = new Map();
        this.validityWindow = 5000; // 5 seconds
    }

    async initialize() {
        logger.info('Initializing price normalizer');
    }

    normalizePrice(rawPrice) {
        try {
            const normalized = {
                exchange: rawPrice.exchange,
                symbol: rawPrice.symbol,
                price: new Decimal(rawPrice.price).toFixed(8),
                volume: rawPrice.volume ? new Decimal(rawPrice.volume).toFixed(8) : '0',
                timestamp: rawPrice.timestamp || Date.now()
            };

            if (this._validatePrice(normalized)) {
                this._updateCache(normalized);
                this.emit('normalizedPrice', normalized);
                return normalized;
            }

            return null;
        } catch (error) {
            logger.error('Price normalization error:', error);
            this.emit('error', error);
            return null;
        }
    }

    _validatePrice(price) {
        if (!price.price || !price.exchange || !price.symbol) {
            return false;
        }

        const priceDecimal = new Decimal(price.price);
        if (priceDecimal.isNaN() || priceDecimal.isNegative() || priceDecimal.isZero()) {
            return false;
        }

        return true;
    }

    _updateCache(price) {
        const key = `${price.exchange}_${price.symbol}`;
        this.priceCache.set(key, {
            ...price,
            cacheTime: Date.now()
        });

        // Cleanup old cache entries
        this._cleanupCache();
    }

    _cleanupCache() {
        const now = Date.now();
        for (const [key, data] of this.priceCache.entries()) {
            if (now - data.cacheTime > this.validityWindow) {
                this.priceCache.delete(key);
            }
        }
    }

    getLastPrice(exchange, symbol) {
        const key = `${exchange}_${symbol}`;
        const cached = this.priceCache.get(key);
        
        if (cached && Date.now() - cached.cacheTime <= this.validityWindow) {
            return cached;
        }
        
        return null;
    }
}