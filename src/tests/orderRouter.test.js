import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderRouter } from '../trading/orderRouter.js';
import { MarketDepthAnalyzer } from '../utils/market-depth.js';
import { feeFetcher } from '../utils/fetch-fees.js';
import Decimal from 'decimal.js';

vi.mock('../utils/market-depth.js');
vi.mock('../utils/fetch-fees.js');

describe('OrderRouter', () => {
    let orderRouter;
    let mockDepthAnalysis;

    beforeEach(() => {
        orderRouter = new OrderRouter({
            maxSlippage: 0.003,
            minLiquidity: 1000
        });

        mockDepthAnalysis = {
            bidLiquidity: new Decimal(10000),
            askLiquidity: new Decimal(10000),
            spreadPercent: 0.1,
            slippageMap: {
                buy: new Map([
                    [1000, { slippagePercent: 0.001, averagePrice: 5.005 }],
                    [5000, { slippagePercent: 0.002, averagePrice: 5.01 }]
                ]),
                sell: new Map([
                    [1000, { slippagePercent: 0.001, averagePrice: 4.995 }],
                    [5000, { slippagePercent: 0.002, averagePrice: 4.99 }]
                ])
            }
        };

        MarketDepthAnalyzer.prototype.analyzeDepth = vi.fn().mockResolvedValue(mockDepthAnalysis);
        feeFetcher.getFees = vi.fn().mockResolvedValue({ maker: 0.001, taker: 0.002 });
    });

    it('should find optimal route for valid order', async () => {
        const order = {
            exchange: 'safetrade',
            side: 'buy',
            amount: '100',
            price: '5'
        };

        const route = await orderRouter.findOptimalRoute(order);
        expect(route).toBeTruthy();
        expect(new Decimal(route.expectedSlippage)).toBeLessThanOrEqual(0.003);
    });

    it('should reject orders with insufficient liquidity', async () => {
        mockDepthAnalysis.bidLiquidity = new Decimal(100);
        mockDepthAnalysis.askLiquidity = new Decimal(100);

        const order = {
            exchange: 'safetrade',
            side: 'buy',
            amount: '1000',
            price: '5'
        };

        const route = await orderRouter.findOptimalRoute(order);
        expect(route).toBeNull();
    });

    it('should calculate fees correctly', async () => {
        const order = {
            exchange: 'safetrade',
            side: 'buy',
            amount: '100',
            price: '5'
        };

        const route = await orderRouter.findOptimalRoute(order);
        expect(route.fees).toBeTruthy();
        expect(route.fees.total).toBe('1');
    });

    it('should handle high slippage scenarios', async () => {
        mockDepthAnalysis.slippageMap.buy = new Map([
            [1000, { slippagePercent: 0.005, averagePrice: 5.025 }]
        ]);

        const order = {
            exchange: 'safetrade',
            side: 'buy',
            amount: '100',
            price: '5'
        };

        const route = await orderRouter.findOptimalRoute(order);
        expect(route).toBeNull();
    });
});