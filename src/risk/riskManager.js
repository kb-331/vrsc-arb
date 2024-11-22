import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

export class RiskManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            maxPositionSize: config.maxPositionSize || 1000,    // $1000 max position
            maxTotalExposure: config.maxTotalExposure || 5000,  // $5000 max total exposure
            maxDrawdown: config.maxDrawdown || 0.02,            // 2% max drawdown
            maxDailyLoss: config.maxDailyLoss || 0.05,         // 5% max daily loss
            minLiquidity: config.minLiquidity || 10000,        // $10,000 min liquidity
            maxSlippage: config.maxSlippage || 0.003,          // 0.3% max slippage
            ...config
        };
        
        this.positions = new Map();
        this.dailyStats = this._initializeDailyStats();
    }

    async validateTrade(params) {
        try {
            const {
                exchange,
                symbol,
                side,
                amount,
                price,
                marketData
            } = params;

            // Position size check
            const positionSize = new Decimal(amount).mul(price);
            if (positionSize.greaterThan(this.config.maxPositionSize)) {
                return {
                    isValid: false,
                    reason: 'Position size exceeds maximum allowed'
                };
            }

            // Total exposure check
            const totalExposure = this._calculateTotalExposure();
            if (totalExposure.plus(positionSize).greaterThan(this.config.maxTotalExposure)) {
                return {
                    isValid: false,
                    reason: 'Total exposure limit exceeded'
                };
            }

            // Liquidity check
            if (!this._validateLiquidity(marketData)) {
                return {
                    isValid: false,
                    reason: 'Insufficient market liquidity'
                };
            }

            // Drawdown check
            if (!this._checkDrawdownLimit(positionSize)) {
                return {
                    isValid: false,
                    reason: 'Trade would exceed drawdown limit'
                };
            }

            return {
                isValid: true,
                adjustedAmount: amount,
                riskMetrics: this._calculateRiskMetrics(params)
            };

        } catch (error) {
            logger.error('Error validating trade:', error);
            return {
                isValid: false,
                reason: error.message
            };
        }
    }

    async updatePosition(positionId, update) {
        const position = this.positions.get(positionId);
        if (!position) {
            logger.warn(`Position ${positionId} not found`);
            return false;
        }

        try {
            Object.assign(position, {
                ...update,
                lastUpdated: Date.now()
            });

            if (update.currentPrice) {
                this._updatePnL(position, update.currentPrice);
            }

            this.emit('positionUpdated', position);
            return true;
        } catch (error) {
            logger.error('Error updating position:', error);
            return false;
        }
    }

    _initializeDailyStats() {
        return {
            trades: 0,
            volume: '0',
            realized: '0',
            unrealized: '0',
            maxDrawdown: '0',
            startTime: Date.now()
        };
    }

    _calculateTotalExposure() {
        return Array.from(this.positions.values())
            .filter(p => p.status === 'open')
            .reduce((total, position) => {
                const positionValue = new Decimal(position.amount)
                    .mul(position.entryPrice);
                return total.plus(positionValue);
            }, new Decimal(0));
    }

    _validateLiquidity(marketData) {
        if (!marketData?.liquidity) return false;
        return new Decimal(marketData.liquidity).greaterThanOrEqualTo(this.config.minLiquidity);
    }

    _checkDrawdownLimit(positionSize) {
        const currentDrawdown = new Decimal(this.dailyStats.maxDrawdown);
        const potentialDrawdown = currentDrawdown.plus(
            positionSize.mul(this.config.maxSlippage)
        );

        return potentialDrawdown.lessThan(this.config.maxDrawdown);
    }

    _updatePnL(position, currentPrice) {
        const entryValue = new Decimal(position.amount).mul(position.entryPrice);
        const currentValue = new Decimal(position.amount).mul(currentPrice);
        
        position.unrealizedPnL = position.side === 'buy' ?
            currentValue.minus(entryValue).toString() :
            entryValue.minus(currentValue).toString();
    }

    _calculateRiskMetrics(params) {
        const positionSize = new Decimal(params.amount).mul(params.price);
        const maxLoss = positionSize.mul(this.config.maxSlippage);

        return {
            positionSize: positionSize.toString(),
            maxLoss: maxLoss.toString(),
            exposurePercent: positionSize.div(this.config.maxTotalExposure).mul(100).toString()
        };
    }

    getRiskMetrics() {
        return {
            dailyStats: this.dailyStats,
            positions: Array.from(this.positions.values()),
            totalExposure: this._calculateTotalExposure().toString(),
            limits: this.config
        };
    }
}