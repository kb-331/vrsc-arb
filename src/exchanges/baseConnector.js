import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import WebSocket from 'ws';
import fetch from 'node-fetch';
import pLimit from 'p-limit';
import pRetry from 'p-retry';

export class BaseConnector extends EventEmitter {
    constructor(config = {}) {
        super();
        this.name = config.name;
        this.wsUrl = config.wsUrl;
        this.restUrl = config.restUrl;
        this.rateLimiter = pLimit(config.rateLimit || 1);
        this.ws = null;
        this.connected = false;
        this.retryAttempts = config.retryAttempts || 3;
        this.retryDelay = config.retryDelay || 5000;
    }

    async connect() {
        if (this.connected) return;

        try {
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws.on('open', () => {
                this.connected = true;
                this._onConnected();
                logger.info(`${this.name} WebSocket connected`);
            });

            this.ws.on('message', (data) => {
                this._handleMessage(data);
            });

            this.ws.on('error', (error) => {
                logger.error(`${this.name} WebSocket error:`, error);
                this._handleError(error);
            });

            this.ws.on('close', () => {
                this.connected = false;
                this._handleDisconnect();
            });

        } catch (error) {
            logger.error(`${this.name} connection error:`, error);
            throw error;
        }
    }

    async disconnect() {
        if (this.ws) {
            this.ws.close();
            this.connected = false;
        }
    }

    async fetchPrice(symbol) {
        return this.rateLimiter(async () => {
            try {
                return await pRetry(
                    () => this._fetchPriceImpl(symbol),
                    {
                        retries: this.retryAttempts,
                        minTimeout: this.retryDelay
                    }
                );
            } catch (error) {
                logger.error(`${this.name} price fetch error:`, error);
                throw error;
            }
        });
    }

    _onConnected() {
        // Implement in derived class
    }

    _handleMessage(data) {
        // Implement in derived class
    }

    _handleError(error) {
        this.emit('error', { exchange: this.name, error });
    }

    _handleDisconnect() {
        logger.warn(`${this.name} WebSocket disconnected`);
        this.emit('disconnected', this.name);
        
        // Attempt reconnection
        setTimeout(() => {
            if (!this.connected) {
                this.connect().catch(error => 
                    logger.error(`${this.name} reconnection failed:`, error)
                );
            }
        }, this.retryDelay);
    }

    async _fetchPriceImpl(symbol) {
        throw new Error('_fetchPriceImpl must be implemented by derived class');
    }

    isConnected() {
        return this.connected;
    }

    getStatus() {
        return {
            name: this.name,
            connected: this.connected,
            timestamp: Date.now()
        };
    }
}