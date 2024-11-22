import { logger } from './logger.js';
import NodeCache from 'node-cache';
import Decimal from 'decimal.js';

class FeeFetcher {
    constructor() {
        this.cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour
        this.fees = new Map();
        this.lastUpdate = new Map();
        this.updateInterval = 300000; // 5 minutes
    }

    async getFees(exchange) {
        const normalizedExchange = exchange.toLowerCase();
        const cacheKey = `fees_${normalizedExchange}`;

        // Check cache first
        const cachedFees = this.cache.get(cacheKey);
        if (cachedFees && Date.now() - this.lastUpdate.get(normalizedExchange) < this.updateInterval) {
            return cachedFees;
        }

        try {
            const fees = await this._fetchExchangeFees(normalizedExchange);
            if (fees) {
                this.fees.set(normalizedExchange, fees);
                this.cache.set(cacheKey, fees);
                this.lastUpdate.set(normalizedExchange, Date.now());
            }
            return fees;
        } catch (error) {
            logger.error(`Error fetching fees for ${exchange}:`, error);
            return this.fees.get(normalizedExchange) || this._getDefaultFees(normalizedExchange);
        }
    }

    async _fetchExchangeFees(exchange) {
        try {
            switch (exchange) {
                case 'safetrade':
                    return await this._fetchSafeTradeFees();
                case 'tradeogre':
                    return await this._fetchTradeOgreFees();
                case 'verusdefi':
                    return await this._fetchVerusDefiFees();
                case 'komodo':
                    return await this._fetchKomodoFees();
                default:
                    return this._getDefaultFees(exchange);
            }
        } catch (error) {
            logger.error(`Error fetching ${exchange} fees:`, error);
            return this._getDefaultFees(exchange);
        }
    }

    async _fetchSafeTradeFees() {
        const response = await fetch('https://safe.trade/api/v2/peatio/public/trading_fees');
        const data = await response.json();
        return {
            maker: new Decimal(data.trading_fees.maker_fee).toNumber(),
            taker: new Decimal(data.trading_fees.taker_fee).toNumber()
        };
    }

    async _fetchTradeOgreFees() {
        // TradeOgre doesn't have a fee API, using static values
        return {
            maker: 0.002,
            taker: 0.002
        };
    }

    async _fetchVerusDefiFees() {
        try {
            const response = await fetch('https://api.verus.services', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '1.0',
                    id: Date.now(),
                    method: 'getcurrency',
                    params: ['bridge.veth']
                })
            });

            const data = await response.json();
            if (!data?.result?.bestcurrencystate?.fees) {
                throw new Error('Invalid response format');
            }

            const fees = data.result.bestcurrencystate.fees;
            const protocolFee = new Decimal(fees.conversionfee || 0.001);
            const liquidityFee = new Decimal(fees.liquidityfee || 0.002);
            const totalFee = protocolFee.plus(liquidityFee);

            return {
                maker: totalFee.toNumber(),
                taker: totalFee.toNumber(),
                details: {
                    protocol: protocolFee.toNumber(),
                    liquidity: liquidityFee.toNumber()
                }
            };
        } catch (error) {
            logger.error('Error fetching VerusDefi fees:', error);
            return this._getDefaultFees('verusdefi');
        }
    }

    async _fetchKomodoFees() {
        const response = await fetch('https://api.komodo.earth/api/v2/fees');
        const data = await response.json();
        return {
            maker: new Decimal(data.trading_fees.maker).toNumber(),
            taker: new Decimal(data.trading_fees.taker).toNumber()
        };
    }

    _getDefaultFees(exchange) {
        const defaults = {
            safetrade: { maker: 0.002, taker: 0.002 },
            tradeogre: { maker: 0.002, taker: 0.002 },
            verusdefi: { maker: 0.003, taker: 0.003 },
            komodo: { maker: 0.0015, taker: 0.0025 }
        };
        return defaults[exchange] || { maker: 0.002, taker: 0.002 };
    }

    async getAllFees() {
        const exchanges = ['safetrade', 'tradeogre', 'verusdefi', 'komodo'];
        const fees = {};
        
        await Promise.all(exchanges.map(async exchange => {
            fees[exchange] = await this.getFees(exchange);
        }));
        
        return fees;
    }

    clearCache() {
        this.cache.flushAll();
        this.lastUpdate.clear();
        logger.info('Fee cache cleared');
    }
}

export const feeFetcher = new FeeFetcher();