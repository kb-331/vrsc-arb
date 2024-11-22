import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class MarketDepthAnalyzer {
    constructor(config = {}) {
        this.config = {
            maxSlippage: config.maxSlippage || 0.003,  // 0.3% max slippage
            minLiquidity: config.minLiquidity || 1000,  // $1000 min liquidity
            maxImpact: config.maxImpact || 0.1,        // 10% max market impact
            ...config
        };
    }

    analyzeDepth(orderbook, targetAmount) {
        try {
            const analysis = {
                buyAnalysis: this._analyzeSide(orderbook.bids, targetAmount, 'buy'),
                sellAnalysis: this._analyzeSide(orderbook.asks, targetAmount, 'sell'),
                timestamp: Date.now()
            };

            return {
                ...analysis,
                isExecutable: this._isExecutable(analysis, targetAmount)
            };
        } catch (error) {
            logger.error('Error analyzing market depth:', error);
            return null;
        }
    }

    _analyzeSide(orders, targetAmount, side) {
        let remainingAmount = new Decimal(targetAmount);
        let totalCost = new Decimal(0);
        let weightedPrice = new Decimal(0);
        let filledAmount = new Decimal(0);

        for (const [price, amount] of orders) {
            const orderPrice = new Decimal(price);
            const orderAmount = new Decimal(amount);
            const fillAmount = Decimal.min(remainingAmount, orderAmount);

            const orderCost = fillAmount.mul(orderPrice);
            totalCost = totalCost.plus(orderCost);
            weightedPrice = weightedPrice.plus(orderPrice.mul(fillAmount));
            filledAmount = filledAmount.plus(fillAmount);
            remainingAmount = remainingAmount.minus(fillAmount);

            if (remainingAmount.isZero()) break;
        }

        if (!filledAmount.isZero()) {
            weightedPrice = weightedPrice.div(filledAmount);
        }

        const basePrice = new Decimal(orders[0][0]);
        const slippage = side === 'buy' ?
            weightedPrice.minus(basePrice).div(basePrice) :
            basePrice.minus(weightedPrice).div(basePrice);

        return {
            filledAmount: filledAmount.toString(),
            remainingAmount: remainingAmount.toString(),
            averagePrice: weightedPrice.toString(),
            slippagePercent: slippage.mul(100).toString(),
            totalCost: totalCost.toString()
        };
    }

    _isExecutable(analysis, targetAmount) {
        const targetDecimal = new Decimal(targetAmount);

        // Check if order can be completely filled
        if (new Decimal(analysis.buyAnalysis.remainingAmount).greaterThan(0) ||
            new Decimal(analysis.sellAnalysis.remainingAmount).greaterThan(0)) {
            return false;
        }

        // Check slippage
        if (new Decimal(analysis.buyAnalysis.slippagePercent).greaterThan(this.config.maxSlippage) ||
            new Decimal(analysis.sellAnalysis.slippagePercent).greaterThan(this.config.maxSlippage)) {
            return false;
        }

        // Check market impact
        const buyImpact = new Decimal(analysis.buyAnalysis.totalCost)
            .div(targetDecimal);
        const sellImpact = new Decimal(analysis.sellAnalysis.totalCost)
            .div(targetDecimal);

        if (buyImpact.greaterThan(this.config.maxImpact) ||
            sellImpact.greaterThan(this.config.maxImpact)) {
            return false;
        }

        return true;
    }

    calculateOptimalSize(orderbook) {
        const sizes = [1000, 5000, 10000, 50000]; // Test amounts in USD
        const results = new Map();

        for (const size of sizes) {
            const analysis = this.analyzeDepth(orderbook, size);
            if (analysis?.isExecutable) {
                results.set(size, analysis);
            }
        }

        return this._findOptimalSize(results);
    }

    _findOptimalSize(results) {
        if (results.size === 0) return null;

        // Find the largest size that meets our criteria
        const sortedSizes = Array.from(results.keys()).sort((a, b) => b - a);
        
        for (const size of sortedSizes) {
            const analysis = results.get(size);
            const totalSlippage = new Decimal(analysis.buyAnalysis.slippagePercent)
                .plus(analysis.sellAnalysis.slippagePercent);

            if (totalSlippage.lessThanOrEqualTo(this.config.maxSlippage * 2)) {
                return {
                    size,
                    analysis
                };
            }
        }

        return null;
    }
}