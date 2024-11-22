import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { ExecutionTimer } from '../utils/execution-timer.js';
import Decimal from 'decimal.js';
import { v4 as uuidv4 } from 'uuid';

export class SettlementManager extends EventEmitter {
    constructor(balanceManager, orderManager) {
        super();
        this.balanceManager = balanceManager;
        this.orderManager = orderManager;
        this.executionTimer = new ExecutionTimer();
        this.settlements = new Map();
        this.config = {
            maxSettlementTime: 300000,  // 5 minutes
            confirmations: 3,           // Number of balance confirmations
            retryAttempts: 3,          // Settlement retry attempts
            retryDelay: 10000          // 10 seconds between retries
        };
    }

    async settleArbitrage(buyOrder, sellOrder) {
        const settlementId = uuidv4();
        logger.info(`Starting settlement ${settlementId}`);

        const settlement = {
            id: settlementId,
            buyOrder,
            sellOrder,
            status: 'pending',
            startTime: Date.now(),
            stages: [],
            confirmations: 0
        };

        this.settlements.set(settlementId, settlement);

        try {
            // Start settlement timer
            this.executionTimer.startExecution(settlementId, [
                'buyConfirmation',
                'sellConfirmation',
                'balanceVerification',
                'finalConfirmation'
            ]);

            // Confirm buy order
            await this._confirmBuyOrder(settlement);

            // Confirm sell order
            await this._confirmSellOrder(settlement);

            // Verify final balances
            await this._verifyBalances(settlement);

            // Final confirmation
            await this._finalizeSettlement(settlement);

            return {
                success: true,
                settlementId,
                duration: Date.now() - settlement.startTime,
                profit: this._calculateProfit(settlement)
            };

        } catch (error) {
            logger.error(`Settlement ${settlementId} failed:`, error);
            await this._handleSettlementFailure(settlement, error);
            return {
                success: false,
                settlementId,
                error: error.message
            };
        }
    }

    async _confirmBuyOrder(settlement) {
        this.executionTimer.startStage(settlement.id, 'buyConfirmation');
        
        const buyOrder = await this._waitForOrderConfirmation(
            settlement.buyOrder.id,
            'buy'
        );

        if (!buyOrder) {
            throw new Error('Buy order confirmation failed');
        }

        settlement.stages.push({
            stage: 'buyConfirmation',
            timestamp: Date.now(),
            data: buyOrder
        });

        this.executionTimer.completeStage(settlement.id, 'buyConfirmation');
    }

    async _confirmSellOrder(settlement) {
        this.executionTimer.startStage(settlement.id, 'sellConfirmation');
        
        const sellOrder = await this._waitForOrderConfirmation(
            settlement.sellOrder.id,
            'sell'
        );

        if (!sellOrder) {
            throw new Error('Sell order confirmation failed');
        }

        settlement.stages.push({
            stage: 'sellConfirmation',
            timestamp: Date.now(),
            data: sellOrder
        });

        this.executionTimer.completeStage(settlement.id, 'sellConfirmation');
    }

    async _verifyBalances(settlement) {
        this.executionTimer.startStage(settlement.id, 'balanceVerification');
        
        const buyExchange = settlement.buyOrder.exchange;
        const sellExchange = settlement.sellOrder.exchange;
        
        // Verify balances on both exchanges
        const buyBalance = await this._confirmBalance(buyExchange, 'VRSC');
        const sellBalance = await this._confirmBalance(sellExchange, 'USDT');

        if (!buyBalance || !sellBalance) {
            throw new Error('Balance verification failed');
        }

        settlement.stages.push({
            stage: 'balanceVerification',
            timestamp: Date.now(),
            data: { buyBalance, sellBalance }
        });

        this.executionTimer.completeStage(settlement.id, 'balanceVerification');
    }

    async _finalizeSettlement(settlement) {
        this.executionTimer.startStage(settlement.id, 'finalConfirmation');
        
        settlement.status = 'completed';
        settlement.completionTime = Date.now();

        const profit = this._calculateProfit(settlement);
        
        this.emit('settlementCompleted', {
            settlementId: settlement.id,
            profit,
            duration: settlement.completionTime - settlement.startTime
        });

        this.executionTimer.completeStage(settlement.id, 'finalConfirmation');
    }

    async _waitForOrderConfirmation(orderId, side, attempt = 1) {
        try {
            const order = await this.orderManager.getOrder(orderId);
            
            if (order.status === 'filled') {
                return order;
            }

            if (attempt >= this.config.retryAttempts) {
                return null;
            }

            await new Promise(resolve => 
                setTimeout(resolve, this.config.retryDelay)
            );

            return this._waitForOrderConfirmation(
                orderId, 
                side, 
                attempt + 1
            );

        } catch (error) {
            logger.error(`Order confirmation error:`, error);
            return null;
        }
    }

    async _confirmBalance(exchange, currency) {
        let confirmations = 0;
        let lastBalance = null;

        for (let i = 0; i < this.config.confirmations; i++) {
            const balance = await this.balanceManager.getBalance(
                exchange, 
                currency
            );

            if (lastBalance && balance.equals(lastBalance)) {
                confirmations++;
            }

            lastBalance = balance;

            if (confirmations >= this.config.confirmations - 1) {
                return balance;
            }

            await new Promise(resolve => 
                setTimeout(resolve, 1000)
            );
        }

        return null;
    }

    _calculateProfit(settlement) {
        const buyTotal = new Decimal(settlement.buyOrder.totalCost);
        const sellTotal = new Decimal(settlement.sellOrder.totalCost);
        
        return {
            amount: sellTotal.minus(buyTotal).toString(),
            percent: sellTotal.minus(buyTotal)
                .div(buyTotal)
                .mul(100)
                .toString()
        };
    }

    async _handleSettlementFailure(settlement, error) {
        settlement.status = 'failed';
        settlement.error = error.message;
        
        this.emit('settlementFailed', {
            settlementId: settlement.id,
            error: error.message,
            stages: settlement.stages
        });

        // Attempt recovery if possible
        await this._attemptRecovery(settlement);
    }

    async _attemptRecovery(settlement) {
        try {
            // Implement recovery logic based on settlement stage
            const lastStage = settlement.stages[settlement.stages.length - 1];
            
            switch (lastStage?.stage) {
                case 'buyConfirmation':
                    // Attempt to cancel buy order if not confirmed
                    await this.orderManager.cancelOrder(settlement.buyOrder.id);
                    break;
                    
                case 'sellConfirmation':
                    // Handle partially completed arbitrage
                    await this._handlePartialSettlement(settlement);
                    break;
                    
                default:
                    logger.warn('No recovery action available for settlement stage');
            }
        } catch (error) {
            logger.error('Settlement recovery failed:', error);
        }
    }

    async _handlePartialSettlement(settlement) {
        // Implement partial settlement handling
        logger.warn('Partial settlement detected, implementing recovery...');
    }

    getSettlement(settlementId) {
        return this.settlements.get(settlementId);
    }

    getActiveSettlements() {
        return Array.from(this.settlements.values())
            .filter(s => s.status === 'pending');
    }
}