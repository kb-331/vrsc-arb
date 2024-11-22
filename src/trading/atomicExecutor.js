import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionTimer } from '../utils/execution-timer.js';
import { ExchangeHealthMonitor } from '../utils/exchange-health.js';
import { RequestQueue } from '../utils/request-queue.js';
import Decimal from 'decimal.js';

export class AtomicExecutor extends EventEmitter {
    constructor(orderManager, balanceManager) {
        super();
        this.orderManager = orderManager;
        this.balanceManager = balanceManager;
        this.executionTimer = new ExecutionTimer();
        this.healthMonitor = new ExchangeHealthMonitor();
        this.requestQueue = new RequestQueue();
        this.activeExecutions = new Map();
    }

    async executeArbitrage(opportunity) {
        const executionId = uuidv4();
        logger.info(`Starting atomic execution ${executionId}`, opportunity);

        const execution = this.executionTimer.startExecution(executionId, [
            'validation',
            'buyOrder',
            'sellOrder',
            'settlement'
        ]);

        try {
            // Validate exchange health
            if (!this._validateExchangeHealth(opportunity)) {
                return null;
            }

            // Start validation stage
            this.executionTimer.startStage(executionId, 'validation');
            if (!await this._validatePreconditions(opportunity)) {
                return null;
            }
            this.executionTimer.completeStage(executionId, 'validation');

            // Execute buy order
            this.executionTimer.startStage(executionId, 'buyOrder');
            const buyOrder = await this._executeBuyOrder(opportunity);
            if (!buyOrder) {
                return null;
            }
            this.executionTimer.completeStage(executionId, 'buyOrder');

            // Execute sell order
            this.executionTimer.startStage(executionId, 'sellOrder');
            const sellOrder = await this._executeSellOrder(opportunity);
            if (!sellOrder) {
                await this._handleFailedSell(buyOrder);
                return null;
            }
            this.executionTimer.completeStage(executionId, 'sellOrder');

            // Settlement
            this.executionTimer.startStage(executionId, 'settlement');
            const result = await this._settleExecution(buyOrder, sellOrder);
            this.executionTimer.completeStage(executionId, 'settlement');

            return result;

        } catch (error) {
            logger.error(`Execution ${executionId} failed:`, error);
            await this._handleExecutionFailure(executionId, error);
            return null;
        }
    }

    _validateExchangeHealth(opportunity) {
        const buyExchangeHealth = this.healthMonitor.getStatus(opportunity.buyExchange);
        const sellExchangeHealth = this.healthMonitor.getStatus(opportunity.sellExchange);

        if (buyExchangeHealth.state !== 'healthy' || sellExchangeHealth.state !== 'healthy') {
            logger.warn('Exchange health check failed:', {
                buyExchange: buyExchangeHealth,
                sellExchange: sellExchangeHealth
            });
            return false;
        }

        return true;
    }

    async _validatePreconditions(opportunity) {
        try {
            // Check balances
            const balance = await this.balanceManager.getAvailableBalance(
                opportunity.buyExchange,
                'USDT'
            );

            const requiredAmount = new Decimal(opportunity.position.usdtAmount)
                .mul(1.01); // 1% buffer for fees

            if (balance.lessThan(requiredAmount)) {
                logger.warn('Insufficient balance:', {
                    required: requiredAmount.toString(),
                    available: balance.toString()
                });
                return false;
            }

            // Validate current prices
            const currentPrices = await this._getCurrentPrices(opportunity);
            if (!this._validatePrices(opportunity, currentPrices)) {
                return false;
            }

            return true;
        } catch (error) {
            logger.error('Precondition validation failed:', error);
            return false;
        }
    }

    async _executeBuyOrder(opportunity) {
        return await this.requestQueue.enqueue(
            opportunity.buyExchange,
            async () => {
                const order = await this.orderManager.createOrder({
                    exchange: opportunity.buyExchange,
                    side: 'buy',
                    amount: opportunity.position.vrscAmount,
                    price: opportunity.buyPrice,
                    type: 'limit'
                });

                if (!order) {
                    throw new Error('Failed to create buy order');
                }

                return order;
            }
        );
    }

    async _executeSellOrder(opportunity) {
        return await this.requestQueue.enqueue(
            opportunity.sellExchange,
            async () => {
                const order = await this.orderManager.createOrder({
                    exchange: opportunity.sellExchange,
                    side: 'sell',
                    amount: opportunity.position.vrscAmount,
                    price: opportunity.sellPrice,
                    type: 'limit'
                });

                if (!order) {
                    throw new Error('Failed to create sell order');
                }

                return order;
            }
        );
    }

    async _handleFailedSell(buyOrder) {
        try {
            await this.orderManager.cancelOrder(buyOrder.id);
            logger.info('Buy order cancelled after failed sell');
        } catch (error) {
            logger.error('Error handling failed sell:', error);
        }
    }

    async _settleExecution(buyOrder, sellOrder) {
        const buyFill = await this._waitForOrderFill(buyOrder);
        const sellFill = await this._waitForOrderFill(sellOrder);

        return {
            buyOrder: buyFill,
            sellOrder: sellFill,
            profit: this._calculateProfit(buyFill, sellFill)
        };
    }

    async _waitForOrderFill(order, timeout = 30000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const status = await this.orderManager.getOrder(order.id);
            if (status.status === 'filled') {
                return status;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error(`Order fill timeout: ${order.id}`);
    }

    _calculateProfit(buyFill, sellFill) {
        const buyTotal = new Decimal(buyFill.totalCost);
        const sellTotal = new Decimal(sellFill.totalCost);
        return {
            amount: sellTotal.minus(buyTotal).toString(),
            percent: sellTotal.minus(buyTotal).div(buyTotal).mul(100).toString()
        };
    }

    async _handleExecutionFailure(executionId, error) {
        const execution = this.executionTimer.getExecutionStatus(executionId);
        if (!execution) return;

        // Emit detailed failure event
        this.emit('executionFailure', {
            executionId,
            error: error.message,
            stages: Array.from(execution.stages.entries()),
            timestamp: Date.now()
        });

        // Clean up execution
        this.executionTimer.clearExecution(executionId);
    }

    async _getCurrentPrices(opportunity) {
        const [buyPrice, sellPrice] = await Promise.all([
            this._fetchPrice(opportunity.buyExchange),
            this._fetchPrice(opportunity.sellExchange)
        ]);

        return { buyPrice, sellPrice };
    }

    _validatePrices(opportunity, currentPrices) {
        const maxSlippage = 0.003; // 0.3%

        const buySlippage = Math.abs(
            currentPrices.buyPrice - opportunity.buyPrice
        ) / opportunity.buyPrice;

        const sellSlippage = Math.abs(
            currentPrices.sellPrice - opportunity.sellPrice
        ) / opportunity.sellPrice;

        if (buySlippage > maxSlippage || sellSlippage > maxSlippage) {
            logger.warn('Price slippage too high:', {
                buySlippage: `${(buySlippage * 100).toFixed(2)}%`,
                sellSlippage: `${(sellSlippage * 100).toFixed(2)}%`
            });
            return false;
        }

        return true;
    }

    async _fetchPrice(exchange) {
        // Implementation depends on your price feed system
        return null;
    }
}