import { BaseExchange } from './base.js';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class Komodo extends BaseExchange {
    constructor() {
        super('Komodo');
        this.baseUrl = 'https://api.komodo.earth';
    }

    async _fetchPriceImpl() {
        try {
            const data = await this._makeRequest('/v1/prices/vrsc/usdt');
            
            if (!data?.price) {
                throw new Error('Invalid response format');
            }
            
            return {
                price: parseFloat(data.price),
                timestamp: Date.now(),
                success: true,
                raw: {
                    volume24h: parseFloat(data.volume24h || 0),
                    high24h: parseFloat(data.high24h || data.price),
                    low24h: parseFloat(data.low24h || data.price),
                    lastUpdate: data.timestamp
                }
            };
        } catch (error) {
            throw new Error(`Komodo API error: ${error.message}`);
        }
    }

    async _getMarketDepth() {
        try {
            const data = await this._makeRequest('/v1/orderbook/vrsc/usdt');
            return {
                bids: data.bids || [],
                asks: data.asks || [],
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error('Error fetching market depth:', error);
            return {
                bids: [],
                asks: [],
                timestamp: Date.now()
            };
        }
    }

    async _calculateSlippage(amount, side = 'buy') {
        try {
            const orderbook = await this._getMarketDepth();
            const orders = side === 'buy' ? orderbook.asks : orderbook.bids;
            
            let remainingAmount = new Decimal(amount);
            let totalCost = new Decimal(0);
            
            for (const [price, volume] of orders) {
                const orderVolume = new Decimal(volume);
                const orderPrice = new Decimal(price);
                
                if (remainingAmount.lessThanOrEqualTo(orderVolume)) {
                    totalCost = totalCost.plus(remainingAmount.mul(orderPrice));
                    remainingAmount = new Decimal(0);
                    break;
                }
                
                totalCost = totalCost.plus(orderVolume.mul(orderPrice));
                remainingAmount = remainingAmount.minus(orderVolume);
            }
            
            if (remainingAmount.greaterThan(0)) {
                return null; // Not enough liquidity
            }
            
            return totalCost.toString();
        } catch (error) {
            logger.error('Error calculating slippage:', error);
            return null;
        }
    }
}