import { describe, it, expect, beforeEach } from 'vitest';
import { VolatilityMonitor } from '../monitoring/volatilityMonitor.js';
import Decimal from 'decimal.js';

describe('VolatilityMonitor', () => {
    let volatilityMonitor;

    beforeEach(() => {
        volatilityMonitor = new VolatilityMonitor({
            highVolatilityThreshold: 30,
            extremeVolatilityThreshold: 50,
            windowSize: 20,
            updateInterval: 60000
        });
    });

    it('should calculate volatility correctly', async () => {
        const exchange = 'safetrade';
        const prices = [100, 105, 95, 110, 90].map(p => new Decimal(p));
        
        for (const price of prices) {
            await volatilityMonitor.updatePrice(exchange, price);
        }

        const volatility = volatilityMonitor.getVolatility(exchange);
        expect(volatility).toBeTruthy();
        expect(typeof volatility).toBe('number');
    });

    it('should detect high volatility', async () => {
        const exchange = 'safetrade';
        let highVolatilityDetected = false;

        volatilityMonitor.on('highVolatility', () => {
            highVolatilityDetected = true;
        });

        // Simulate high volatility with large price swings
        const prices = [100, 140, 80, 120, 70].map(p => new Decimal(p));
        for (const price of prices) {
            await volatilityMonitor.updatePrice(exchange, price);
        }

        expect(highVolatilityDetected).toBe(true);
        expect(volatilityMonitor.isHighVolatility(exchange)).toBe(true);
    });

    it('should maintain correct history window', async () => {
        const exchange = 'safetrade';
        const prices = Array.from({ length: 30 }, (_, i) => 100 + i);

        for (const price of prices) {
            await volatilityMonitor.updatePrice(exchange, price);
        }

        const trend = volatilityMonitor.getVolatilityTrend(exchange, '5m', 10);
        expect(trend.length).toBeLessThanOrEqual(10);
    });

    it('should provide exchange metrics', async () => {
        const exchange = 'safetrade';
        const prices = [100, 105, 95, 110, 90].map(p => new Decimal(p));
        
        for (const price of prices) {
            await volatilityMonitor.updatePrice(exchange, price);
        }

        const metrics = volatilityMonitor.getExchangeMetrics(exchange);
        expect(metrics).toHaveProperty('currentVolatility');
        expect(metrics).toHaveProperty('trend');
        expect(metrics).toHaveProperty('isHighVolatility');
    });
});