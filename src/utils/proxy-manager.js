import { logger } from './logger.js';
import NodeCache from 'node-cache';
import HttpsProxyAgent from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'cross-fetch';

class ProxyManager {
    constructor() {
        this.cache = new NodeCache({ stdTTL: 300 }); // 5 minute cache
        this.proxyList = [];
        this.currentIndex = 0;
        this.retryAttempts = 3;
        this.defaultTimeout = 10000;
        this.proxyEnabled = false;
        this.requestStats = new Map();
        this.lastRotation = Date.now();
        this.rotationInterval = 300000; // 5 minutes
    }

    async makeRequest(exchange, url, options = {}) {
        const cacheKey = `${exchange}_${url}`;
        const cachedResponse = this.cache.get(cacheKey);

        if (cachedResponse) {
            return cachedResponse;
        }

        let lastError;
        for (let attempt = 0; attempt < this.retryAttempts; attempt++) {
            try {
                const agent = this._getProxyAgent();
                const response = await this._fetchWithTimeout(url, {
                    ...options,
                    agent
                });
                
                const data = await response.json();
                if (this._isValidResponse(data)) {
                    this.cache.set(cacheKey, data);
                    this._updateStats(exchange, 'success');
                    return data;
                } else {
                    throw new Error('Invalid response format');
                }
            } catch (error) {
                lastError = error;
                this._updateStats(exchange, 'error');
                logger.warn(`Request attempt ${attempt + 1} failed:`, error);
                await this._handleError(exchange, error);
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }

        throw lastError;
    }

    _getProxyAgent() {
        if (!this.proxyEnabled || this.proxyList.length === 0) {
            return null;
        }

        const proxy = this.proxyList[this.currentIndex];
        this.currentIndex = (this.currentIndex + 1) % this.proxyList.length;

        if (proxy.startsWith('socks')) {
            return new SocksProxyAgent(proxy);
        } else {
            return new HttpsProxyAgent(proxy);
        }
    }

    async _fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            options.timeout || this.defaultTimeout
        );

        try {
            const requestOptions = {
                ...options,
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'VRSC-Arbitrage-Monitor/1.0',
                    ...options.headers
                }
            };

            const response = await fetch(url, requestOptions);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return response;
        } finally {
            clearTimeout(timeout);
        }
    }

    _isValidResponse(data) {
        return data !== null && typeof data === 'object';
    }

    _updateStats(exchange, result) {
        if (!this.requestStats.has(exchange)) {
            this.requestStats.set(exchange, {
                success: 0,
                error: 0,
                lastRequest: null
            });
        }

        const stats = this.requestStats.get(exchange);
        stats[result]++;
        stats.lastRequest = Date.now();
    }

    async _handleError(exchange, error) {
        const stats = this.requestStats.get(exchange);
        if (!stats) return;

        const totalRequests = stats.success + stats.error;
        const errorRate = stats.error / totalRequests;

        if (errorRate > 0.5 && totalRequests > 10) {
            logger.warn(`High error rate for ${exchange}, implementing backoff`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        if (Date.now() - this.lastRotation > this.rotationInterval) {
            this._rotateConnection();
        }
    }

    _rotateConnection() {
        this.lastRotation = Date.now();
        logger.info('Connection rotated');
    }

    getStats() {
        const stats = {};
        for (const [exchange, data] of this.requestStats.entries()) {
            stats[exchange] = {
                ...data,
                errorRate: data.error / (data.success + data.error) || 0
            };
        }
        return stats;
    }

    clearCache() {
        this.cache.flushAll();
        logger.info('Proxy cache cleared');
    }

    resetStats() {
        this.requestStats.clear();
        logger.info('Request statistics reset');
    }
}

export const proxyManager = new ProxyManager();