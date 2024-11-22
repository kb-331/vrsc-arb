import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import yaml from 'js-yaml';
import Ajv from 'ajv';
import deepmerge from 'deepmerge';

export class ConfigManager extends EventEmitter {
    constructor() {
        super();
        this.config = new Map();
        this.schema = new Map();
        this.validator = new Ajv({ allErrors: true });
        this.configPath = process.env.CONFIG_PATH || 'config';
        this.environment = process.env.NODE_ENV || 'development';
    }

    async loadConfig(name) {
        try {
            const configs = await Promise.all([
                this._loadConfigFile(name, 'default'),
                this._loadConfigFile(name, this.environment)
            ]);

            const mergedConfig = deepmerge.all(configs.filter(Boolean));
            
            if (this.schema.has(name)) {
                const isValid = this._validateConfig(name, mergedConfig);
                if (!isValid) {
                    throw new Error(`Invalid configuration for ${name}`);
                }
            }

            this.config.set(name, mergedConfig);
            this.emit('configLoaded', { name, config: mergedConfig });
            
            return mergedConfig;
        } catch (error) {
            logger.error(`Error loading config ${name}:`, error);
            throw error;
        }
    }

    async _loadConfigFile(name, env) {
        try {
            const filePath = join(process.cwd(), this.configPath, `${name}.${env}.yml`);
            const content = await readFile(filePath, 'utf8');
            return yaml.load(content);
        } catch (error) {
            if (env === 'default') {
                throw error;
            }
            logger.warn(`Config file not found for ${name} in ${env} environment`);
            return null;
        }
    }

    registerSchema(name, schema) {
        this.schema.set(name, schema);
        this.validator.addSchema(schema, name);
    }

    _validateConfig(name, config) {
        const schema = this.schema.get(name);
        if (!schema) return true;

        const validate = this.validator.compile(schema);
        const isValid = validate(config);

        if (!isValid) {
            logger.error('Config validation errors:', validate.errors);
        }

        return isValid;
    }

    getConfig(name) {
        return this.config.get(name);
    }

    updateConfig(name, updates, options = {}) {
        const currentConfig = this.config.get(name);
        if (!currentConfig) {
            throw new Error(`Configuration ${name} not found`);
        }

        const newConfig = deepmerge(currentConfig, updates, {
            arrayMerge: options.arrayMerge || ((_, source) => source)
        });

        if (this.schema.has(name)) {
            const isValid = this._validateConfig(name, newConfig);
            if (!isValid) {
                throw new Error(`Invalid configuration update for ${name}`);
            }
        }

        this.config.set(name, newConfig);
        this.emit('configUpdated', { name, config: newConfig });
        
        return newConfig;
    }

    watchConfig(name, callback) {
        this.on('configUpdated', (event) => {
            if (event.name === name) {
                callback(event.config);
            }
        });
    }

    getAllConfigs() {
        return Object.fromEntries(this.config);
    }
}