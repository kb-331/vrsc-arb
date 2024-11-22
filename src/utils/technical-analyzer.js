import { logger } from './logger.js';
import { RSI, EMA, MACD, BollingerBands } from 'trading-signals';
import Decimal from 'decimal.js';

export class TechnicalAnalyzer {
    constructor(config = {}) {
        this.config = {
            rsiPeriod: config.rsiPeriod || 14,
            emaPeriod: config.emaPeriod || 20,
            macdConfig: {
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9
            },
            bbConfig: {
                period: 20,
                stdDev: 2
            },
            ...config
        };

        this.indicators = new Map();
    }

    analyze(exchange, price) {
        try {
            if (!this.indicators.has(exchange)) {
                this._initializeIndicators(exchange);
            }

            const indicators = this.indicators.get(exchange);
            indicators.rsi.update(price);
            indicators.ema.update(price);
            indicators.macd.update(price);
            indicators.bb.update(price);

            return {
                rsi: indicators.rsi.isStable() ? indicators.rsi.getResult().toNumber() : null,
                ema: indicators.ema.isStable() ? indicators.ema.getResult().toNumber() : null,
                macd: indicators.macd.isStable() ? {
                    macd: indicators.macd.getResult().macd.toNumber(),
                    signal: indicators.macd.getResult().signal.toNumber(),
                    histogram: indicators.macd.getResult().histogram.toNumber()
                } : null,
                bb: indicators.bb.isStable() ? {
                    upper: indicators.bb.getResult().upper.toNumber(),
                    middle: indicators.bb.getResult().middle.toNumber(),
                    lower: indicators.bb.getResult().lower.toNumber()
                } : null
            };
        } catch (error) {
            logger.error(`Error analyzing technical indicators for ${exchange}:`, error);
            return null;
        }
    }

    _initializeIndicators(exchange) {
        this.indicators.set(exchange, {
            rsi: new RSI(this.config.rsiPeriod),
            ema: new EMA(this.config.emaPeriod),
            macd: new MACD(this.config.macdConfig),
            bb: new BollingerBands(this.config.bbConfig)
        });
    }

    getVolatilityScore(exchange, price) {
        try {
            const analysis = this.analyze(exchange, price);
            if (!analysis || !analysis.bb) return null;

            const bb = analysis.bb;
            const bandwidth = new Decimal(bb.upper)
                .minus(bb.lower)
                .div(bb.middle)
                .mul(100);

            const rsiExtreme = analysis.rsi ? 
                Math.min(Math.abs(analysis.rsi - 50), 50) / 50 : 0;

            const macdVolatility = analysis.macd ?
                Math.abs(analysis.macd.histogram) / bb.middle : 0;

            return {
                bbBandwidth: bandwidth.toNumber(),
                rsiVolatility: rsiExtreme,
                macdVolatility: macdVolatility,
                composite: (bandwidth.toNumber() + rsiExtreme + macdVolatility) / 3
            };
        } catch (error) {
            logger.error(`Error calculating volatility score for ${exchange}:`, error);
            return null;
        }
    }

    reset(exchange) {
        this.indicators.delete(exchange);
    }

    resetAll() {
        this.indicators.clear();
    }
}