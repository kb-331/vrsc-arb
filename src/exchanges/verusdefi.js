import { BaseExchange } from './base.js';
import { logger } from '../utils/logger.js';
import { VerusRpcClient } from '../utils/verus-rpc-client.js';
import Decimal from 'decimal.js';

export class VerusDefi extends BaseExchange {
    constructor() {
        super('VerusDefi');
        this.baseUrl = 'https://api.verus.services';
        this.rpcClient = new VerusRpcClient({ baseUrl: this.baseUrl });
        this.currencies = {
            vrsc: 'vrsc',
            dai: 'dai.veth',
            bridge: 'bridge.veth'
        };
    }

    async _fetchPriceImpl() {
        try {
            const [bridgeState, estimate] = await Promise.all([
                this.rpcClient.getCurrencyState(this.currencies.bridge),
                this.rpcClient.estimateConversion(
                    1,
                    this.currencies.vrsc,
                    this.currencies.dai,
                    this.currencies.bridge
                )
            ]);

            if (!bridgeState?.reservecurrencies) {
                throw new Error('Invalid bridge state data');
            }

            const { vrscReserve, daiReserve } = this._extractReserveData(bridgeState);
            const reservePrice = this._calculatePrice(vrscReserve, daiReserve);
            const estimatedPrice = estimate ? new Decimal(estimate.amount) : null;

            // Get current fees
            const fees = await this.getFees();

            logger.debug('VerusDefi price calculation:', {
                reservePrice,
                estimatedPrice,
                vrscReserve: vrscReserve.reserves,
                daiReserve: daiReserve.reserves
            });

            return {
                price: estimatedPrice?.toNumber() || reservePrice,
                timestamp: Date.now(),
                success: true,
                raw: {
                    volume24h: parseFloat(vrscReserve.reserves),
                    reserves: {
                        vrsc: parseFloat(vrscReserve.reserves),
                        dai: parseFloat(daiReserve.reserves)
                    },
                    fees: {
                        protocol: fees.details?.protocol || 0.001,
                        liquidity: fees.details?.liquidity || 0.002
                    }
                }
            };
        } catch (error) {
            throw new Error(`VerusDefi API error: ${error.message}`);
        }
    }

    _extractReserveData(bridgeState) {
        const vrscReserve = bridgeState.reservecurrencies.find(c => 
            c.currencyid === this.currencies.vrsc
        );
        const daiReserve = bridgeState.reservecurrencies.find(c => 
            c.currencyid === this.currencies.dai
        );

        if (!vrscReserve || !daiReserve) {
            throw new Error('Required reserve currencies not found');
        }

        return { vrscReserve, daiReserve };
    }

    _calculatePrice(vrscReserve, daiReserve) {
        const vrscAmount = new Decimal(vrscReserve.reserves);
        const daiAmount = new Decimal(daiReserve.reserves);
        return daiAmount.div(vrscAmount).toNumber();
    }

    async getMarketDepth() {
        try {
            const converters = await this.rpcClient.getCurrencyConverters([
                this.currencies.vrsc,
                this.currencies.dai
            ]);

            return {
                converters,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error('Error fetching market depth:', error);
            return null;
        }
    }

    async calculateSlippage(amount, side = 'buy') {
        const depth = await this.getMarketDepth();
        if (!depth?.converters) return null;

        let totalLiquidity = new Decimal(0);
        let weightedPrice = new Decimal(0);

        for (const converter of depth.converters) {
            const liquidity = new Decimal(converter.reserves[side === 'buy' ? 'dai' : 'vrsc']);
            totalLiquidity = totalLiquidity.plus(liquidity);
            weightedPrice = weightedPrice.plus(
                liquidity.mul(converter.lastprice || converter.currentprice)
            );
        }

        if (totalLiquidity.isZero()) return null;

        const averagePrice = weightedPrice.div(totalLiquidity);
        const amountDecimal = new Decimal(amount);
        const slippage = amountDecimal.div(totalLiquidity).mul(100);

        return {
            averagePrice: averagePrice.toNumber(),
            slippagePercent: slippage.toNumber(),
            totalLiquidity: totalLiquidity.toNumber()
        };
    }
}