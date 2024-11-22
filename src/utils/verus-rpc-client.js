import { logger } from './logger.js';
import { fetchWithRetry } from './fetch-retry.js';
import Decimal from 'decimal.js';

export class VerusRpcClient {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || 'https://api.verus.services';
        this.timeout = config.timeout || 30000;
        this.retries = config.retries || 3;
    }

    async makeRpcCall(method, params = []) {
        try {
            const response = await fetchWithRetry(this.baseUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '1.0',
                    id: Date.now(),
                    method,
                    params
                }),
                timeout: this.timeout,
                retries: this.retries
            });

            if (!response?.result) {
                throw new Error(`Invalid RPC response for method ${method}`);
            }

            return response.result;
        } catch (error) {
            logger.error(`RPC call failed for ${method}:`, error);
            throw error;
        }
    }

    async estimateConversion(amount, fromCurrency, toCurrency, via) {
        try {
            const result = await this.makeRpcCall('estimateconversion', [{
                currency: fromCurrency,
                convertto: toCurrency,
                via,
                amount: amount.toString()
            }]);

            if (!result?.estimatedcurrency?.amount) {
                throw new Error('Invalid conversion estimate response');
            }

            return {
                amount: new Decimal(result.estimatedcurrency.amount).toString(),
                fees: result.estimatedcurrency.fees || {},
                path: result.estimatedcurrency.conversionpath || []
            };
        } catch (error) {
            logger.error('Error estimating conversion:', error);
            throw error;
        }
    }

    async getCurrencyState(currency) {
        try {
            const result = await this.makeRpcCall('getcurrency', [currency]);
            
            if (!result?.bestcurrencystate) {
                throw new Error('Invalid currency state response');
            }

            return result.bestcurrencystate;
        } catch (error) {
            logger.error('Error getting currency state:', error);
            throw error;
        }
    }

    async getCurrencyConverters(currencies) {
        try {
            const result = await this.makeRpcCall('getcurrencyconverters', currencies);
            
            if (!Array.isArray(result)) {
                throw new Error('Invalid currency converters response');
            }

            return result;
        } catch (error) {
            logger.error('Error getting currency converters:', error);
            throw error;
        }
    }

    async getReserveRatio(currency) {
        try {
            const state = await this.getCurrencyState(currency);
            
            if (!state.reservecurrencies || !state.reservecurrencies.length) {
                throw new Error('No reserve currencies found');
            }

            const totalReserves = state.reservecurrencies.reduce((sum, curr) => 
                sum.plus(new Decimal(curr.reserves)), new Decimal(0));

            return {
                ratio: totalReserves.div(state.supply).toString(),
                reserves: state.reservecurrencies.map(curr => ({
                    currency: curr.currencyid,
                    amount: curr.reserves,
                    ratio: new Decimal(curr.reserves).div(state.supply).toString()
                }))
            };
        } catch (error) {
            logger.error('Error calculating reserve ratio:', error);
            throw error;
        }
    }
}