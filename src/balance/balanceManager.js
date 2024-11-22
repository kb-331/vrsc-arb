import { EventEmitter } from 'events';
import Decimal from 'decimal.js';
import { logger } from '../utils/logger.js';

export class BalanceManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.balances = new Map();
        this.reservedBalances = new Map();
        this.minimumBalances = {
            VRSC: config.minVRSC || '1',      // Minimum 1 VRSC
            USDT: config.minUSDT || '10',     // Minimum $10 USDT
            ETH: config.minETH || '0.01'      // Minimum 0.01 ETH for gas
        };
        this.reserveTimeoutMs = config.reserveTimeoutMs || 30000; // 30 second reserve timeout
    }

    async updateBalance(exchange, currency, amount) {
        try {
            const key = this._getKey(exchange, currency);
            const newBalance = new Decimal(amount);

            if (newBalance.lessThan(0)) {
                throw new Error(`Invalid balance amount for ${currency} on ${exchange}`);
            }

            this.balances.set(key, newBalance.toString());
            
            this.emit('balanceUpdated', { 
                exchange, 
                currency, 
                amount: newBalance.toString(),
                available: this.getAvailableBalance(exchange, currency).toString()
            });
            
            logger.info(`Balance updated for ${exchange} ${currency}:`, {
                total: newBalance.toString(),
                available: this.getAvailableBalance(exchange, currency).toString()
            });

            return true;
        } catch (error) {
            logger.error(`Error updating balance: ${error.message}`);
            return false;
        }
    }

    async reserveBalance(exchange, currency, amount, orderId) {
        try {
            const key = this._getKey(exchange, currency);
            const reserveKey = `${key}_${orderId}`;
            const reserveAmount = new Decimal(amount);

            // Check if we have sufficient available balance
            const available = this.getAvailableBalance(exchange, currency);
            if (available.lessThan(reserveAmount)) {
                throw new Error(`Insufficient available balance for ${currency} on ${exchange}`);
            }

            // Add to reserved balances
            this.reservedBalances.set(reserveKey, {
                amount: reserveAmount.toString(),
                timestamp: Date.now()
            });
            
            // Set timeout to automatically release after timeout period
            this._setReserveTimeout(exchange, currency, orderId);

            this.emit('balanceReserved', {
                exchange,
                currency,
                amount: reserveAmount.toString(),
                orderId,
                remainingAvailable: this.getAvailableBalance(exchange, currency).toString()
            });

            return true;
        } catch (error) {
            logger.error(`Error reserving balance: ${error.message}`);
            return false;
        }
    }

    async releaseBalance(exchange, currency, orderId) {
        try {
            const key = this._getKey(exchange, currency);
            const reserveKey = `${key}_${orderId}`;

            if (!this.reservedBalances.has(reserveKey)) {
                throw new Error(`No reserved balance found for order ${orderId}`);
            }

            const { amount } = this.reservedBalances.get(reserveKey);
            this.reservedBalances.delete(reserveKey);

            this.emit('balanceReleased', {
                exchange,
                currency,
                amount,
                orderId,
                availableAfterRelease: this.getAvailableBalance(exchange, currency).toString()
            });

            return true;
        } catch (error) {
            logger.error(`Error releasing balance: ${error.message}`);
            return false;
        }
    }

    getBalance(exchange, currency) {
        const key = this._getKey(exchange, currency);
        return new Decimal(this.balances.get(key) || '0');
    }

    getAvailableBalance(exchange, currency) {
        const totalBalance = this.getBalance(exchange, currency);
        const reserved = this.getReservedBalance(exchange, currency);
        return Decimal.max(totalBalance.minus(reserved), 0);
    }

    getReservedBalance(exchange, currency) {
        const key = this._getKey(exchange, currency);
        let total = new Decimal(0);

        for (const [reserveKey, { amount }] of this.reservedBalances) {
            if (reserveKey.startsWith(key)) {
                total = total.plus(amount);
            }
        }

        return total;
    }

    hasMinimumBalance(exchange, currency) {
        const available = this.getAvailableBalance(exchange, currency);
        const minimum = new Decimal(this.minimumBalances[currency] || '0');
        return available.greaterThanOrEqualTo(minimum);
    }

    getAllBalances() {
        const result = {};
        
        for (const [key, amount] of this.balances) {
            const [exchange, currency] = key.split('_');
            
            if (!result[exchange]) {
                result[exchange] = {};
            }
            
            result[exchange][currency] = {
                total: amount,
                available: this.getAvailableBalance(exchange, currency).toString(),
                reserved: this.getReservedBalance(exchange, currency).toString(),
                minimum: this.minimumBalances[currency] || '0'
            };
        }
        
        return result;
    }

    getReservedBalances(exchange = null) {
        const reserves = [];
        
        for (const [key, { amount, timestamp }] of this.reservedBalances) {
            const [reserveExchange, currency, orderId] = key.split('_');
            
            if (!exchange || reserveExchange === exchange) {
                reserves.push({
                    exchange: reserveExchange,
                    currency,
                    orderId,
                    amount,
                    timestamp,
                    age: Date.now() - timestamp
                });
            }
        }
        
        return reserves;
    }

    _getKey(exchange, currency) {
        return `${exchange.toLowerCase()}_${currency.toUpperCase()}`;
    }

    _setReserveTimeout(exchange, currency, orderId) {
        setTimeout(() => {
            const key = this._getKey(exchange, currency);
            const reserveKey = `${key}_${orderId}`;
            
            if (this.reservedBalances.has(reserveKey)) {
                const { amount } = this.reservedBalances.get(reserveKey);
                this.reservedBalances.delete(reserveKey);
                
                logger.warn(`Reserve timeout for ${exchange} ${currency} order ${orderId}`, {
                    amount,
                    duration: this.reserveTimeoutMs
                });
                
                this.emit('reserveTimeout', {
                    exchange,
                    currency,
                    orderId,
                    amount
                });
            }
        }, this.reserveTimeoutMs);
    }
}