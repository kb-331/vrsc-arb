import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import { format } from 'date-fns';

export class MonitoringSystem extends EventEmitter {
    constructor(config = {}) {
        super();
        this.metrics = new Map();
        this.alerts = new Map();
        this.thresholds = {
            profitMin: config.profitMin || 0.5,        // 0.5% minimum profit
            balanceMin: config.balanceMin || 100,      // $100 minimum balance
            spreadMin: config.spreadMin || 0.5,        // 0.5% minimum spread
            volumeMin: config.volumeMin || 1000,       // $1000 minimum volume
            errorRateMax: config.errorRateMax || 0.05  // 5% maximum error rate
        };
        this.errorCounts = new Map();
        this.lastCheck = Date.now();
    }

    async trackMetric(category, name, value) {
        const key = `${category}:${name}`;
        if (!this.metrics.has(key)) {
            this.metrics.set(key, []);
        }
        
        const metrics = this.metrics.get(key);
        metrics.push({
            value,
            timestamp: Date.now()
        });

        // Keep last 24 hours of metrics
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        this.metrics.set(key, metrics.filter(m => m.timestamp > oneDayAgo));

        // Check thresholds
        await this._checkThresholds(category, name, value);
    }

    async trackError(category, error) {
        if (!this.errorCounts.has(category)) {
            this.errorCounts.set(category, []);
        }

        const errors = this.errorCounts.get(category);
        errors.push({
            error: error.message,
            timestamp: Date.now()
        });

        // Keep last hour of errors
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        this.errorCounts.set(category, errors.filter(e => e.timestamp > oneHourAgo));

        // Calculate error rate
        const errorRate = errors.length / (60 * 60); // Errors per second
        if (errorRate > this.thresholds.errorRateMax) {
            await this._createAlert('error_rate', {
                category,
                rate: errorRate,
                threshold: this.thresholds.errorRateMax,
                errors: errors.slice(-5) // Last 5 errors
            });
        }
    }

    async checkBalances(balances) {
        for (const [exchange, currencies] of Object.entries(balances)) {
            for (const [currency, amounts] of Object.entries(currencies)) {
                const available = new Decimal(amounts.available);
                
                if (available.lessThan(this.thresholds.balanceMin)) {
                    await this._createAlert('low_balance', {
                        exchange,
                        currency,
                        balance: available.toString(),
                        threshold: this.thresholds.balanceMin
                    });
                }

                await this.trackMetric('balance', `${exchange}_${currency}`, available.toString());
            }
        }
    }

    async checkSpread(buyPrice, sellPrice) {
        const spread = new Decimal(sellPrice)
            .minus(buyPrice)
            .div(buyPrice)
            .mul(100);

        await this.trackMetric('market', 'spread', spread.toString());

        if (spread.lessThan(this.thresholds.spreadMin)) {
            await this._createAlert('low_spread', {
                spread: spread.toString(),
                threshold: this.thresholds.spreadMin,
                buyPrice,
                sellPrice
            });
        }

        return spread.toString();
    }

    async checkVolume(exchange, volume) {
        const volumeDecimal = new Decimal(volume);
        await this.trackMetric('market', `${exchange}_volume`, volume);

        if (volumeDecimal.lessThan(this.thresholds.volumeMin)) {
            await this._createAlert('low_volume', {
                exchange,
                volume: volume.toString(),
                threshold: this.thresholds.volumeMin
            });
        }
    }

    async getMetrics(category) {
        const metrics = {};
        for (const [key, values] of this.metrics.entries()) {
            if (key.startsWith(category)) {
                const name = key.split(':')[1];
                metrics[name] = values;
            }
        }
        return metrics;
    }

    async getAlerts(severity = 'all') {
        const alerts = Array.from(this.alerts.values());
        if (severity === 'all') {
            return alerts;
        }
        return alerts.filter(alert => alert.severity === severity);
    }

    async _createAlert(type, data) {
        const alert = {
            id: Date.now().toString(),
            type,
            data,
            severity: this._calculateSeverity(type, data),
            timestamp: Date.now(),
            acknowledged: false
        };

        this.alerts.set(alert.id, alert);
        this.emit('alert', alert);

        logger.warn(`Alert created: ${type}`, data);
        return alert;
    }

    _calculateSeverity(type, data) {
        switch (type) {
            case 'error_rate':
                return data.rate > this.thresholds.errorRateMax * 2 ? 'critical' : 'warning';
            case 'low_balance':
                return new Decimal(data.balance)
                    .lessThan(this.thresholds.balanceMin / 2) ? 'critical' : 'warning';
            case 'low_spread':
                return new Decimal(data.spread)
                    .lessThan(this.thresholds.spreadMin / 2) ? 'critical' : 'warning';
            case 'low_volume':
                return new Decimal(data.volume)
                    .lessThan(this.thresholds.volumeMin / 2) ? 'critical' : 'warning';
            default:
                return 'info';
        }
    }

    async _checkThresholds(category, name, value) {
        const valueDecimal = new Decimal(value);

        switch (category) {
            case 'profit':
                if (valueDecimal.lessThan(this.thresholds.profitMin)) {
                    await this._createAlert('low_profit', {
                        metric: name,
                        value: value.toString(),
                        threshold: this.thresholds.profitMin
                    });
                }
                break;
            
            case 'performance':
                // Add performance-specific threshold checks
                break;
        }
    }

    getSystemStatus() {
        const now = Date.now();
        const metrics = Array.from(this.metrics.entries());
        const alerts = Array.from(this.alerts.values());
        const errors = Array.from(this.errorCounts.entries());

        return {
            uptime: now - this.lastCheck,
            metrics: {
                total: metrics.length,
                categories: this._countCategories(metrics)
            },
            alerts: {
                total: alerts.length,
                active: alerts.filter(a => !a.acknowledged).length,
                critical: alerts.filter(a => a.severity === 'critical').length
            },
            errors: {
                total: errors.reduce((sum, [_, errs]) => sum + errs.length, 0),
                categories: this._countErrors(errors)
            },
            lastUpdate: format(now, 'yyyy-MM-dd HH:mm:ss')
        };
    }

    _countCategories(metrics) {
        const categories = {};
        for (const [key] of metrics) {
            const category = key.split(':')[0];
            categories[category] = (categories[category] || 0) + 1;
        }
        return categories;
    }

    _countErrors(errors) {
        const counts = {};
        for (const [category, errs] of errors) {
            counts[category] = errs.length;
        }
        return counts;
    }
}