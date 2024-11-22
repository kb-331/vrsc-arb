export const systemSchema = {
    type: 'object',
    required: ['health', 'performance', 'logging'],
    properties: {
        health: {
            type: 'object',
            required: ['checkInterval', 'thresholds'],
            properties: {
                checkInterval: { type: 'number', minimum: 1000 },
                thresholds: {
                    type: 'object',
                    required: ['cpu', 'memory', 'disk'],
                    properties: {
                        cpu: { type: 'number', minimum: 0, maximum: 100 },
                        memory: { type: 'number', minimum: 0, maximum: 100 },
                        disk: { type: 'number', minimum: 0, maximum: 100 }
                    }
                }
            }
        },
        performance: {
            type: 'object',
            required: ['metrics'],
            properties: {
                metrics: {
                    type: 'object',
                    properties: {
                        retentionPeriod: { type: 'number', minimum: 0 },
                        aggregationInterval: { type: 'number', minimum: 1000 }
                    }
                }
            }
        },
        logging: {
            type: 'object',
            required: ['level', 'outputs'],
            properties: {
                level: { 
                    type: 'string', 
                    enum: ['error', 'warn', 'info', 'debug']
                },
                outputs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['type'],
                        properties: {
                            type: {
                                type: 'string',
                                enum: ['console', 'file']
                            },
                            filename: { type: 'string' }
                        }
                    }
                }
            }
        }
    }
};