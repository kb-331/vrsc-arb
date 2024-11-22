import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { MarketDepthAnalyzer } from '../utils/market-depth.js';
import { feeFetcher } from '../utils/fetch-fees.js';
import Decimal from 'decimal.js';

export class OrderRouter extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            maxSlippage: config.maxSlippage || 0.003,    // 0.3% max slippage
            minLiquidity: config.minLiquidity || 1000,   // $1000 min liquidity
            maxImpact: config.maxImpact || 0.1,         // 10% max market impact
            ...config
        };
        this.depthAnalyzer = new MarketDepthAnalyzer();
    }

    async findOptimalRoute(order) {
        try {
            const { exchange, side, amount, price } = order;
            
            // Get market depth
            const depth = await this._getMarketDepth(exchange);
            if (!depth) {
                logger.warn(`Insufficient market depth for ${exchange}`);
                return null;
            }

            // Analyze liquidity
            const analysis = await this.depthAnalyzer.analyzeDepth(exchange, depth);
            if (!this._validateLiquidity(analysis, amount, price)) {
                return null;
            }

            // Calculate optimal execution
            const execution = await this._calculateExecution(order, analysis);
            if (!execution) {
                return null;
            }

            // Get fees
            const fees = await this._calculateFees(execution);

            return {
                ...execution,
                fees,
                estimatedNet: this._calculateNetAmount(execution, fees)
            };

        } catch (error) {
            logger.error('Error finding optimal route:', error);
            return null;
        }
    }

    async _getMarketDepth(exchange) {
        try {
            // Implementation depends on exchange-specific API
            return null;
        } catch (error) {
            logger.error(`Error fetching market depth for ${exchange}:`, error);
            return null;
        }
    }

    _validateLiquidity(analysis, amount, price) {
        const orderValue = new Decimal(amount).mul(price);
        const requiredLiquidity = orderValue.mul(1.5); // 150% of order value

        if (analysis.bidLiquidity.lessThan(requiredLiquidity) || 
            analysis.askLiquidity.lessThan(requiredLiquidity)) {
            logger.warn('Insufficient liquidity:', {
                required: requiredLiquidity.toString(),
                available: Math.min(
                    analysis.bidLiquidity.toString(),
                    analysis.askLiquidity.toString()
                )
            });
            return false;
        }

        return true;
    }

    async _calculateExecution(order, analysis) {
        const { side, amount, price } = order;
        const slippageMap = analysis.slippageMap[side];
        
        // Find optimal execution size based on slippage
        let optimalSize = new Decimal(amount);
        let expectedSlippage = 0;

        for (const [size, slippage] of slippageMap.entries()) {
            if (slippage.slippagePercent <= this.config.maxSlippage) {
                optimalSize = new Decimal(size);
                expectedSlippage = slippage.slippagePercent;
                break;
            }
        }

        if (expectedSlippage > this.config.maxSlippage) {
            logger.warn('Expected slippage too high:', {
                expected: expectedSlippage,
                maximum: this.config.maxSlippage
            });
            return null;
        }

        return {
            size: optimalSize.toString(),
            price: price.toString(),
            expectedSlippage,
            estimatedPrice: new Decimal(price)
                .mul(1 + (side === 'buy' ? expectedSlippage : -expectedSlippage))
                .toString()
        };
    }

    async _calculateFees(execution) {
        try {
            const fees = await feeFetcher.getFees(execution.exchange);
            const value = new Decimal(execution.size).mul(execution.price);
            
            return {
                maker: value.mul(fees.maker).toString(),
                taker: value.mul(fees.taker).toString(),
                total: value.mul(fees.taker).toString() // Assume taker fee for conservative estimate
            };
        } catch (error) {
            logger.error('Error calculating fees:', error);
            return null;
        }
    }

    _calculateNetAmount(execution, fees) {
        const value = new Decimal(execution.size).mul(execution.price);
        return execution.side === 'buy' ?
            value.plus(fees.total).toString() :
            value.minus(fees.total).toString();
    }

    getRouteMetrics() {
        // Implementation for route performance metrics
        return {};
    }
}