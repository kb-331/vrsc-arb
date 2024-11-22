import { BaseExchange } from './base.js';
import { logger } from '../utils/logger.js';
import { WebSocketManager } from '../utils/websocket-manager.js';

export class SafeTrade extends BaseExchange {
    constructor() {
        super('SafeTrade');
        this.baseUrl = 'https://safe.trade/api/v2';
        this.wsUrl = 'wss://safe.trade/ws';
        this.wsManager = new WebSocketManager();
        this._setupWebSocket();
    }

    async _setupWebSocket() {
        try {
            const ws = this.wsManager.connect(this.name, this.wsUrl);

            ws.on('open', () => {
                ws.send(JSON.stringify({
                    event: 'subscribe',
                    streams: ['vrscusdt.trades', 'vrscusdt.orderbook']
                }));
            });

            this.wsManager.on('message', ({ data }) => {
                if (data.stream === 'vrscusdt.trades') {
                    this._handleTradeUpdate(data.data);
                } else if (data.stream === 'vrscusdt.orderbook') {
                    this._handleOrderBookUpdate(data.data);
                }
            });
        } catch (error) {
            logger.error('SafeTrade WebSocket setup failed:', error);
        }
    }

    _handleTradeUpdate(trade) {
        try {
            const price = parseFloat(trade.price);
            if (this.priceValidator.validatePrice(price)) {
                this._updatePriceCache({
                    price,
                    timestamp: Date.now(),
                    source: 'websocket',
                    raw: trade
                });
            }
        } catch (error) {
            logger.error('Error handling trade update:', error);
        }
    }

    _handleOrderBookUpdate(orderbook) {
        try {
            const topAsk = parseFloat(orderbook.asks[0][0]);
            const topBid = parseFloat(orderbook.bids[0][0]);
            const midPrice = (topAsk + topBid) / 2;

            if (this.priceValidator.validatePrice(midPrice)) {
                this._updatePriceCache({
                    price: midPrice,
                    timestamp: Date.now(),
                    source: 'websocket',
                    raw: {
                        topAsk,
                        topBid,
                        spread: ((topAsk - topBid) / topBid) * 100
                    }
                });
            }
        } catch (error) {
            logger.error('Error handling orderbook update:', error);
        }
    }

    async _fetchPriceImpl() {
        try {
            const data = await this._makeRequest('/peatio/public/markets/vrscusdt/tickers');
            
            if (!data?.ticker) {
                throw new Error('Invalid response format');
            }
            
            return {
                price: parseFloat(data.ticker.last),
                timestamp: Date.now(),
                success: true,
                raw: {
                    volume24h: parseFloat(data.ticker.vol),
                    high24h: parseFloat(data.ticker.high),
                    low24h: parseFloat(data.ticker.low),
                    change24h: parseFloat(data.ticker.price_change_percent)
                }
            };
        } catch (error) {
            throw new Error(`SafeTrade API error: ${error.message}`);
        }
    }
}