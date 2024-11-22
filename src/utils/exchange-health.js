import { EventEmitter } from 'events';
import { logger } from './logger.js';

export class ExchangeHealthMonitor extends EventEmitter {
    constructor() {
        super();
        this.health = new Map();
        this.checkInterval = 60000; // 1 minute
        this.errorThreshold = 5;
        this.recoveryThreshold = 3;
        this.metrics = new Map();
    }

    recordSuccess(exchange) {
        const status = this._getStatus(exchange);
        status.successCount++;
        status.errorCount = 0;
        status.lastSuccess = Date.now();
        
        if (status.state === 'degraded' && status.successCount >= this.recoveryThreshold) {
            this._updateState(exchange, 'healthy');
        }

        this._updateMetrics(exchange, 'success');
    }

    recordError(exchange, error) {
        const status = this._getStatus(exchange);
        status.errorCount++;
        status.lastError = error;
        status.lastErrorTime = Date.now();

        if (status.errorCount >= this.errorThreshold) {
            this._updateState(exchange, 'degraded');
        }

        this._updateMetrics(exchange, 'error');
    }

    isHealthy(exchange) {
        const status = this._getStatus(exchange);
        return status.state === 'healthy';
    }

    getStatus(exchange) {
        return this._getStatus(exchange);
    }

    getMetrics(exchange) {
        return this.metrics.get(exchange) || {
            successRate: 0,
            avgResponseTime: 0,
            errorRate: 0
        };
    }

    _getStatus(exchange) {
        if (!this.health.has(exchange)) {
            this.health.set(exchange, {
                state: 'healthy',
                successCount: 0,
                errorCount: 0,
                lastSuccess: null,
                lastError: null,
                lastErrorTime: null,
                responseTime: []
            });
        }
        return this.health.get(exchange);
    }

    _updateState(exchange, newState) {
        const status = this._getStatus(exchange);
        const oldState = status.state;
        status.state = newState;

        if (oldState !== newState) {
            this.emit('stateChange', {
                exchange,
                oldState,
                newState,
                timestamp: Date.now()
            });

            logger.info(`Exchange ${exchange} state changed from ${oldState} to ${newState}`);
        }
    }

    _updateMetrics(exchange, type) {
        if (!this.metrics.has(exchange)) {
            this.metrics.set(exchange, {
                totalRequests: 0,
                successCount: 0,
                errorCount: 0,
                responseTimes: []
            });
        }

        const metrics = this.metrics.get(exchange);
        metrics.totalRequests++;
        
        if (type === 'success') {
            metrics.successCount++;
        } else {
            metrics.errorCount++;
        }

        // Calculate rates
        const successRate = (metrics.successCount / metrics.totalRequests) * 100;
        const errorRate = (metrics.errorCount / metrics.totalRequests) * 100;

        this.metrics.set(exchange, {
            ...metrics,
            successRate,
            errorRate
        });
    }
}