import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

export class TradeExecutor extends EventEmitter {
    constructor(orderManager, balanceManager, positionCalculator) {
        super();
        this.orderManager = orderManager;
        this.balanceManager = balanceManager;
        this.positionCalculator = positionCalculator;
        this.isExecuting = false;
        this.executionTimeout = 45000; // 45 second timeout
        this.maxSlippagePercent = 0.3; // 0.3% maximum slippage
        this.minProfitPercent = 0.5;   // 0.5% minimum profit
    }

    async executeArbitrage(opportunity) {
        const executionId = uuidv4();
        logger.info(`Starting arbitrage execution ${executionId}`, opportunity);

        if (this.isExecuting) {
            logger.warn('Trade execution already in progress');
            return false;
        }

        this.isExecuting = true;
        const startTime = Date.now();

        try {
            // Validate current prices
            if (!await this._validatePrices(opportunity)) {
                return false;
            }

            // Check balances
            if (!await this._checkBalances(opportunity)) {
                return false;
            }

            // Execute trades
            const buyOrder = await this._executeBuyOrder(opportunity);
            if (!buyOrder) {
                return false;
            }

            const sellOrder = await this._executeSellOrder(opportunity);
            if (!sellOrder) {
                await this._handleFailedSell(buyOrder);
                return false;
            }

            // Monitor execution
            const success = await this._monitorExecution(buyOrder, sellOrder);
            
            // Post-execution analysis
            if (success) {
                await this._performPostTradeAnalysis(buyOrder, sellOrder, startTime);
            }

            return success;

        } catch (error) {
            logger.error('Critical error in arbitrage execution:', error);
            return false;
        } finally {
            this.isExecuting = false;
        }
    }

    async _validatePrices(opportunity) {
        const currentBuyPrice = await this._getCurrentPrice(opportunity.buyExchange);
        const currentSellPrice = await this._getCurrentPrice(opportunity.sellExchange);

        if (!currentBuyPrice || !currentSellPrice) {
            logger.warn('Unable to validate current prices');
            return false;
        }

        const buyPriceChange = Math.abs(currentBuyPrice - opportunity.buyPrice) / opportunity.buyPrice;
        const sellPriceChange = Math.abs(currentSellPrice - opportunity.sellPrice) / opportunity.sellPrice;

        if (buyPriceChange > this.maxSlippagePercent || sellPriceChange > this.maxSlippagePercent) {
            logger.warn('Prices have moved beyond slippage tolerance', {
                buyPriceChange: `${(buyPriceChange * 100).toFixed(2)}%`,
                sellPriceChange: `${(sellPriceChange * 100).toFixed(2)}%`
            });
            return false;
        }

        // Recalculate profit with current prices
        const spread = (currentSellPrice - currentBuyPrice) / currentBuyPrice;
        if (spread < this.minProfitPercent) {
            logger.warn('Profit opportunity no longer viable', {
                spread: `${(spread * 100).toFixed(2)}%`,
                minimum: `${(this.minProfitPercent * 100).toFixed(2)}%`
            });
            return false;
        }

        return true;
    }

    async _checkBalances(opportunity) {
        const buyExchangeBalance = await this.balanceManager.getAvailableBalance(
            opportunity.buyExchange,
            'USDT'
        );

        const requiredAmount = new Decimal(opportunity.position.usdtAmount)
            .mul(1.01); // Add 1% buffer for fees

        if (buyExchangeBalance.lessThan(requiredAmount)) {
            logger.warn('Insufficient balance for buy order', {
                required: requiredAmount.toString(),
                available: buyExchangeBalance.toString()
            });
            return false;
        }

        return true;
    }

    async _executeBuyOrder(opportunity) {
        try {
            const order = await this.orderManager.createOrder({
                exchange: opportunity.buyExchange,
                side: 'buy',
                amount: opportunity.position.vrscAmount,
                price: opportunity.buyPrice,
                type: 'limit'
            });

            if (!order) {
                logger.error('Failed to create buy order');
                return null;
            }

            logger.info('Buy order created:', order);
            return order;

        } catch (error) {
            logger.error('Error executing buy order:', error);
            return null;
        }
    }

    async _executeSellOrder(opportunity) {
        try {
            const order = await this.orderManager.createOrder({
                exchange: opportunity.sellExchange,
                side: 'sell',
                amount: opportunity.position.vrscAmount,
                price: opportunity.sellPrice,
                type: 'limit'
            });

            if (!order) {
                logger.error('Failed to create sell order');
                return null;
            }

            logger.info('Sell order created:', order);
            return order;

        } catch (error) {
            logger.error('Error executing sell order:', error);
            return null;
        }
    }

    async _monitorExecution(buyOrder, sellOrder) {
        const startTime = Date.now();
        let buyFilled = false;
        let sellFilled = false;

        while (Date.now() - startTime < this.executionTimeout) {
            try {
                const buyStatus = await this.orderManager.getOrder(buyOrder.id);
                const sellStatus = await this.orderManager.getOrder(sellOrder.id);

                buyFilled = buyStatus.status === 'filled';
                sellFilled = sellStatus.status === 'filled';

                if (buyFilled && sellFilled) {
                    logger.info('Both orders successfully filled');
                    return true;
                }

                // Check for cancellations or failures
                if (buyStatus.status === 'cancelled' || sellStatus.status === 'cancelled') {
                    logger.warn('Order cancelled, initiating recovery');
                    await this._handleCancellation(buyStatus, sellStatus);
                    return false;
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                logger.error('Error monitoring execution:', error);
            }
        }

        // Timeout reached
        logger.error('Execution timeout reached');
        await this._handleTimeout(buyOrder, sellOrder);
        return false;
    }

    async _handleFailedSell(buyOrder) {
        try {
            await this.orderManager.cancelOrder(buyOrder.id);
            logger.info('Buy order cancelled after failed sell');
        } catch (error) {
            logger.error('Error handling failed sell:', error);
        }
    }

    async _handleCancellation(buyStatus, sellStatus) {
        try {
            if (!buyStatus.filled) {
                await this.orderManager.cancelOrder(buyStatus.id);
            }
            if (!sellStatus.filled) {
                await this.orderManager.cancelOrder(sellStatus.id);
            }
        } catch (error) {
            logger.error('Error handling cancellation:', error);
        }
    }

    async _handleTimeout(buyOrder, sellOrder) {
        try {
            await Promise.all([
                this.orderManager.cancelOrder(buyOrder.id),
                this.orderManager.cancelOrder(sellOrder.id)
            ]);
            logger.info('Orders cancelled due to timeout');
        } catch (error) {
            logger.error('Error handling timeout:', error);
        }
    }

    async _performPostTradeAnalysis(buyOrder, sellOrder, startTime) {
        const executionTime = Date.now() - startTime;
        const buyFill = this._calculateFillMetrics(buyOrder);
        const sellFill = this._calculateFillMetrics(sellOrder);
        
        logger.info('Trade Analysis:', {
            executionTime: `${executionTime}ms`,
            buyMetrics: buyFill,
            sellMetrics: sellFill,
            netProfit: this._calculateNetProfit(buyFill, sellFill)
        });
    }

    _calculateFillMetrics(order) {
        const avgPrice = new Decimal(order.totalCost).div(order.totalFilled);
        const expectedPrice = new Decimal(order.price);
        const slippage = avgPrice
            .minus(expectedPrice)
            .div(expectedPrice)
            .mul(100);

        return {
            avgPrice: avgPrice.toString(),
            totalFilled: order.totalFilled,
            totalCost: order.totalCost,
            slippage: slippage.toString()
        };
    }

    _calculateNetProfit(buyFill, sellFill) {
        const buyTotal = new Decimal(buyFill.totalCost);
        const sellTotal = new Decimal(sellFill.totalCost);
        return sellTotal.minus(buyTotal).toString();
    }

    async _getCurrentPrice(exchange) {
        try {
            // Implementation would depend on your price feed system
            return null;
        } catch (error) {
            logger.error('Error getting current price:', error);
            return null;
        }
    }
}