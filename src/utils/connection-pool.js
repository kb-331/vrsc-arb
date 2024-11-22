import { EventEmitter } from 'events';
import { logger } from './logger.js';

export class ConnectionPool extends EventEmitter {
    constructor(config = {}) {
        super();
        this.maxConnections = config.maxConnections || 5;
        this.idleTimeout = config.idleTimeout || 30000;
        this.maxIdleTime = config.maxIdleTime || 300000;
        this.connections = new Map();
        this.connectionQueue = [];
    }

    async acquire(exchange) {
        let connection = this._getIdleConnection(exchange);
        
        if (!connection) {
            if (this.connections.size >= this.maxConnections) {
                connection = await this._waitForConnection(exchange);
            } else {
                connection = await this._createConnection(exchange);
            }
        }

        connection.lastUsed = Date.now();
        connection.inUse = true;
        return connection;
    }

    release(connection) {
        connection.inUse = false;
        connection.lastUsed = Date.now();

        if (this.connectionQueue.length > 0) {
            const { resolve } = this.connectionQueue.shift();
            resolve(connection);
        }

        this._cleanupIdleConnections();
    }

    _getIdleConnection(exchange) {
        for (const connection of this.connections.values()) {
            if (!connection.inUse && connection.exchange === exchange) {
                return connection;
            }
        }
        return null;
    }

    async _createConnection(exchange) {
        const connection = {
            id: Date.now().toString(),
            exchange,
            created: Date.now(),
            lastUsed: Date.now(),
            inUse: true
        };

        this.connections.set(connection.id, connection);
        return connection;
    }

    async _waitForConnection(exchange) {
        return new Promise((resolve) => {
            this.connectionQueue.push({ exchange, resolve });
        });
    }

    _cleanupIdleConnections() {
        const now = Date.now();
        for (const [id, connection] of this.connections.entries()) {
            if (!connection.inUse && 
                (now - connection.lastUsed > this.maxIdleTime)) {
                this.connections.delete(id);
            }
        }
    }

    getStatus() {
        return {
            activeConnections: this.connections.size,
            queueLength: this.connectionQueue.length,
            idleConnections: Array.from(this.connections.values())
                .filter(c => !c.inUse).length
        };
    }
}