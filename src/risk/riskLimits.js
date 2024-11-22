import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class RiskLimits extends EventEmitter {
    constructor(config = {}) {
        super();
        this.limits = {
            position: {
                max: config.maxPositionSize || 1000,
                min: config.minPositionSize || 10
            },
            exposure: {
                max: config.maxTotalExposure || 5000,
                daily: config.maxDailyExposure || 10000
            },
            loss: {
                max: config.maxLoss || 100,
                daily: config.maxDailyLoss || 500
            },
            metrics: {
                maxDrawdown: config.maxDrawdown || 0.02,
                maxSlippage: config.maxSlippage || 0.003,
                minLiquidity: config.minLiquidity || 10000
            }
        };

        this.currentMetrics = this._initializeMetrics();
    }

    checkLimit(type, value, context = {}) {
        try {
            const check = this._getLimitCheck(type);
            if (!check) {
                logger.warn(`Unknown limit type: ${type}`);
                return { allowed: false, reason: 'Unknown limit type' };
            }

            return check.call(this, new Decimal(value), context);
        } catch (error) {
            logger.error('Error checking limit:', error);
            return { allowed: false, reason: error.message };
        }
    }

    updateMetrics(update) {
        Object.assign(this.currentMetrics, {
            ...update,
            lastUpdated: Date.now()
        });

        this._checkMetricBreaches();
    }

    _initializeMetrics() {
        return {
            dailyExposure: new Decimal(0),
            dailyLoss: new Decimal(0),
            currentDrawdown: new Decimal(0),
            lastUpdated: Date.now()
        };
    }

    _getLimitCheck(type) {
        const checks = {
            position: this._checkPositionLimit.bind(this),
            exposure: this._checkExposureLimit.bind(this),
            loss: this._checkLossLimit.bind(this),
            drawdown: this._checkDrawdownLimit.bind(this),
            slippage: this._checkSlippageLimit.bind(this),
            liquidity: this._checkLiquidityLimit.bind(this)
        };

        return checks[type];
    }

    _checkPositionLimit(value) {
        if (value.lessThan(this.limits.position.min)) {
            return {
                allowed: false,
                reason: 'Position size below minimum'
            };
        }

        if (value.greaterThan(this.limits.position.max)) {
            return {
                allowed: false,
                reason: 'Position size above maximum'
            };
        }

        return { allowed: true };
    }

    _checkExposureLimit(value, context) {
        const totalExposure = this.currentMetrics.dailyExposure.plus(value);

        if (totalExposure.greaterThan(this.limits.exposure.daily)) {
            return {
                allowed: false,
                reason: 'Daily exposure limit exceeded'
            };
        }

        if (value.greaterThan(this.limits.exposure.max)) {
            return {
                allowed: false,
                reason: 'Single exposure limit exceeded'
            };
        }

        return { allowed: true };
    }

    _checkLossLimit(value) {
        const totalLoss = this.currentMetrics.dailyLoss.plus(value);

        if (totalLoss.greaterThan(this.limits.loss.daily)) {
            return {
                allowed: false,
                reason: 'Daily loss limit exceeded'
            };
        }

        if (value.greaterThan(this.limits.loss.max)) {
            return {
                allowed: false,
                reason: 'Single loss limit exceeded'
            };
        }

        return { allowed: true };
    }

    _checkDrawdownLimit(value) {
        if (value.greaterThan(this.limits.metrics.maxDrawdown)) {
            return {
                allowed: false,
                reason: 'Maximum drawdown exceeded'
            };
        }

        return { allowed: true };
    }

    _checkSlippageLimit(value) {
        if (value.greaterThan(this.limits.metrics.maxSlippage)) {
            return {
                allowed: false,
                reason: 'Maximum slippage exceeded'
            };
        }

        return { allowed: true };
    }

    _checkLiquidityLimit(value) {
        if (value.lessThan(this.limits.metrics.minLiquidity)) {
            return {
                allowed: false,
                reason: 'Insufficient liquidity'
            };
        }

        return { allowed: true };
    }

    _checkMetricBreaches() {
        const checks = [
            {
                type: 'drawdown',
                value: this.currentMetrics.currentDrawdown
            },
            {
                type: 'exposure',
                value: this.currentMetrics.dailyExposure
            },
            {
                type: 'loss',
                value: this.currentMetrics.dailyLoss
            }
        ];

        for (const check of checks) {
            const result = this.checkLimit(check.type, check.value);
            if (!result.allowed) {
                this.emit('limitBreached', {
                    type: check.type,
                    value: check.value.toString(),
                    reason: result.reason,
                    timestamp: Date.now()
                });
            }
        }
    }

    getLimits() {
        return this.limits;
    }

    getCurrentMetrics() {
        return {
            ...this.currentMetrics,
            dailyExposure: this.currentMetrics.dailyExposure.toString(),
            dailyLoss: this.currentMetrics.dailyLoss.toString(),
            currentDrawdown: this.currentMetrics.currentDrawdown.toString()
        };
    }
}