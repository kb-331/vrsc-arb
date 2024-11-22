import { logger } from './logger.js';
import Decimal from 'decimal.js';

export class MarketDepthAnalyzer {
    constructor(config = {}) {
        this.config = {
            depthLevels: config.depthLevels || 10,
            minLiquidity: config.minLiquidity || 1000,
            maxSpread: config.maxSpread || 0.02,
            ...config
        };
    }

    async analyzeDepth(exchange, orderbook) {
        try {
            const analysis = {
                bidLiquidity: this._calculateLiquidity(orderbook.bids),
                askLiquidity: this._calculateLiquidity(orderbook.asks),
                spreadPercent: this._calculateSpread(orderbook),
                slippageMap: this._calculateSlippageMap(orderbook),
                timestamp: Date.now()
            };

            const imbalance = this._calculateImbalance(analysis);
            if (imbalance > 0.3) { // 30% imbalance threshold
                logger.warn(`High order book imbalance on ${exchange}:`, imbalance);
            }

            return analysis;
        } catch (error) {
            logger.error('Error analyzing market depth:', error);
            return null;
        }
    }

    _calculateLiquidity(orders) {
        return orders.slice(0, this.config.depthLevels).reduce((sum, [price, amount]) => 
            sum.plus(new Decimal(price).mul(amount)), new Decimal(0));
    }

    _calculateSpread(orderbook) {
        if (!orderbook.asks[0] || !orderbook.bids[0]) return new Decimal(Infinity);
        
        const bestBid = new Decimal(orderbook.bids[0][0]);
        const bestAsk = new Decimal(orderbook.asks[0][0]);
        
        return bestAsk.minus(bestBid).div(bestBid).mul(100);
    }

    _calculateSlippageMap(orderbook) {
        const slippageMap = {
            buy: new Map(),
            sell: new Map()
        };

        const amounts = [1000, 5000, 10000, 50000]; // USD amounts to check
        
        amounts.forEach(amount => {
            slippageMap.buy.set(amount, this._calculateSlippage(orderbook.asks, amount, 'buy'));
            slippageMap.sell.set(amount, this._calculateSlippage(orderbook.bids, amount, 'sell'));
        });

        return slippageMap;
    }

    _calculateSlippage(orders, targetAmount, side) {
        let remainingAmount = new Decimal(targetAmount);
        let totalCost = new Decimal(0);
        let weightedPrice = new Decimal(0);

        for (const [price, amount] of orders) {
            const orderPrice = new Decimal(price);
            const orderAmount = new Decimal(amount);
            const orderValue = orderPrice.mul(orderAmount);

            if (remainingAmount.lessThanOrEqualTo(orderValue)) {
                const fraction = remainingAmount.div(orderPrice);
                totalCost = totalCost.plus(remainingAmount);
                weightedPrice = weightedPrice.plus(orderPrice.mul(fraction));
                remainingAmount = new Decimal(0);
                break;
            }

            totalCost = totalCost.plus(orderValue);
            weightedPrice = weightedPrice.plus(orderPrice.mul(orderAmount));
            remainingAmount = remainingAmount.minus(orderValue);
        }

        if (remainingAmount.greaterThan(0)) {
            return null; // Not enough liquidity
        }

        const avgPrice = weightedPrice.div(totalCost);
        const basePrice = new Decimal(orders[0][0]);
        const slippage = side === 'buy' 
            ? avgPrice.minus(basePrice).div(basePrice)
            : basePrice.minus(avgPrice).div(basePrice);

        return {
            slippagePercent: slippage.mul(100).toNumber(),
            averagePrice: avgPrice.toNumber(),
            totalCost: totalCost.toNumber()
        };
    }

    _calculateImbalance(analysis) {
        const totalLiquidity = analysis.bidLiquidity.plus(analysis.askLiquidity);
        if (totalLiquidity.isZero()) return 0;

        return Math.abs(
            analysis.bidLiquidity
                .minus(analysis.askLiquidity)
                .div(totalLiquidity)
                .toNumber()
        );
    }
}