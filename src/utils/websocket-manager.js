import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { logger } from './logger.js';
import { HeartbeatManager } from './heartbeat.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { PriceValidator } from './price-validator.js';

export class WebSocketManager extends EventEmitter {
    constructor() {
        super();
        this.connections = new Map();
        this.heartbeatManager = new HeartbeatManager();
        this.circuitBreaker = new CircuitBreaker();
        this.priceValidator = new PriceValidator();
        this.reconnectAttempts = new Map();
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.lastPrices = new Map();

        this._setupHeartbeatMonitoring();
    }

    _setupHeartbeatMonitoring() {
        this.heartbeatManager.on('connectionFailed', ({ connectionId }) => {
            logger.warn(`Heartbeat failure detected for ${connectionId}`);
            const connection = this.connections.get(connectionId);
            if (connection) {
                this._handleDisconnect(connectionId, connection.url, connection.options);
            }
        });
    }

    connect(exchange, url, options = {}) {
        if (this.circuitBreaker.isOpen(exchange)) {
            logger.warn(`Circuit breaker is open for ${exchange}, skipping connection`);
            return null;
        }

        try {
            const ws = new WebSocket(url, options);
            
            ws.on('open', () => {
                logger.info(`WebSocket connected for ${exchange}`);
                this.reconnectAttempts.set(exchange, 0);
                this.circuitBreaker.onSuccess(exchange);
                this.heartbeatManager.startMonitoring(exchange, ws);
                this.emit('connected', exchange);
            });

            ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    const price = this._extractPrice(exchange, message);
                    
                    if (price && this.priceValidator.validatePrice(price)) {
                        this.lastPrices.set(exchange, {
                            price,
                            timestamp: Date.now()
                        });
                        this.emit('price', { exchange, price, raw: message });
                    }
                } catch (error) {
                    logger.error(`WebSocket message parse error for ${exchange}:`, error);
                }
            });

            ws.on('error', (error) => {
                logger.error(`WebSocket error for ${exchange}:`, error);
                this.circuitBreaker.onError(exchange);
                this.emit('error', { exchange, error });
            });

            ws.on('close', () => {
                logger.warn(`WebSocket closed for ${exchange}`);
                this.heartbeatManager.stopMonitoring(exchange);
                this._handleDisconnect(exchange, url, options);
            });

            ws.on('pong', () => {
                this.heartbeatManager.receivePong(exchange);
            });

            this.connections.set(exchange, { ws, url, options });
            return ws;

        } catch (error) {
            logger.error(`WebSocket connection error for ${exchange}:`, error);
            this.circuitBreaker.onError(exchange);
            throw error;
        }
    }

    _extractPrice(exchange, message) {
        try {
            switch (exchange.toLowerCase()) {
                case 'safetrade':
                    return message.data?.price ? parseFloat(message.data.price) : null;
                case 'tradeogre':
                    return message.last_price ? parseFloat(message.last_price) : null;
                case 'verusdefi':
                    return message.price ? parseFloat(message.price) : null;
                case 'komodo':
                    return message.last ? parseFloat(message.last) : null;
                default:
                    return null;
            }
        } catch (error) {
            logger.error(`Error extracting price for ${exchange}:`, error);
            return null;
        }
    }

    _handleDisconnect(exchange, url, options) {
        const attempts = this.reconnectAttempts.get(exchange) || 0;
        
        if (attempts < this.maxReconnectAttempts) {
            const delay = this.reconnectDelay * Math.pow(2, attempts);
            setTimeout(() => {
                logger.info(`Attempting to reconnect to ${exchange} (attempt ${attempts + 1})`);
                this.reconnectAttempts.set(exchange, attempts + 1);
                this.connect(exchange, url, options);
            }, delay);
        } else {
            logger.error(`Max reconnection attempts reached for ${exchange}`);
            this.circuitBreaker.onError(exchange);
            this.emit('maxReconnectAttempts', exchange);
        }
    }

    getLastPrice(exchange) {
        return this.lastPrices.get(exchange);
    }

    isConnected(exchange) {
        const connection = this.connections.get(exchange);
        return connection?.ws?.readyState === WebSocket.OPEN;
    }

    getStatus(exchange) {
        const connection = this.connections.get(exchange);
        const lastPrice = this.lastPrices.get(exchange);
        const heartbeat = this.heartbeatManager.getStatus(exchange);
        
        return {
            connected: this.isConnected(exchange),
            readyState: connection?.ws?.readyState,
            reconnectAttempts: this.reconnectAttempts.get(exchange) || 0,
            circuitBreaker: this.circuitBreaker.getStatus(exchange),
            heartbeat,
            lastPrice: lastPrice ? {
                price: lastPrice.price,
                age: Date.now() - lastPrice.timestamp
            } : null
        };
    }

    disconnect(exchange) {
        const connection = this.connections.get(exchange);
        if (connection) {
            this.heartbeatManager.stopMonitoring(exchange);
            connection.ws.close();
            this.connections.delete(exchange);
            this.lastPrices.delete(exchange);
            logger.info(`Disconnected from ${exchange}`);
        }
    }

    disconnectAll() {
        for (const [exchange] of this.connections) {
            this.disconnect(exchange);
        }
    }
}