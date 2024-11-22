import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

export class StrategyManager extends EventEmitter {
    constructor() {
        super();
        this.strategies = new Map();
    }

    async registerStrategy(strategy) {
        if (this.strategies.has(strategy.id)) {
            throw new Error(`Strategy ${strategy.id} already registered`);
        }

        this.strategies.set(strategy.id, {
            ...strategy,
            status: 'active',
            lastUpdate: Date.now(),
            signals: []
        });

        this.emit('strategyRegistered', strategy);
        logger.info(`Strategy ${strategy.id} registered`);
    }

    async updateStrategy(strategyId, updates) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) {
            throw new Error(`Strategy ${strategyId} not found`);
        }

        Object.assign(strategy, {
            ...updates,
            lastUpdate: Date.now()
        });

        this.emit('strategyUpdated', strategy);
        return strategy;
    }

    async deactivateStrategy(strategyId) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) {
            throw new Error(`Strategy ${strategyId} not found`);
        }

        strategy.status = 'inactive';
        strategy.lastUpdate = Date.now();

        this.emit('strategyDeactivated', strategy);
        return strategy;
    }

    getStrategy(strategyId) {
        return this.strategies.get(strategyId);
    }

    getActiveStrategies() {
        return Array.from(this.strategies.values())
            .filter(s => s.status === 'active');
    }

    getAllStrategies() {
        return Array.from(this.strategies.values());
    }

    recordSignal(strategyId, signal) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return;

        strategy.signals.push({
            ...signal,
            timestamp: Date.now()
        });

        // Keep only recent signals
        strategy.signals = strategy.signals
            .slice(-100); // Keep last 100 signals
    }

    getSignals(strategyId, limit = 100) {
        const strategy = this.strategies.get(strategyId);
        if (!strategy) return [];

        return strategy.signals
            .slice(-limit)
            .sort((a, b) => b.timestamp - a.timestamp);
    }
}