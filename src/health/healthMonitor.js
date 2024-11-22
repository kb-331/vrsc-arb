import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import si from 'systeminformation';
import osUtils from 'node-os-utils';

export class HealthMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            checkInterval: config.checkInterval || 30000,    // 30 seconds
            cpuThreshold: config.cpuThreshold || 80,        // 80% CPU threshold
            memoryThreshold: config.memoryThreshold || 85,  // 85% memory threshold
            diskThreshold: config.diskThreshold || 90,      // 90% disk threshold
            ...config
        };

        this.metrics = new Map();
        this.status = 'healthy';
        this.monitoringInterval = null;
    }

    async start() {
        if (this.monitoringInterval) {
            logger.warn('Health monitor already running');
            return;
        }

        logger.info('Starting health monitoring');
        await this._checkHealth();

        this.monitoringInterval = setInterval(
            () => this._checkHealth(),
            this.config.checkInterval
        );
    }

    async stop() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        logger.info('Health monitoring stopped');
    }

    async _checkHealth() {
        try {
            const [cpu, memory, disk, load] = await Promise.all([
                this._checkCPU(),
                this._checkMemory(),
                this._checkDisk(),
                this._checkSystemLoad()
            ]);

            const timestamp = Date.now();
            const health = {
                cpu,
                memory,
                disk,
                load,
                timestamp
            };

            this._updateMetrics(health);
            this._evaluateHealth(health);

        } catch (error) {
            logger.error('Health check error:', error);
            this.emit('error', error);
        }
    }

    async _checkCPU() {
        const cpuLoad = await osUtils.cpu.usage();
        return {
            usage: cpuLoad,
            threshold: this.config.cpuThreshold,
            status: cpuLoad < this.config.cpuThreshold ? 'healthy' : 'warning'
        };
    }

    async _checkMemory() {
        const mem = await si.mem();
        const usedPercent = (mem.used / mem.total) * 100;

        return {
            total: mem.total,
            used: mem.used,
            usedPercent,
            threshold: this.config.memoryThreshold,
            status: usedPercent < this.config.memoryThreshold ? 'healthy' : 'warning'
        };
    }

    async _checkDisk() {
        const disk = await si.fsSize();
        const mainDisk = disk[0]; // Primary disk
        const usedPercent = (mainDisk.used / mainDisk.size) * 100;

        return {
            total: mainDisk.size,
            used: mainDisk.used,
            usedPercent,
            threshold: this.config.diskThreshold,
            status: usedPercent < this.config.diskThreshold ? 'healthy' : 'warning'
        };
    }

    async _checkSystemLoad() {
        const load = await si.currentLoad();
        return {
            currentLoad: load.currentLoad,
            avgLoad: load.avgLoad,
            status: load.currentLoad < 90 ? 'healthy' : 'warning'
        };
    }

    _updateMetrics(health) {
        this.metrics.set(health.timestamp, health);

        // Keep only last hour of metrics
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        for (const [timestamp] of this.metrics) {
            if (timestamp < oneHourAgo) {
                this.metrics.delete(timestamp);
            }
        }
    }

    _evaluateHealth(health) {
        const previousStatus = this.status;
        let newStatus = 'healthy';

        // Check CPU
        if (health.cpu.usage >= this.config.cpuThreshold) {
            newStatus = 'warning';
        }

        // Check Memory
        if (health.memory.usedPercent >= this.config.memoryThreshold) {
            newStatus = 'warning';
        }

        // Check Disk
        if (health.disk.usedPercent >= this.config.diskThreshold) {
            newStatus = 'warning';
        }

        // Check System Load
        if (health.load.currentLoad >= 90) {
            newStatus = 'warning';
        }

        // Update status if changed
        if (newStatus !== previousStatus) {
            this.status = newStatus;
            this.emit('statusChange', {
                previous: previousStatus,
                current: newStatus,
                timestamp: Date.now()
            });
        }

        // Emit metrics update
        this.emit('metrics', health);
    }

    getStatus() {
        return {
            status: this.status,
            metrics: Array.from(this.metrics.values()).pop(),
            lastCheck: Array.from(this.metrics.keys()).pop()
        };
    }

    getMetrics(timeRange = 3600000) { // Default to last hour
        const cutoff = Date.now() - timeRange;
        return Array.from(this.metrics.entries())
            .filter(([timestamp]) => timestamp >= cutoff)
            .map(([_, metrics]) => metrics);
    }
}