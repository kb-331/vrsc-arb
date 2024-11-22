import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

export class PositionManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.positions = new Map();
        this.config = {
            maxPositionsPerExchange: config.maxPositionsPerExchange || 3,
            minProfitTarget: config.minProfitTarget || 0.5,     // 0.5% minimum profit
            stopLossPercent: config.stopLossPercent || 0.5,     // 0.5% stop loss
            ...config
        };
    }

    async openPosition(params) {
        try {
            const { exchange, symbol, side, amount, price } = params;

            // Validate position parameters
            const validationResult = this._validatePositionParams(params);
            if (!validationResult.isValid) {
                logger.warn(`Position validation failed: ${validationResult.reason}`);
                return null;
            }

            const position = {
                id: uuidv4(),
                exchange,
                symbol,
                side,
                amount: new Decimal(amount).toString(),
                entryPrice: new Decimal(price).toString(),
                status: 'open',
                timestamp: Date.now(),
                unrealizedPnL: '0',
                realizedPnL: '0',
                stopLoss: this._calculateStopLoss(price, side),
                takeProfitTargets: this._calculateTakeProfitTargets(price, side)
            };

            this.positions.set(position.id, position);
            this.emit('positionOpened', position);

            return position;
        } catch (error) {
            logger.error('Error opening position:', error);
            return null;
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
                this._checkExitConditions(position, update.currentPrice);
            }

            this.emit('positionUpdated', position);
            return true;
        } catch (error) {
            logger.error('Error updating position:', error);
            return false;
        }
    }

    async closePosition(positionId, closePrice, reason = '') {
        const position = this.positions.get(positionId);
        if (!position) {
            logger.warn(`Position ${positionId} not found`);
            return false;
        }

        try {
            position.status = 'closed';
            position.exitPrice = closePrice;
            position.closedAt = Date.now();
            position.closeReason = reason;
            
            const finalPnL = this._calculatePnL(position, closePrice);
            position.realizedPnL = finalPnL.toString();
            position.unrealizedPnL = '0';

            this.emit('positionClosed', {
                ...position,
                finalPnL: finalPnL.toString()
            });

            return true;
        } catch (error) {
            logger.error('Error closing position:', error);
            return false;
        }
    }

    _validatePositionParams(params) {
        const { exchange, amount, price } = params;

        // Check exchange position limit
        const exchangePositions = this.getOpenPositions(exchange).length;
        if (exchangePositions >= this.config.maxPositionsPerExchange) {
            return { 
                isValid: false, 
                reason: 'Exchange position limit reached' 
            };
        }

        return { isValid: true };
    }

    _calculateStopLoss(price, side) {
        const stopLossMultiplier = side === 'buy' ? 
            1 - this.config.stopLossPercent / 100 : 
            1 + this.config.stopLossPercent / 100;
        return new Decimal(price).mul(stopLossMultiplier).toString();
    }

    _calculateTakeProfitTargets(price, side) {
        const targets = [1, 2, 3]; // 1%, 2%, 3% targets
        return targets.map(target => {
            const multiplier = side === 'buy' ? 
                1 + target / 100 : 
                1 - target / 100;
            return {
                price: new Decimal(price).mul(multiplier).toString(),
                percentage: target,
                hit: false
            };
        });
    }

    _updatePnL(position, currentPrice) {
        const entryValue = new Decimal(position.amount).mul(position.entryPrice);
        const currentValue = new Decimal(position.amount).mul(currentPrice);
        
        position.unrealizedPnL = position.side === 'buy' ?
            currentValue.minus(entryValue).toString() :
            entryValue.minus(currentValue).toString();
    }

    _checkExitConditions(position, currentPrice) {
        const currentPriceDecimal = new Decimal(currentPrice);

        // Check stop loss
        if (position.side === 'buy' && 
            currentPriceDecimal.lessThanOrEqualTo(position.stopLoss)) {
            this.emit('stopLossTriggered', position);
        } else if (position.side === 'sell' && 
            currentPriceDecimal.greaterThanOrEqualTo(position.stopLoss)) {
            this.emit('stopLossTriggered', position);
        }

        // Check take profit targets
        position.takeProfitTargets.forEach((target, index) => {
            if (!target.hit) {
                const targetPrice = new Decimal(target.price);
                if ((position.side === 'buy' && currentPriceDecimal.greaterThanOrEqualTo(targetPrice)) ||
                    (position.side === 'sell' && currentPriceDecimal.lessThanOrEqualTo(targetPrice))) {
                    target.hit = true;
                    this.emit('takeProfitHit', { position, targetIndex: index });
                }
            }
        });
    }

    getPosition(positionId) {
        return this.positions.get(positionId);
    }

    getOpenPositions(exchange = null) {
        return Array.from(this.positions.values())
            .filter(p => p.status === 'open' && 
                (!exchange || p.exchange === exchange));
    }

    getPositionMetrics() {
        const positions = Array.from(this.positions.values());
        const openPositions = positions.filter(p => p.status === 'open');
        const closedPositions = positions.filter(p => p.status === 'closed');

        const totalPnL = closedPositions.reduce((sum, p) => 
            sum.plus(new Decimal(p.realizedPnL)), new Decimal(0));

        return {
            totalPositions: positions.length,
            openPositions: openPositions.length,
            closedPositions: closedPositions.length,
            totalPnL: totalPnL.toString(),
            averagePnL: closedPositions.length > 0 ? 
                totalPnL.div(closedPositions.length).toString() : '0'
        };
    }
}