import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { TechnicalAnalyzer } from '../utils/technical-analyzer.js';
import { StrategyManager } from './strategyManager.js';
import { StrategyExecutor } from './strategyExecutor.js';
import { StrategyValidator } from './strategyValidator.js';

export class StrategyEngine extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            updateInterval: config.updateInterval || 60000,  // 1 minute
            maxActiveStrategies: config.maxActiveStrategies || 5,
            ...config
        };

        this.technicalAnalyzer = new TechnicalAnalyzer();
        this.strategyManager = new StrategyManager();
        this.strategyExecutor = new StrategyExecutor();
        this.strategyValidator = new StrategyValidator();
        
        this.activeStrategies = new Map();
        this.isRunning = false;
    }

    async start() {
        if (this.isRunning) {
            logger.warn('Strategy engine already running');
            return;
        }

        logger.info('Starting strategy engine');
        this.isRunning = true;

        this.updateInterval = setInterval(
            () => this._updateStrategies(),
            this.config.updateInterval
        );
    }

    async stop() {
        if (!this.isRunning) return;

        logger.info('Stopping strategy engine');
        clearInterval(this.updateInterval);
        this.isRunning = false;
    }

    async loadStrategy(strategy) {
        try {
            const validation = this.strategyValidator.validateStrategy(strategy);
            if (!validation.isValid) {
                throw new Error(`Invalid strategy: ${validation.errors.join(', ')}`);
            }

            await this.strategyManager.registerStrategy(strategy);
            logger.info(`Strategy ${strategy.id} loaded successfully`);
            
            return true;
        } catch (error) {
            logger.error('Error loading strategy:', error);
            return false;
        }
    }

    async _updateStrategies() {
        try {
            const strategies = this.strategyManager.getActiveStrategies();
            
            for (const strategy of strategies) {
                await this._evaluateStrategy(strategy);
            }
        } catch (error) {
            logger.error('Error updating strategies:', error);
        }
    }

    async _evaluateStrategy(strategy) {
        try {
            const analysis = await this.technicalAnalyzer.analyze(
                strategy.exchange,
                strategy.symbol
            );

            if (!analysis) return;

            const signals = this._generateSignals(strategy, analysis);
            if (signals.length > 0) {
                await this._executeSignals(strategy, signals);
            }
        } catch (error) {
            logger.error(`Error evaluating strategy ${strategy.id}:`, error);
        }
    }

    _generateSignals(strategy, analysis) {
        const signals = [];

        for (const condition of strategy.conditions) {
            const result = this._evaluateCondition(condition, analysis);
            if (result.triggered) {
                signals.push({
                    type: condition.action,
                    reason: result.reason,
                    timestamp: Date.now()
                });
            }
        }

        return signals;
    }

    _evaluateCondition(condition, analysis) {
        try {
            switch (condition.type) {
                case 'PRICE_ABOVE':
                    return this._evaluatePriceAbove(condition, analysis);
                case 'PRICE_BELOW':
                    return this._evaluatePriceBelow(condition, analysis);
                case 'RSI_OVERBOUGHT':
                    return this._evaluateRSI(condition, analysis, 'overbought');
                case 'RSI_OVERSOLD':
                    return this._evaluateRSI(condition, analysis, 'oversold');
                case 'MACD_CROSSOVER':
                    return this._evaluateMACDCrossover(condition, analysis);
                default:
                    logger.warn(`Unknown condition type: ${condition.type}`);
                    return { triggered: false };
            }
        } catch (error) {
            logger.error('Error evaluating condition:', error);
            return { triggered: false };
        }
    }

    _evaluatePriceAbove(condition, analysis) {
        return {
            triggered: analysis.price > condition.value,
            reason: `Price ${analysis.price} above ${condition.value}`
        };
    }

    _evaluatePriceBelow(condition, analysis) {
        return {
            triggered: analysis.price < condition.value,
            reason: `Price ${analysis.price} below ${condition.value}`
        };
    }

    _evaluateRSI(condition, analysis, type) {
        if (!analysis.rsi) return { triggered: false };

        const threshold = type === 'overbought' ? 70 : 30;
        const isTriggered = type === 'overbought' ?
            analysis.rsi > threshold :
            analysis.rsi < threshold;

        return {
            triggered: isTriggered,
            reason: `RSI ${analysis.rsi} ${type}`
        };
    }

    _evaluateMACDCrossover(condition, analysis) {
        if (!analysis.macd) return { triggered: false };

        const { macd, signal } = analysis.macd;
        const crossover = macd > signal;

        return {
            triggered: crossover,
            reason: `MACD crossover: ${macd} > ${signal}`
        };
    }

    async _executeSignals(strategy, signals) {
        for (const signal of signals) {
            try {
                await this.strategyExecutor.executeSignal(strategy, signal);
                this.emit('signalExecuted', {
                    strategyId: strategy.id,
                    signal,
                    timestamp: Date.now()
                });
            } catch (error) {
                logger.error('Error executing signal:', error);
                this.emit('signalError', {
                    strategyId: strategy.id,
                    signal,
                    error: error.message
                });
            }
        }
    }

    getActiveStrategies() {
        return this.strategyManager.getActiveStrategies();
    }

    getStrategyStatus(strategyId) {
        return this.strategyManager.getStrategy(strategyId);
    }
}