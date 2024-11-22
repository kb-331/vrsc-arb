import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { PriceNormalizer } from './priceNormalizer.js';
import { ExchangeManager } from '../exchanges/exchangeManager.js';
import Decimal from 'decimal.js';

export class PriceFeedManager extends EventEmitter {
    constructor() {
        super();
        this.normalizer = new PriceNormalizer();
        this.exchangeManager = new ExchangeManager();
        this.lastUpdate = new Map();
    }

    async initialize() {
        try {
            logger.info('Initializing price feed manager');
            await this.normalizer.initialize();
            await this.exchangeManager.initialize();
            this._setupEventHandlers();
        } catch (error) {
            logger.error('Failed to initialize price feed manager:', error);
            throw error;
        }
    }

    async shutdown() {
        try {
            logger.info('Shutting down price feed manager');
            await this.exchangeManager.disconnectAll();
        } catch (error) {
            logger.error('Error during shutdown:', error);
        }
    }

    _setupEventHandlers() {
        this.exchangeManager.on('price', (data) => {
            const normalized = this.normalizer.normalizePrice(data);
            if (normalized) {
                this._handleNormalizedPrice(normalized);
            }
        });

        this.exchangeManager.on('exchangeError', (error) => {
            logger.error('Exchange error:', error);
            this.emit('error', error);
        });
    }

    _handleNormalizedPrice(data) {
        const { exchange, symbol, price, timestamp } = data;
        
        this.lastUpdate.set(`${exchange}_${symbol}`, {
            price: new Decimal(price),
            timestamp
        });

        this.emit('price', data);
    }

    getLastPrice(exchange, symbol) {
        return this.lastUpdate.get(`${exchange}_${symbol}`);
    }

    getExchangeStatus() {
        return this.exchangeManager.getStatus();
    }
}