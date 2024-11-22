import { EventEmitter } from 'events';
import { logger } from './logger.js';

export class CircuitBreaker extends EventEmitter {
    constructor(options = {}) {
        super();
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 1 minute
        this.halfOpenTimeout = options.halfOpenTimeout || 30000;
        this.monitors = new Map();
        this.lastStateChange = new Map();
    }

    isOpen(name) {
        const monitor = this._getMonitor(name);
        const timeSinceLastFailure = Date.now() - monitor.lastFailure;
        
        if (monitor.state === 'open' && timeSinceLastFailure <= this.resetTimeout) {
            return true;
        }

        if (monitor.state === 'open' && timeSinceLastFailure > this.resetTimeout) {
            this._transitionToHalfOpen(name);
            return false;
        }

        return false;
    }

    onSuccess(name) {
        const monitor = this._getMonitor(name);
        monitor.failures = 0;
        
        if (monitor.state === 'half-open') {
            this._transitionToClosed(name);
        }
    }

    onError(name) {
        const monitor = this._getMonitor(name);
        monitor.failures++;
        monitor.lastFailure = Date.now();

        if (monitor.failures >= this.failureThreshold) {
            this._transitionToOpen(name);
        }
    }

    _getMonitor(name) {
        if (!this.monitors.has(name)) {
            this.monitors.set(name, {
                failures: 0,
                state: 'closed',
                lastFailure: 0,
                consecutiveSuccesses: 0
            });
        }
        return this.monitors.get(name);
    }

    _transitionToOpen(name) {
        const monitor = this._getMonitor(name);
        const previousState = monitor.state;
        monitor.state = 'open';
        this.lastStateChange.set(name, Date.now());

        logger.warn(`Circuit breaker opened for ${name}`, {
            failures: monitor.failures,
            previousState,
            lastFailure: new Date(monitor.lastFailure).toISOString()
        });

        this.emit('open', {
            name,
            previousState,
            failures: monitor.failures,
            timestamp: Date.now()
        });
    }

    _transitionToHalfOpen(name) {
        const monitor = this._getMonitor(name);
        const previousState = monitor.state;
        monitor.state = 'half-open';
        monitor.consecutiveSuccesses = 0;
        this.lastStateChange.set(name, Date.now());

        logger.info(`Circuit breaker half-open for ${name}`, {
            previousState,
            timeSinceLastFailure: Date.now() - monitor.lastFailure
        });

        this.emit('half-open', {
            name,
            previousState,
            timestamp: Date.now()
        });
    }

    _transitionToClosed(name) {
        const monitor = this._getMonitor(name);
        const previousState = monitor.state;
        monitor.state = 'closed';
        monitor.failures = 0;
        monitor.consecutiveSuccesses = 0;
        this.lastStateChange.set(name, Date.now());

        logger.info(`Circuit breaker closed for ${name}`, {
            previousState,
            timeSinceLastChange: Date.now() - (this.lastStateChange.get(name) || 0)
        });

        this.emit('closed', {
            name,
            previousState,
            timestamp: Date.now()
        });
    }

    getStatus(name) {
        const monitor = this._getMonitor(name);
        const lastChange = this.lastStateChange.get(name);

        return {
            name,
            state: monitor.state,
            failures: monitor.failures,
            lastFailure: monitor.lastFailure,
            lastStateChange: lastChange,
            timeSinceLastChange: lastChange ? Date.now() - lastChange : null
        };
    }

    reset(name) {
        if (this.monitors.has(name)) {
            this._transitionToClosed(name);
        }
    }

    resetAll() {
        for (const name of this.monitors.keys()) {
            this.reset(name);
        }
    }
}