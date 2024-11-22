export const exchangeSchema = {
    type: 'object',
    required: ['exchanges'],
    properties: {
        exchanges: {
            type: 'object',
            patternProperties: {
                "^[a-zA-Z0-9_-]+$": {
                    type: 'object',
                    required: ['apiUrl', 'wsUrl', 'rateLimit'],
                    properties: {
                        apiUrl: { type: 'string', format: 'uri' },
                        wsUrl: { type: 'string', format: 'uri' },
                        rateLimit: { type: 'number', minimum: 0 },
                        timeout: { type: 'number', minimum: 0 },
                        retryAttempts: { type: 'number', minimum: 0 },
                        credentials: {
                            type: 'object',
                            properties: {
                                apiKey: { type: 'string' },
                                apiSecret: { type: 'string' }
                            }
                        }
                    }
                }
            },
            additionalProperties: false
        }
    }
};