import { logger } from './logger.js';
import fetch from 'cross-fetch';

export async function fetchWithRetry(url, options = {}) {
    const retryConfig = {
        attempts: options.retries || 3,
        baseDelay: options.baseDelay || 1000,
        maxDelay: options.maxDelay || 10000,
        timeout: options.timeout || 30000
    };

    let lastError;

    for (let attempt = 1; attempt <= retryConfig.attempts; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), retryConfig.timeout);

            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                return await response.json();
            } finally {
                clearTimeout(timeout);
            }
        } catch (error) {
            lastError = error;
            logger.warn(`Fetch attempt ${attempt}/${retryConfig.attempts} failed:`, error);

            if (attempt < retryConfig.attempts) {
                const delay = Math.min(
                    retryConfig.baseDelay * Math.pow(2, attempt - 1),
                    retryConfig.maxDelay
                );
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}