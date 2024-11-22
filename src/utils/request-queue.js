import { EventEmitter } from 'events';
import { logger } from './logger.js';
import PQueue from 'p-queue';

export class RequestQueue extends EventEmitter {
    constructor(config = {}) {
        super();
        this.queues = new Map();
        this.defaultConfig = {
            concurrency: 1,
            interval: 5000,
            intervalCap: 1,
            timeout: 30000
        };
    }

    async enqueue(exchange, operation) {
        const queue = this._getQueue(exchange);
        
        return queue.add(async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 
                this.defaultConfig.timeout);

            try {
                const result = await operation();
                this.emit('success', { exchange });
                return result;
            } finally {
                clearTimeout(timeout);
            }
        });
    }

    _getQueue(exchange) {
        if (!this.queues.has(exchange)) {
            const config = this._getConfig(exchange);
            this.queues.set(exchange, new PQueue(config));
        }
        return this.queues.get(exchange);
    }

    _getConfig(exchange) {
        const configs = {
            safetrade: {
                concurrency: 1,
                interval: 10000,
                intervalCap: 1
            },
            tradeogre: {
                concurrency: 1,
                interval: 10000,
                intervalCap: 1
            },
            verusdefi: {
                concurrency: 2,
                interval: 5000,
                intervalCap: 1
            },
            komodo: {
                concurrency: 1,
                interval: 10000,
                intervalCap: 1
            }
        };

        return configs[exchange.toLowerCase()] || this.defaultConfig;
    }

    getQueueStatus(exchange) {
        const queue = this.queues.get(exchange);
        if (!queue) return null;

        return {
            size: queue.size,
            pending: queue.pending,
            isPaused: queue.isPaused,
            isIdle: queue.idle
        };
    }
}