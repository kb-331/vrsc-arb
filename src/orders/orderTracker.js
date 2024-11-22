import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';

export class OrderTracker extends EventEmitter {
    constructor() {
        super();
        this.activeOrders = new Map();
        this.orderHistory = new Map();
    }

    trackOrder(order) {
        this.activeOrders.set(order.id, {
            ...order,
            tracking: {
                startTime: Date.now(),
                updates: []
            }
        });

        logger.info(`Started tracking order ${order.id}`);
    }

    updateOrder(orderId, update) {
        const order = this.activeOrders.get(orderId);
        if (!order) {
            logger.warn(`Order ${orderId} not found in tracker`);
            return false;
        }

        order.tracking.updates.push({
            ...update,
            timestamp: Date.now()
        });

        if (['filled', 'cancelled'].includes(update.status)) {
            this._moveToHistory(orderId);
        }

        this.emit('orderUpdated', order);
        return true;
    }

    getOrderStatus(orderId) {
        return this.activeOrders.get(orderId) || this.orderHistory.get(orderId);
    }

    getActiveOrders() {
        return Array.from(this.activeOrders.values());
    }

    _moveToHistory(orderId) {
        const order = this.activeOrders.get(orderId);
        if (order) {
            this.orderHistory.set(orderId, {
                ...order,
                tracking: {
                    ...order.tracking,
                    endTime: Date.now()
                }
            });
            this.activeOrders.delete(orderId);
        }
    }

    getOrderHistory(filter = {}) {
        let orders = Array.from(this.orderHistory.values());

        if (filter.exchange) {
            orders = orders.filter(o => o.exchange === filter.exchange);
        }

        if (filter.symbol) {
            orders = orders.filter(o => o.symbol === filter.symbol);
        }

        if (filter.timeRange) {
            orders = orders.filter(o => 
                o.tracking.startTime >= filter.timeRange.start &&
                o.tracking.startTime <= (filter.timeRange.end || Date.now())
            );
        }

        return orders;
    }
}