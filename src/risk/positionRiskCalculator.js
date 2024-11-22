import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import * as math from 'mathjs';

export class PositionRiskCalculator {
    constructor(config = {}) {
        this.config = {
            volatilityWindow: config.volatilityWindow || 20,
            confidenceLevel: config.confidenceLevel || 0.95,
            ...config
        };
    }

    calculatePositionRisk(position, marketData) {
        try {
            const metrics = {
                var: this._calculateVaR(position, marketData),
                volatility: this._calculateVolatility(marketData.priceHistory),
                leverage: this._calculateLeverage(position),
                concentration: this._calculateConcentration(position, marketData)
            };

            return {
                ...metrics,
                riskScore: this._calculateRiskScore(metrics)
            };
        } catch (error) {
            logger.error('Error calculating position risk:', error);
            return null;
        }
    }

    _calculateVaR(position, marketData) {
        const positionValue = new Decimal(position.amount).mul(position.entryPrice);
        const volatility = this._calculateVolatility(marketData.priceHistory);
        const z = this._getZScore(this.config.confidenceLevel);

        return positionValue.mul(volatility).mul(z).toString();
    }

    _calculateVolatility(priceHistory) {
        if (!priceHistory || priceHistory.length < 2) return 0;

        const returns = [];
        for (let i = 1; i < priceHistory.length; i++) {
            const currentPrice = new Decimal(priceHistory[i]);
            const previousPrice = new Decimal(priceHistory[i - 1]);
            returns.push(
                currentPrice.minus(previousPrice)
                    .div(previousPrice)
                    .toNumber()
            );
        }

        return math.std(returns);
    }

    _calculateLeverage(position) {
        // For spot trading, leverage is 1
        return new Decimal(1);
    }

    _calculateConcentration(position, marketData) {
        const positionValue = new Decimal(position.amount).mul(position.entryPrice);
        const marketVolume = new Decimal(marketData.volume || 0);

        return marketVolume.isZero() ? 
            new Decimal(1) : 
            positionValue.div(marketVolume);
    }

    _calculateRiskScore(metrics) {
        const weights = {
            var: 0.4,
            volatility: 0.3,
            leverage: 0.2,
            concentration: 0.1
        };

        const normalizedMetrics = {
            var: this._normalize(metrics.var, 0, 1000),
            volatility: metrics.volatility,
            leverage: metrics.leverage.toNumber(),
            concentration: metrics.concentration.toNumber()
        };

        return Object.entries(weights).reduce((score, [metric, weight]) => {
            return score + (normalizedMetrics[metric] * weight);
        }, 0);
    }

    _normalize(value, min, max) {
        return (new Decimal(value).minus(min))
            .div(new Decimal(max).minus(min))
            .toNumber();
    }

    _getZScore(confidenceLevel) {
        // Simplified z-score calculation
        const zScores = {
            0.95: 1.645,
            0.99: 2.326,
            0.999: 3.090
        };
        return zScores[confidenceLevel] || 1.645;
    }
}