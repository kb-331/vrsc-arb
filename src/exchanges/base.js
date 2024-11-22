import { logger } from '../utils/logger.js';
import { PriceValidator } from '../utils/price-validator.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { RequestQueue } from '../utils/request-queue.js';
import { proxyManager } from '../utils/proxy-manager.js';
import { WebSocketManager } from '../utils/websocket-manager.js';
import Decimal from 'decimal.js';
import fetch from 'cross-fetch';

export class BaseExchange {
    constructor(name) {
        this.name = name;
        this.rateLimiter = new RequestQueue();
        this.priceValidator = new PriceValidator();
        this.circuitBreaker = new CircuitBreaker();
        this.wsManager = new WebSocketManager();
        this.baseUrl = '';
        this.wsUrl = '';
        this.defaultTimeout = 15000;
        this.retryAttempts = 3;
        this.retryDelay = 5000;
        this.priceCache = new Map();
    }

    async fetchPrice() {
        try {
            if (this.circuitBreaker.isOpen(this.name)) {
                throw new Error(`Circuit breaker is open for ${this.name}`);
            }

            const cachedPrice = this._getCachedPrice();
            if (cachedPrice) {
                return cachedPrice;
            }

            return await this.rateLimiter.enqueue(this.name, async () => {
                const result = await this._fetchPriceWithRetry();
                
                if (result.success) {
                    this.circuitBreaker.onSuccess(this.name);
                    this._updatePriceCache(result);
                } else {
                    this.circuitBreaker.onError(this.name);
                }

                return result;
            });
        } catch (error) {
            this.circuitBreaker.onError(this.name);
            logger.error(`${this.name} price fetch error:`, error);
            return {
                price: null,
                timestamp: Date.now(),
                success: false,
                error: error.message
            };
        }
    }

    async _fetchPriceWithRetry() {
        let lastError;
        let backoffDelay = this.retryDelay;

        for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
            try {
                const result = await this._fetchPriceImpl();
                
                if (!this.priceValidator.validatePrice(result.price)) {
                    throw new Error('Price validation failed');
                }

                return {
                    ...result,
                    success: true
                };
            } catch (error) {
                lastError = error;
                logger.warn(`Attempt ${attempt} failed for ${this.name}:`, error.message);
                
                if (attempt < this.retryAttempts) {
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    backoffDelay *= 2;
                }
            }
        }

        throw lastError || new Error('Failed to fetch price after retries');
    }

    async _makeRequest(endpoint, options = {}) {
        const url = new URL(endpoint, this.baseUrl);
        
        try {
            const response = await proxyManager.makeRequest(this.name, url.toString(), {
                ...options,
                timeout: options.timeout || this.defaultTimeout,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'VRSC-Arbitrage-Monitor/1.0',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            throw new Error(`Request failed: ${error.message}`);
        }
    }

    _getCachedPrice() {
        const cached = this.priceCache.get(this.name);
        if (cached && Date.now() - cached.timestamp < 5000) { // 5 second cache
            return cached;
        }
        return null;
    }

    _updatePriceCache(priceData) {
        this.priceCache.set(this.name, {
            ...priceData,
            cacheTimestamp: Date.now()
        });
    }

    getStatus() {
        return {
            name: this.name,
            baseUrl: this.baseUrl,
            wsUrl: this.wsUrl,
            rateLimiter: this.rateLimiter.getQueueStatus(this.name),
            circuitBreaker: this.circuitBreaker.getStatus(this.name),
            wsStatus: this.wsManager.getStatus(this.name),
            timestamp: Date.now()
        };
    }
}