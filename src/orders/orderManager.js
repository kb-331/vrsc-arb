import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class OrderManager extends EventEmitter {
    constructor(config = {}) {
        super();
        this.orders = new Map();
        this.config = {
            maxOrderSize: config.maxOrderSize || 1000,    // $1000 max order
            minOrderSize: config.minOrderSize || 10,      // $10 min order
            orderTimeout: config.orderTimeout || 30000,   // 30 second timeout
            maxRetries: config.maxRetries || 3
        };
    }

    async createOrder(params) {
        try {
            const { exchange, symbol, side, amount, price } = params;
            
            // Validate order parameters
            const validation = this._validateOrderParams(params);
            if (!validation.isValid) {
                logger.warn(`Order validation failed: ${validation.reason}`);
                return null;
            }

            const order = {
                id: this._generateOrderId(),
                exchange,
                symbol,
                side,
                amount: new Decimal(amount).toString(),
                price: new Decimal(price).toString(),
                status: 'pending',
                timestamp: Date.now(),
                fills: []
            };

            this.orders.set(order.id, order);
            this._setOrderTimeout(order.id);
            this.emit('orderCreated', order);

            return order;
        } catch (error) {
            logger.error('Error creating order:', error);
            return null;
        }
    }

    async updateOrderStatus(orderId, status, fillDetails = null) {
        const order = this.orders.get(orderId);
        if (!order) {
            logger.warn(`Order ${orderId} not found`);
            return false;
        }

        order.status = status;
        order.lastUpdated = Date.now();

        if (fillDetails) {
            order.fills.push({
                ...fillDetails,
                timestamp: Date.now()
            });
        }

        this.emit('orderUpdated', order);
        return true;
    }

    async cancelOrder(orderId) {
        const order = this.orders.get(orderId);
        if (!order) {
            logger.warn(`Order ${orderId} not found`);
            return false;
        }

        order.status = 'cancelled';
        order.lastUpdated = Date.now();
        this.emit('orderCancelled', order);
        return true;
    }

    getOrder(orderId) {
        return this.orders.get(orderId);
    }

    getActiveOrders() {
        return Array.from(this.orders.values())
            .filter(order => ['pending', 'partial'].includes(order.status));
    }

    _validateOrderParams(params) {
        const { amount, price } = params;
        
        try {
            const orderValue = new Decimal(amount).mul(price);

            if (orderValue.lessThan(this.config.minOrderSize)) {
                return { isValid: false, reason: 'Order size too small' };
            }

            if (orderValue.greaterThan(this.config.maxOrderSize)) {
                return { isValid: false, reason: 'Order size too large' };
            }

            return { isValid: true };
        } catch (error) {
            return { isValid: false, reason: 'Invalid numeric values' };
        }
    }

    _generateOrderId() {
        return `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    _setOrderTimeout(orderId) {
        setTimeout(() => {
            const order = this.orders.get(orderId);
            if (order && order.status === 'pending') {
                this.cancelOrder(orderId);
                this.emit('orderTimeout', order);
            }
        }, this.config.orderTimeout);
    }
}