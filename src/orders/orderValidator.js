import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class OrderValidator {
    constructor(config = {}) {
        this.config = {
            minAmount: config.minAmount || '0.0001',
            maxAmount: config.maxAmount || '1000000',
            minPrice: config.minPrice || '0.00000001',
            maxPrice: config.maxPrice || '1000000',
            ...config
        };
    }

    validateOrder(order) {
        try {
            const checks = [
                this._validateBasicFields(order),
                this._validateNumericValues(order),
                this._validateOrderSize(order)
            ];

            const failures = checks.filter(check => !check.isValid);
            
            return {
                isValid: failures.length === 0,
                errors: failures.map(f => f.reason)
            };
        } catch (error) {
            logger.error('Order validation error:', error);
            return {
                isValid: false,
                errors: [error.message]
            };
        }
    }

    _validateBasicFields(order) {
        const requiredFields = ['exchange', 'symbol', 'side', 'amount', 'price'];
        const missingFields = requiredFields.filter(field => !order[field]);

        if (missingFields.length > 0) {
            return {
                isValid: false,
                reason: `Missing required fields: ${missingFields.join(', ')}`
            };
        }

        if (!['buy', 'sell'].includes(order.side)) {
            return {
                isValid: false,
                reason: 'Invalid order side'
            };
        }

        return { isValid: true };
    }

    _validateNumericValues(order) {
        try {
            const amount = new Decimal(order.amount);
            const price = new Decimal(order.price);

            if (amount.lessThan(this.config.minAmount) || 
                amount.greaterThan(this.config.maxAmount)) {
                return {
                    isValid: false,
                    reason: 'Amount out of valid range'
                };
            }

            if (price.lessThan(this.config.minPrice) || 
                price.greaterThan(this.config.maxPrice)) {
                return {
                    isValid: false,
                    reason: 'Price out of valid range'
                };
            }

            return { isValid: true };
        } catch (error) {
            return {
                isValid: false,
                reason: 'Invalid numeric values'
            };
        }
    }

    _validateOrderSize(order) {
        try {
            const amount = new Decimal(order.amount);
            const price = new Decimal(order.price);
            const orderValue = amount.mul(price);

            // Additional size-based validations can be added here

            return { isValid: true };
        } catch (error) {
            return {
                isValid: false,
                reason: 'Error calculating order size'
            };
        }
    }
}