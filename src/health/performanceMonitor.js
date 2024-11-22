import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { performance } from 'perf_hooks';

export class PerformanceMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.metrics = new Map();
        this.thresholds = new Map();
        this.config = {
            maxMetricsAge: config.maxMetricsAge || 3600000,  // 1 hour
            aggregationInterval: config.aggregationInterval || 60000,  // 1 minute
            ...config
        };
    }

    trackOperation(name, duration, metadata = {}) {
        if (!this.metrics.has(name)) {
            this.metrics.set(name, []);
        }

        const metrics = this.metrics.get(name);
        metrics.push({
            duration,
            timestamp: Date.now(),
            ...metadata
        });

        this._cleanupMetrics(name);
        this._checkThreshold(name, duration);
    }

    startTracking(name) {
        const startTime = performance.now();
        
        return {
            end: (metadata = {}) => {
                const duration = performance.now() - startTime;
                this.trackOperation(name, duration, metadata);
                return duration;
            }
        };
    }

    setThreshold(name, threshold) {
        this.thresholds.set(name, threshold);
    }

    getMetrics(name, timeRange = 3600000) {
        const metrics = this.metrics.get(name) || [];
        const cutoff = Date.now() - timeRange;

        const filtered = metrics.filter(m => m.timestamp >= cutoff);
        
        if (filtered.length === 0) {
            return null;
        }

        const durations = filtered.map(m => m.duration);
        
        return {
            name,
            count: filtered.length,
            min: Math.min(...durations),
            max: Math.max(...durations),
            avg: durations.reduce((a, b) => a + b, 0) / durations.length,
            p95: this._calculatePercentile(durations, 95),
            p99: this._calculatePercentile(durations, 99),
            timeRange
        };
    }

    getAllMetrics(timeRange = 3600000) {
        const results = {};
        
        for (const [name] of this.metrics) {
            results[name] = this.getMetrics(name, timeRange);
        }
        
        return results;
    }

    _cleanupMetrics(name) {
        const metrics = this.metrics.get(name);
        if (!metrics) return;

        const cutoff = Date.now() - this.config.maxMetricsAge;
        this.metrics.set(
            name,
            metrics.filter(m => m.timestamp >= cutoff)
        );
    }

    _checkThreshold(name, duration) {
        const threshold = this.thresholds.get(name);
        if (!threshold) return;

        if (duration > threshold) {
            this.emit('thresholdExceeded', {
                operation: name,
                duration,
                threshold,
                timestamp: Date.now()
            });
        }
    }

    _calculatePercentile(values, percentile) {
        if (values.length === 0) return 0;
        
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[index];
    }

    getAggregatedMetrics(timeRange = 3600000) {
        const now = Date.now();
        const cutoff = now - timeRange;
        const intervalMs = this.config.aggregationInterval;
        const results = new Map();

        for (const [name, metrics] of this.metrics) {
            const intervals = new Map();
            
            metrics
                .filter(m => m.timestamp >= cutoff)
                .forEach(metric => {
                    const intervalStart = Math.floor(metric.timestamp / intervalMs) * intervalMs;
                    
                    if (!intervals.has(intervalStart)) {
                        intervals.set(intervalStart, []);
                    }
                    
                    intervals.get(intervalStart).push(metric.duration);
                });

            results.set(name, Array.from(intervals.entries()).map(([timestamp, durations]) => ({
                timestamp,
                count: durations.length,
                avg: durations.reduce((a, b) => a + b, 0) / durations.length,
                min: Math.min(...durations),
                max: Math.max(...durations)
            })));
        }

        return results;
    }
}