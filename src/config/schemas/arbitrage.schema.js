export const arbitrageSchema = {
    type: 'object',
    required: ['monitoring', 'trading', 'risk'],
    properties: {
        monitoring: {
            type: 'object',
            required: ['minSpreadPercent', 'minVolumeUSD', 'updateInterval'],
            properties: {
                minSpreadPercent: { type: 'number', minimum: 0 },
                minVolumeUSD: { type: 'number', minimum: 0 },
                updateInterval: { type: 'number', minimum: 1000 },
                priceValidityMs: { type: 'number', minimum: 1000 }
            }
        },
        trading: {
            type: 'object',
            required: ['maxOrderSize', 'minOrderSize', 'orderTimeout'],
            properties: {
                maxOrderSize: { type: 'number', minimum: 0 },
                minOrderSize: { type: 'number', minimum: 0 },
                orderTimeout: { type: 'number', minimum: 1000 },
                maxRetries: { type: 'number', minimum: 0 }
            }
        },
        risk: {
            type: 'object',
            required: ['maxPositionSize', 'maxDrawdown', 'maxSlippage'],
            properties: {
                maxPositionSize: { type: 'number', minimum: 0 },
                maxDrawdown: { type: 'number', minimum: 0, maximum: 1 },
                maxSlippage: { type: 'number', minimum: 0, maximum: 1 },
                minLiquidity: { type: 'number', minimum: 0 }
            }
        }
    }
};