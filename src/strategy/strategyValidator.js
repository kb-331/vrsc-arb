import { logger } from '../utils/logger.js';
import Decimal from 'decimal.js';

export class StrategyValidator {
    constructor(config = {}) {
        this.config = {
            maxConditions: config.maxConditions || 10,
            maxActions: config.maxActions || 5,
            validTimeframes: config.validTimeframes || ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
            validIndicators: config.validIndicators || ['RSI', 'MACD', 'BB', 'EMA', 'SMA'],
            ...config
        };
    }

    validateStrategy(strategy) {
        try {
            const checks = [
                this._validateBasicFields(strategy),
                this._validateConditions(strategy.conditions),
                this._validateActions(strategy.actions),
                this._validateRiskParams(strategy.risk)
            ];

            const failures = checks.filter(check => !check.isValid);
            
            return {
                isValid: failures.length === 0,
                errors: failures.map(f => f.reason)
            };
        } catch (error) {
            logger.error('Strategy validation error:', error);
            return {
                isValid: false,
                errors: [error.message]
            };
        }
    }

    _validateBasicFields(strategy) {
        const requiredFields = ['id', 'name', 'exchange', 'symbol', 'timeframe'];
        const missingFields = requiredFields.filter(field => !strategy[field]);

        if (missingFields.length > 0) {
            return {
                isValid: false,
                reason: `Missing required fields: ${missingFields.join(', ')}`
            };
        }

        if (!this.config.validTimeframes.includes(strategy.timeframe)) {
            return {
                isValid: false,
                reason: `Invalid timeframe: ${strategy.timeframe}`
            };
        }

        return { isValid: true };
    }

    _validateConditions(conditions) {
        if (!Array.isArray(conditions) || conditions.length === 0) {
            return {
                isValid: false,
                reason: 'Strategy must have at least one condition'
            };
        }

        if (conditions.length > this.config.maxConditions) {
            return {
                isValid: false,
                reason: `Too many conditions (max: ${this.config.maxConditions})`
            };
        }

        for (const condition of conditions) {
            const validationResult = this._validateCondition(condition);
            if (!validationResult.isValid) {
                return validationResult;
            }
        }

        return { isValid: true };
    }

    _validateCondition(condition) {
        const requiredFields = ['type', 'indicator', 'operator', 'value'];
        const missingFields = requiredFields.filter(field => !condition[field]);

        if (missingFields.length > 0) {
            return {
                isValid: false,
                reason: `Invalid condition: missing ${missingFields.join(', ')}`
            };
        }

        if (!this.config.validIndicators.includes(condition.indicator)) {
            return {
                isValid: false,
                reason: `Invalid indicator: ${condition.indicator}`
            };
        }

        if (!this._isValidOperator(condition.operator)) {
            return {
                isValid: false,
                reason: `Invalid operator: ${condition.operator}`
            };
        }

        return { isValid: true };
    }

    _validateActions(actions) {
        if (!Array.isArray(actions) || actions.length === 0) {
            return {
                isValid: false,
                reason: 'Strategy must have at least one action'
            };
        }

        if (actions.length > this.config.maxActions) {
            return {
                isValid: false,
                reason: `Too many actions (max: ${this.config.maxActions})`
            };
        }

        for (const action of actions) {
            const validationResult = this._validateAction(action);
            if (!validationResult.isValid) {
                return validationResult;
            }
        }

        return { isValid: true };
    }

    _validateAction(action) {
        const requiredFields = ['type', 'side', 'amount'];
        const missingFields = requiredFields.filter(field => !action[field]);

        if (missingFields.length > 0) {
            return {
                isValid: false,
                reason: `Invalid action: missing ${missingFields.join(', ')}`
            };
        }

        if (!['market', 'limit'].includes(action.type)) {
            return {
                isValid: false,
                reason: `Invalid order type: ${action.type}`
            };
        }

        if (!['buy', 'sell'].includes(action.side)) {
            return {
                isValid: false,
                reason: `Invalid order side: ${action.side}`
            };
        }

        try {
            const amount = new Decimal(action.amount);
            if (amount.isNegative() || amount.isZero()) {
                return {
                    isValid: false,
                    reason: 'Invalid order amount'
                };
            }
        } catch {
            return {
                isValid: false,
                reason: 'Invalid numeric value for amount'
            };
        }

        return { isValid: true };
    }

    _validateRiskParams(risk) {
        if (!risk) {
            return {
                isValid: false,
                reason: 'Missing risk parameters'
            };
        }

        const requiredParams = ['stopLoss', 'takeProfit', 'maxPositionSize'];
        const missingParams = requiredParams.filter(param => !risk[param]);

        if (missingParams.length > 0) {
            return {
                isValid: false,
                reason: `Missing risk parameters: ${missingParams.join(', ')}`
            };
        }

        try {
            const stopLoss = new Decimal(risk.stopLoss);
            const takeProfit = new Decimal(risk.takeProfit);
            const maxPositionSize = new Decimal(risk.maxPositionSize);

            if (stopLoss.isNegative() || takeProfit.isNegative() || maxPositionSize.isNegative()) {
                return {
                    isValid: false,
                    reason: 'Risk parameters cannot be negative'
                };
            }
        } catch {
            return {
                isValid: false,
                reason: 'Invalid numeric values in risk parameters'
            };
        }

        return { isValid: true };
    }

    _isValidOperator(operator) {
        const validOperators = ['>', '<', '>=', '<=', '==', '!=', 'crosses_above', 'crosses_below'];
        return validOperators.includes(operator);
    }
}</content>