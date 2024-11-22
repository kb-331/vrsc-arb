import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

export class ServiceMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.services = new Map();
        this.config = {
            checkInterval: config.checkInterval || 30000,  // 30 seconds
            timeout: config.timeout || 5000,              // 5 seconds timeout
            retryAttempts: config.retryAttempts || 3,
            ...config
        };
    }

    registerService(name, checkFn) {
        this.services.set(name, {
            name,
            checkFn,
            status: 'unknown',
            lastCheck: null,
            failures: 0
        });

        logger.info(`Registered service: ${name}`);
    }

    async startMonitoring() {
        if (this.monitoringInterval) {
            logger.warn('Service monitoring already running');
            return;
        }

        logger.info('Starting service monitoring');
        await this._checkServices();

        this.monitoringInterval = setInterval(
            () => this._checkServices(),
            this.config.checkInterval
        );
    }

    async stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        logger.info('Service monitoring stopped');
    }

    async _checkServices() {
        for (const [name, service] of this.services) {
            try {
                const status = await this._checkServiceWithRetry(service);
                this._updateServiceStatus(name, status);
            } catch (error) {
                logger.error(`Service check failed for ${name}:`, error);
                this._handleServiceFailure(name);
            }
        }
    }

    async _checkServiceWithRetry(service) {
        let lastError;

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                const result = await Promise.race([
                    service.checkFn(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), this.config.timeout)
                    )
                ]);

                return result;
            } catch (error) {
                lastError = error;
                if (attempt < this.config.retryAttempts) {
                    await new Promise(resolve => 
                        setTimeout(resolve, 1000 * attempt)
                    );
                }
            }
        }

        throw lastError;
    }

    _updateServiceStatus(name, status) {
        const service = this.services.get(name);
        if (!service) return;

        const previousStatus = service.status;
        service.status = status;
        service.lastCheck = Date.now();
        service.failures = 0;

        if (previousStatus !== status) {
            this.emit('statusChange', {
                service: name,
                previous: previousStatus,
                current: status,
                timestamp: Date.now()
            });
        }
    }

    _handleServiceFailure(name) {
        const service = this.services.get(name);
        if (!service) return;

        service.failures++;
        service.lastCheck = Date.now();

        if (service.status !== 'failed') {
            service.status = 'failed';
            this.emit('serviceFailure', {
                service: name,
                failures: service.failures,
                timestamp: Date.now()
            });
        }
    }

    getServiceStatus(name) {
        return this.services.get(name);
    }

    getAllServices() {
        return Array.from(this.services.values()).map(service => ({
            name: service.name,
            status: service.status,
            lastCheck: service.lastCheck,
            failures: service.failures
        }));
    }
}