import { logger } from './logger.js';
import pLimit from 'p-limit';
import pRetry from 'p-retry';

export class RateLimiter {
    constructor() {
        this.limiters = new Map();
        this.lastCall = new Map();
        this.limits = {
            safetrade: { rps: 0.2, concurrent: 1 },    // 1 request per 5 seconds
            tradeogre: { rps: 0.2, concurrent: 1 },    // 1 request per 5 seconds
            verusdefi: { rps: 0.5, concurrent: 2 },    // 1 request per 2 seconds
            komodo: { rps: 0.2, concurrent: 1 }        // 1 request per 5 seconds
        };
        this.backoffTime = 300000; // 5 minute backoff after errors
        this.errorCounts = new Map();
    }

    _getLimiter(exchange) {
        const normalizedExchange = exchange.toLowerCase();
        
        if (!this.limiters.has(normalizedExchange)) {
            const config = this.limits[normalizedExchange];
            if (!config) {
                logger.warn(`No rate limit config found for ${exchange}, using default`);
                config = { rps: 0.2, concurrent: 1 }; // Conservative default
            }
            
            this.limiters.set(normalizedExchange, pLimit(config.concurrent));
        }
        
        return this.limiters.get(normalizedExchange);
    }

    async executeWithRetry(exchange, operation) {
        const limiter = this._getLimiter(exchange);
        const config = this.limits[exchange.toLowerCase()];
        
        if (this._shouldBackoff(exchange)) {
            throw new Error(`Rate limiting backoff in effect for ${exchange}`);
        }

        return limiter(async () => {
            const now = Date.now();
            const lastCall = this.lastCall.get(exchange) || 0;
            const minInterval = 1000 / config.rps;
            const timeToWait = Math.max(0, minInterval - (now - lastCall));
            
            if (timeToWait > 0) {
                await new Promise(resolve => setTimeout(resolve, timeToWait));
            }
            
            try {
                const result = await pRetry(operation, {
                    retries: 3,
                    minTimeout: 5000,
                    maxTimeout: 30000,
                    onFailedAttempt: error => {
                        this._recordError(exchange);
                        logger.warn(`Failed attempt for ${exchange}: ${error.message}`);
                        logger.warn(`Attempt ${error.attemptNumber} failed, ${error.retriesLeft} retries left`);
                    }
                });
                
                this.lastCall.set(exchange, Date.now());
                this._resetErrors(exchange);
                return result;
                
            } catch (error) {
                logger.error(`Operation failed for ${exchange} after retries: ${error.message}`);
                throw error;
            }
        });
    }

    _shouldBackoff(exchange) {
        const errors = this.errorCounts.get(exchange) || [];
        const recentErrors = errors.filter(t => Date.now() - t < this.backoffTime);
        return recentErrors.length >= 5;
    }

    _recordError(exchange) {
        if (!this.errorCounts.has(exchange)) {
            this.errorCounts.set(exchange, []);
        }
        this.errorCounts.get(exchange).push(Date.now());
    }

    _resetErrors(exchange) {
        this.errorCounts.set(exchange, []);
    }

    getStatus(exchange) {
        const normalizedExchange = exchange.toLowerCase();
        const config = this.limits[normalizedExchange];
        const lastCall = this.lastCall.get(normalizedExchange);
        const now = Date.now();
        const errors = this.errorCounts.get(normalizedExchange) || [];
        const recentErrors = errors.filter(t => now - t < this.backoffTime);
        
        return {
            exchange: normalizedExchange,
            config: config || 'default',
            lastCall: lastCall ? new Date(lastCall).toISOString() : 'never',
            timeSinceLastCall: lastCall ? now - lastCall : null,
            isRateLimited: lastCall ? (now - lastCall) < (1000 / (config?.rps || 0.2)) : false,
            recentErrors: recentErrors.length,
            isBackingOff: this._shouldBackoff(normalizedExchange)
        };
    }
}