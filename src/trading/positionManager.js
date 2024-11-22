import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

export class PositionManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.positions = new Map();
        this.config = {
            maxPositionSize: config.maxPositionSize || 1000,    // $1000 max position
            maxTotalExposure: config.maxTotalExposure || 5000,  // $5000 max total exposure
            maxPositionsPerExchange: config.maxPositionsPerExchange || 3,
            minProfitTarget: config.minProfitTarget || 0.5,     // 0.5% minimum profit
            stopLossPercent: config.stopLossPercent || 0.5,     // 0.5% stop loss
            ...config
        };
    }

    async openPosition(params) {
        try {
            const { exchange, side, amount, price, type = 'limit' } = params;

            // Validate position parameters
            const validationResult = this._validatePositionParams(params);
            if (!validationResult.isValid) {
                logger.warn(`Position validation failed: ${validationResult.reason}`);
                return null;
            }

            const position = {
                id: uuidv4(),
                exchange,
                side,
                amount: new Decimal(amount).toString(),
                entryPrice: new Decimal(price).toString(),
                type,
                status: 'open',
                timestamp: Date.now(),
                unrealizedPnL: '0',
                realizedPnL: '0',
                fills: [],
                stopLoss: this._calculateStopLoss(price, side),
                takeProfitTargets: this._calculateTakeProfitTargets(price, side)
            };

            // Store position
            this.positions.set(position.id, position);
            
            // Emit position opened event
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
            // Update position fields
            Object.assign(position, {
                ...update,
                lastUpdated: Date.now()
            });

            // Recalculate P&L if price updated
            if (update.currentPrice) {
                this._updatePnL(position, update.currentPrice);
            }

            // Check stop loss and take profit conditions
            if (update.currentPrice) {
                this._checkExitConditions(position, update.currentPrice);
            }

            this.emit('positionUpdated', position);
            return true;
        } catch (error) {
            logger.error('Error updating position:', error);
            return false;
        }
    }

    async closePosition(positionId, closePrice) {
        const position = this.positions.get(positionId);
        if (!position) {
            logger.warn(`Position ${positionId} not found`);
            return false;
        }

        try {
            position.status = 'closed';
            position.exitPrice = closePrice;
            position.closedAt = Date.now();
            
            // Calculate final P&L
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

    getPosition(positionId) {
        return this.positions.get(positionId);
    }

    getOpenPositions(exchange = null) {
        return Array.from(this.positions.values())
            .filter(p => p.status === 'open' && 
                (!exchange || p.exchange === exchange));
    }

    getTotalExposure() {
        return Array.from(this.positions.values())
            .filter(p => p.status === 'open')
            .reduce((total, position) => {
                const positionValue = new Decimal(position.amount)
                    .mul(position.entryPrice);
                return total.plus(positionValue);
            }, new Decimal(0));
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

        // Check position size
        const positionSize = new Decimal(amount).mul(price);
        if (positionSize.greaterThan(this.config.maxPositionSize)) {
            return { 
                isValid: false, 
                reason: 'Position size exceeds maximum' 
            };
        }

        // Check total exposure
        const totalExposure = this.getTotalExposure().plus(positionSize);
        if (totalExposure.greaterThan(this.config.maxTotalExposure)) {
            return { 
                isValid: false, 
                reason: 'Total exposure limit exceeded' 
            };
        }

        return { isValid: true };
    }

    _calculateStopLoss(price, side) {
        const stopLossMultiplier = side === 'buy' ? 
            1 - this.config.stopLossPercent : 
            1 + this.config.stopLossPercent;
        return new Decimal(price).mul(stopLossMultiplier).toString();
    }

    _calculateTakeProfitTargets(price, side) {
        const targets = [0.01, 0.02, 0.03]; // 1%, 2%, 3% targets
        return targets.map(target => {
            const multiplier = side === 'buy' ? 1 + target : 1 - target;
            return {
                price: new Decimal(price).mul(multiplier).toString(),
                percentage: target * 100,
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

    _calculatePnL(position, exitPrice) {
        const entryValue = new Decimal(position.amount).mul(position.entryPrice);
        const exitValue = new Decimal(position.amount).mul(exitPrice);
        
        return position.side === 'buy' ?
            exitValue.minus(entryValue) :
            entryValue.minus(exitValue);
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
                if (position.side === 'buy' && 
                    currentPriceDecimal.greaterThanOrEqualTo(target.price)) {
                    target.hit = true;
                    this.emit('takeProfitHit', { position, targetIndex: index });
                } else if (position.side === 'sell' && 
                    currentPriceDecimal.lessThanOrEqualTo(target.price)) {
                    target.hit = true;
                    this.emit('takeProfitHit', { position, targetIndex: index });
                }
            }
        });
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
                totalPnL.div(closedPositions.length).toString() : '0',
            currentExposure: this.getTotalExposure().toString()
        };
    }
}