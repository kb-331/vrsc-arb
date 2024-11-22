import { EventEmitter } from 'events';
import { logger } from './logger.js';

export class HeartbeatManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.connections = new Map();
        this.config = {
            checkInterval: config.checkInterval || 5000,
            maxMissedBeats: config.maxMissedBeats || 3,
            timeout: config.timeout || 30000,
            ...config
        };
    }

    startMonitoring(connectionId, ws) {
        if (this.connections.has(connectionId)) {
            this.stopMonitoring(connectionId);
        }

        const connection = {
            ws,
            isAlive: true,
            missedBeats: 0,
            lastBeat: Date.now(),
            checkInterval: null,
            pingTimeout: null
        };

        connection.checkInterval = setInterval(() => {
            this._checkConnection(connectionId, connection);
        }, this.config.checkInterval);

        this.connections.set(connectionId, connection);
        logger.debug(`Started heartbeat monitoring for ${connectionId}`);
    }

    stopMonitoring(connectionId) {
        const connection = this.connections.get(connectionId);
        if (connection) {
            clearInterval(connection.checkInterval);
            clearTimeout(connection.pingTimeout);
            this.connections.delete(connectionId);
            logger.debug(`Stopped heartbeat monitoring for ${connectionId}`);
        }
    }

    receivePong(connectionId) {
        const connection = this.connections.get(connectionId);
        if (connection) {
            connection.isAlive = true;
            connection.missedBeats = 0;
            connection.lastBeat = Date.now();
            clearTimeout(connection.pingTimeout);
        }
    }

    _checkConnection(connectionId, connection) {
        if (!connection.isAlive) {
            connection.missedBeats++;
            logger.warn(`Missed heartbeat for ${connectionId}`, {
                missedBeats: connection.missedBeats,
                maxMissedBeats: this.config.maxMissedBeats
            });

            if (connection.missedBeats >= this.config.maxMissedBeats) {
                this._handleConnectionFailure(connectionId, connection);
                return;
            }
        }

        connection.isAlive = false;
        connection.ws.ping();

        connection.pingTimeout = setTimeout(() => {
            connection.isAlive = false;
        }, this.config.timeout);
    }

    _handleConnectionFailure(connectionId, connection) {
        logger.error(`Connection ${connectionId} failed heartbeat check`);
        
        this.emit('connectionFailed', {
            connectionId,
            lastBeat: connection.lastBeat,
            missedBeats: connection.missedBeats
        });

        this.stopMonitoring(connectionId);
    }

    getStatus(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return null;

        return {
            isAlive: connection.isAlive,
            missedBeats: connection.missedBeats,
            lastBeat: connection.lastBeat,
            timeSinceLastBeat: Date.now() - connection.lastBeat
        };
    }

    getActiveConnections() {
        return Array.from(this.connections.entries()).map(([id, conn]) => ({
            id,
            isAlive: conn.isAlive,
            missedBeats: conn.missedBeats,
            lastBeat: conn.lastBeat
        }));
    }
}