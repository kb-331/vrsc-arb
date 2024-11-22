import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

export class ExchangeManager extends EventEmitter {
    constructor() {
        super();
        this.exchanges = new Map();
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            logger.info('Initializing exchange manager');
            this.initialized = true;
        } catch (error) {
            logger.error('Failed to initialize exchange manager:', error);
            throw error;
        }
    }

    registerExchange(exchange) {
        if (this.exchanges.has(exchange.name)) {
            throw new Error(`Exchange ${exchange.name} already registered`);
        }

        this.exchanges.set(exchange.name, exchange);
        
        exchange.on('price', (data) => {
            this.emit('price', data);
        });

        exchange.on('error', (error) => {
            logger.error(`Exchange ${exchange.name} error:`, error);
            this.emit('exchangeError', { exchange: exchange.name, error });
        });

        logger.info(`Registered exchange: ${exchange.name}`);
    }

    async connectAll() {
        const connections = Array.from(this.exchanges.values()).map(
            exchange => exchange.connect()
        );

        await Promise.all(connections);
    }

    async disconnectAll() {
        const disconnections = Array.from(this.exchanges.values()).map(
            exchange => exchange.disconnect()
        );

        await Promise.all(disconnections);
    }

    getExchange(name) {
        return this.exchanges.get(name);
    }

    getAllExchanges() {
        return Array.from(this.exchanges.values());
    }

    getStatus() {
        return Array.from(this.exchanges.values()).map(
            exchange => exchange.getStatus()
        );
    }
}