import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { TechnicalAnalyzer } from '../utils/technical-analyzer.js';
import Decimal from 'decimal.js';

export class VolatilityMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            highVolatilityThreshold: config.highVolatilityThreshold || 30,  // 30% threshold
            extremeVolatilityThreshold: config.extremeVolatilityThreshold || 50, // 50% threshold
            windowSize: config.windowSize || 20,  // Number of periods for calculation
            updateInterval: config.updateInterval || 60000, // 1 minute
            volatilityTimeframes: config.volatilityTimeframes || [5, 15, 30, 60], // minutes
            ...config
        };

        this.technicalAnalyzer = new TechnicalAnalyzer();
        this.priceHistory = new Map();
        this.volatilityHistory = new Map();
        this.isMonitoring = false;
        this.monitoringInterval = null;
    }

    async startMonitoring() {
        if (this.isMonitoring) {
            logger.warn('Volatility monitoring already active');
            return;
        }

        this.isMonitoring = true;
        logger.info('Starting volatility monitoring');

        this.monitoringInterval = setInterval(
            () => this._monitoringCycle(),
            this.config.updateInterval
        );
    }

    async stopMonitoring() {
        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        logger.info('Volatility monitoring stopped');
    }

    async updatePrice(exchange, price, timestamp = Date.now()) {
        try {
            if (!this.priceHistory.has(exchange)) {
                this.priceHistory.set(exchange, []);
            }

            const history = this.priceHistory.get(exchange);
            history.push({ price: new Decimal(price), timestamp });

            // Keep only recent prices based on longest timeframe
            const maxTimeframe = Math.max(...this.config.volatilityTimeframes) * 60 * 1000;
            const cutoff = timestamp - maxTimeframe;
            this.priceHistory.set(
                exchange,
                history.filter(entry => entry.timestamp > cutoff)
            );

            // Calculate volatility
            await this._calculateVolatility(exchange);

        } catch (error) {
            logger.error('Error updating price:', error);
        }
    }

    async _monitoringCycle() {
        try {
            for (const [exchange, history] of this.priceHistory.entries()) {
                if (history.length > 0) {
                    const latestPrice = history[history.length - 1].price;
                    const volatility = await this._calculateVolatility(exchange);
                    
                    // Check volatility thresholds
                    this._checkVolatilityThresholds(exchange, volatility);

                    // Update technical analysis
                    const analysis = this.technicalAnalyzer.analyze(exchange, latestPrice);
                    if (analysis) {
                        this._updateVolatilitySignals(exchange, analysis);
                    }
                }
            }
        } catch (error) {
            logger.error('Error in volatility monitoring cycle:', error);
        }
    }

    async _calculateVolatility(exchange) {
        const history = this.priceHistory.get(exchange) || [];
        if (history.length < 2) return null;

        const volatilities = {};
        
        // Calculate volatility for each timeframe
        for (const minutes of this.config.volatilityTimeframes) {
            const timeframe = minutes * 60 * 1000;
            const relevantPrices = history.filter(
                entry => entry.timestamp > Date.now() - timeframe
            );

            if (relevantPrices.length > 1) {
                const returns = this._calculateReturns(relevantPrices);
                volatilities[`${minutes}m`] = this._calculateStandardDeviation(returns);
            }
        }

        // Store volatility history
        if (!this.volatilityHistory.has(exchange)) {
            this.volatilityHistory.set(exchange, []);
        }

        const volatilityEntry = {
            timestamp: Date.now(),
            values: volatilities
        };

        this.volatilityHistory.get(exchange).push(volatilityEntry);

        return volatilities;
    }

    _calculateReturns(prices) {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            const currentPrice = prices[i].price;
            const previousPrice = prices[i - 1].price;
            returns.push(
                currentPrice.minus(previousPrice)
                    .div(previousPrice)
                    .mul(100)
            );
        }
        return returns;
    }

    _calculateStandardDeviation(returns) {
        if (returns.length < 2) return 0;

        const mean = returns.reduce((sum, value) => 
            sum.plus(value), new Decimal(0)
        ).div(returns.length);

        const squaredDiffs = returns.map(value => 
            value.minus(mean).pow(2)
        );

        const variance = squaredDiffs.reduce((sum, value) => 
            sum.plus(value), new Decimal(0)
        ).div(returns.length - 1);

        return variance.sqrt().toNumber();
    }

    _checkVolatilityThresholds(exchange, volatility) {
        const shortTermVol = volatility['5m'];
        if (!shortTermVol) return;

        if (shortTermVol > this.config.extremeVolatilityThreshold) {
            this.emit('extremeVolatility', {
                exchange,
                volatility: shortTermVol,
                timestamp: Date.now()
            });
        } else if (shortTermVol > this.config.highVolatilityThreshold) {
            this.emit('highVolatility', {
                exchange,
                volatility: shortTermVol,
                timestamp: Date.now()
            });
        }
    }

    _updateVolatilitySignals(exchange, analysis) {
        const signals = {
            timestamp: Date.now(),
            exchange,
            rsi: analysis.rsi,
            bbWidth: analysis.bb ? 
                (analysis.bb.upper - analysis.bb.lower) / analysis.bb.middle : null,
            macdDivergence: analysis.macd ? 
                Math.abs(analysis.macd.histogram) : null
        };

        this.emit('volatilitySignals', signals);
    }

    getVolatility(exchange, timeframe = '5m') {
        const history = this.volatilityHistory.get(exchange);
        if (!history || history.length === 0) return null;

        const latest = history[history.length - 1];
        return latest.values[timeframe] || null;
    }

    getVolatilityTrend(exchange, timeframe = '5m', periods = 10) {
        const history = this.volatilityHistory.get(exchange);
        if (!history) return null;

        return history
            .slice(-periods)
            .map(entry => ({
                timestamp: entry.timestamp,
                volatility: entry.values[timeframe] || null
            }));
    }

    isHighVolatility(exchange) {
        const volatility = this.getVolatility(exchange);
        return volatility !== null && 
               volatility > this.config.highVolatilityThreshold;
    }

    getExchangeMetrics(exchange) {
        const volatility = this.getVolatility(exchange);
        const trend = this.getVolatilityTrend(exchange);
        const analysis = this.technicalAnalyzer.getVolatilityScore(
            exchange,
            this.priceHistory.get(exchange)?.slice(-1)[0]?.price
        );

        return {
            currentVolatility: volatility,
            trend,
            technicalAnalysis: analysis,
            isHighVolatility: this.isHighVolatility(exchange)
        };
    }
}