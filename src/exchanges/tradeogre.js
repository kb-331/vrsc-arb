import { BaseExchange } from './base.js';
import { logger } from '../utils/logger.js';
import { WebSocketManager } from '../utils/websocket-manager.js';
import Decimal from 'decimal.js';

export class TradeOgre extends BaseExchange {
    constructor() {
        super('TradeOgre');
        this.baseUrl = 'https://tradeogre.com/api/v1';
        this.wsUrl = 'wss://tradeogre.com/ws';
        this.wsManager = new WebSocketManager();
        this.btcUsdtPrice = null;
        this.lastBtcUpdate = 0;
        this.btcUpdateInterval = 60000;
        this._setupWebSocket();
    }

    async _setupWebSocket() {
        try {
            const ws = this.wsManager.connect(this.name, this.wsUrl);

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    action: 'subscribe',
                    pairs: ['BTC-VRSC']
                }));
            });

            this.wsManager.on('message', ({ data }) => {
                if (data.type === 'trade') {
                    this._handleTradeUpdate(data);
                } else if (data.type === 'orderbook') {
                    this._handleOrderBookUpdate(data);
                }
            });
        } catch (error) {
            logger.error('TradeOgre WebSocket setup failed:', error);
        }
    }

    _handleTradeUpdate(trade) {
        try {
            const btcPrice = this.btcUsdtPrice;
            if (!btcPrice) return;

            const priceInBtc = new Decimal(trade.price);
            const priceInUsdt = priceInBtc.mul(btcPrice);

            if (this.priceValidator.validatePrice(priceInUsdt)) {
                this._updatePriceCache({
                    price: priceInUsdt.toNumber(),
                    timestamp: Date.now(),
                    source: 'websocket',
                    raw: {
                        btcPrice: priceInBtc.toNumber(),
                        usdtPrice: btcPrice.toNumber(),
                        ...trade
                    }
                });
            }
        } catch (error) {
            logger.error('Error handling trade update:', error);
        }
    }

    _handleOrderBookUpdate(orderbook) {
        try {
            const btcPrice = this.btcUsdtPrice;
            if (!btcPrice) return;

            const topAskBtc = new Decimal(orderbook.asks[0][0]);
            const topBidBtc = new Decimal(orderbook.bids[0][0]);
            const midPriceBtc = topAskBtc.plus(topBidBtc).div(2);
            const midPriceUsdt = midPriceBtc.mul(btcPrice);

            if (this.priceValidator.validatePrice(midPriceUsdt)) {
                this._updatePriceCache({
                    price: midPriceUsdt.toNumber(),
                    timestamp: Date.now(),
                    source: 'websocket',
                    raw: {
                        topAskBtc: topAskBtc.toNumber(),
                        topBidBtc: topBidBtc.toNumber(),
                        btcPrice: btcPrice.toNumber()
                    }
                });
            }
        } catch (error) {
            logger.error('Error handling orderbook update:', error);
        }
    }

    // Rest of the code remains unchanged...
}