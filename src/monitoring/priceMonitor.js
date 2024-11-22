import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { PriceValidator } from '../utils/price-validator.js';
import { CircuitBreaker } from '../utils/circuit-breaker.js';
import { ExchangeHealthMonitor } from '../utils/exchange-health.js';
import Decimal from 'decimal.js';

export class PriceMonitor extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            minSpreadPercent: config.minSpreadPercent || 0.5,
            minVolumeUSD: config.minVolumeUSD || 1000,
            updateIntervalMs: config.updateIntervalMs || 60000,
            priceValidityMs: config.priceValidityMs || 300000,
            maxRetries: config.maxRetries || 3,
            backoffDelay: config.backoffDelay || 5000
        };
        
        this.prices = new Map();
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.priceValidator = new PriceValidator();
        this.circuitBreaker = new CircuitBreaker();
        this.healthMonitor = new ExchangeHealthMonitor();
        this.lastUpdate = new Map();
    }

    async startMonitoring(exchanges) {
        if (this.isMonitoring) {
            logger.warn('Price monitoring already active');
            return;
        }

        this.isMonitoring = true;
        this.exchanges = exchanges;

        logger.info('Starting price monitoring', {
            exchanges: exchanges.map(e => e.name),
            config: this.config
        });

        // Initial monitoring cycle
        await this._monitoringCycle();

        // Set up interval for continuous monitoring
        this.monitoringInterval = setInterval(
            () => this._monitoringCycle().catch(error => 
                logger.error('Error in monitoring cycle:', error)
            ),
            this.config.updateIntervalMs
        );
    }

    async stop() {
        logger.info('Stopping price monitoring');
        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    async _monitoringCycle() {
        try {
            const prices = await this._fetchAllPrices();
            this._updatePrices(prices);
            const opportunities = this._findArbitrageOpportunities();
            
            opportunities.forEach(opp => {
                if (this._validateOpportunity(opp)) {
                    logger.info('Arbitrage opportunity found:', opp);
                    this.emit('opportunity', opp);
                }
            });
        } catch (error) {
            logger.error('Error in monitoring cycle:', error);
            this.emit('monitoringError', error);
        }
    }

    // Rest of the code remains unchanged...
}