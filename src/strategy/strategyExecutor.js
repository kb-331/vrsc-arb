import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { ExecutionTimer } from '../utils/execution-timer.js';

export class StrategyExecutor extends EventEmitter {
    constructor(orderManager, riskManager) {
        super();
        this.orderManager = orderManager;
        this.riskManager = riskManager;
        this.executionTimer = new ExecutionTimer();
        this.executions = new Map();
    }

    async executeSignal(strategy, signal) {
        const executionId = this._generateExecutionId();
        logger.info(`Executing signal for strategy ${strategy.id}`, signal);

        try {
            // Start execution tracking
            const execution = this.executionTimer.startExecution(executionId, [
                'validation',
                'riskCheck',
                'orderCreation',
                'orderExecution'
            ]);

            // Validate execution conditions
            this.executionTimer.startStage(executionId, 'validation');
            if (!await this._validateExecution(strategy, signal)) {
                throw new Error('Execution validation failed');
            }
            this.executionTimer.completeStage(executionId, 'validation');

            // Perform risk check
            this.executionTimer.startStage(executionId, 'riskCheck');
            if (!await this._checkRisk(strategy, signal)) {
                throw new Error('Risk check failed');
            }
            this.executionTimer.completeStage(executionId, 'riskCheck');

            // Create order
            this.executionTimer.startStage(executionId, 'orderCreation');
            const order = await this._createOrder(strategy, signal);
            if (!order) {
                throw new Error('Order creation failed');
            }
            this.executionTimer.completeStage(executionId, 'orderCreation');

            // Execute order
            this.executionTimer.startStage(executionId, 'orderExecution');
            const result = await this._executeOrder(order);
            this.executionTimer.completeStage(executionId, 'orderExecution');

            this._recordExecution(executionId, {
                strategy: strategy.id,
                signal,
                order,
                result,
                status: 'completed'
            });

            return result;

        } catch (error) {
            logger.error(`Execution ${executionId} failed:`, error);
            this._recordExecution(executionId, {
                strategy: strategy.id,
                signal,
                error: error.message,
                status: 'failed'
            });
            throw error;
        }
    }

    async _validateExecution(strategy, signal) {
        // Implement execution validation logic
        return true;
    }

    async _checkRisk(strategy, signal) {
        if (!this.riskManager) return true;

        const riskCheck = await this.riskManager.validateTrade({
            strategy: strategy.id,
            signal,
            timestamp: Date.now()
        });

        return riskCheck.isValid;
    }

    async _createOrder(strategy, signal) {
        if (!this.orderManager) return null;

        return await this.orderManager.createOrder({
            exchange: strategy.exchange,
            symbol: strategy.symbol,
            type: signal.type,
            side: signal.side,
            amount: signal.amount,
            price: signal.price
        });
    }

    async _executeOrder(order) {
        if (!this.orderManager) return null;

        const result = await this.orderManager.executeOrder(order.id);
        
        if (result.status !== 'filled') {
            throw new Error(`Order execution failed: ${result.status}`);
        }

        return result;
    }

    _generateExecutionId() {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _recordExecution(executionId, data) {
        this.executions.set(executionId, {
            ...data,
            timestamp: Date.now()
        });

        this.emit('executionComplete', {
            executionId,
            ...data
        });
    }

    getExecution(executionId) {
        return this.executions.get(executionId);
    }

    getExecutions(filter = {}) {
        let executions = Array.from(this.executions.values());

        if (filter.strategy) {
            executions = executions.filter(e => e.strategy === filter.strategy);
        }

        if (filter.status) {
            executions = executions.filter(e => e.status === filter.status);
        }

        if (filter.timeRange) {
            executions = executions.filter(e => 
                e.timestamp >= filter.timeRange.start &&
                e.timestamp <= (filter.timeRange.end || Date.now())
            );
        }

        return executions;
    }
}