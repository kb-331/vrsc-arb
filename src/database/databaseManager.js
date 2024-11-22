import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';

export class DatabaseManager {
    constructor(dbPath = 'arbitrage.db') {
        this.dbPath = dbPath;
        this.db = null;
    }

    async connect() {
        try {
            this.db = new Database(this.dbPath, { 
                verbose: logger.debug,
                fileMustExist: false
            });
            
            await this._initializeTables();
            logger.info('Database connected successfully');
            return true;
        } catch (error) {
            logger.error('Database connection error:', error);
            throw error;
        }
    }

    async _initializeTables() {
        const tables = [
            `CREATE TABLE IF NOT EXISTS price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exchange TEXT NOT NULL,
                price REAL NOT NULL,
                volume REAL,
                timestamp INTEGER NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,
            `CREATE TABLE IF NOT EXISTS opportunities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                buy_exchange TEXT NOT NULL,
                sell_exchange TEXT NOT NULL,
                buy_price REAL NOT NULL,
                sell_price REAL NOT NULL,
                potential_profit REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                executed BOOLEAN DEFAULT FALSE,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`,
            `CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                opportunity_id INTEGER,
                type TEXT NOT NULL,
                exchange TEXT NOT NULL,
                price REAL NOT NULL,
                amount REAL NOT NULL,
                fee REAL NOT NULL,
                timestamp INTEGER NOT NULL,
                status TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
            )`,
            `CREATE TABLE IF NOT EXISTS exchange_status (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exchange TEXT NOT NULL,
                status TEXT NOT NULL,
                last_check INTEGER NOT NULL,
                error TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )`
        ];

        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_price_history_exchange ON price_history(exchange)',
            'CREATE INDEX IF NOT EXISTS idx_price_history_timestamp ON price_history(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_opportunities_timestamp ON opportunities(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_exchange_status_last_check ON exchange_status(last_check)'
        ];

        try {
            this.db.transaction(() => {
                tables.forEach(table => this.db.prepare(table).run());
                indexes.forEach(index => this.db.prepare(index).run());
            })();
        } catch (error) {
            logger.error('Error initializing database tables:', error);
            throw error;
        }
    }

    async recordPrice(exchange, price, volume) {
        const stmt = this.db.prepare(`
            INSERT INTO price_history (exchange, price, volume, timestamp)
            VALUES (?, ?, ?, ?)
        `);

        try {
            stmt.run(exchange, price, volume, Date.now());
        } catch (error) {
            logger.error('Error recording price:', error);
            throw error;
        }
    }

    async recordOpportunity(opportunity) {
        const stmt = this.db.prepare(`
            INSERT INTO opportunities 
            (buy_exchange, sell_exchange, buy_price, sell_price, potential_profit, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        try {
            stmt.run(
                opportunity.buyExchange,
                opportunity.sellExchange,
                opportunity.buyPrice,
                opportunity.sellPrice,
                opportunity.potentialProfit,
                Date.now()
            );
        } catch (error) {
            logger.error('Error recording opportunity:', error);
            throw error;
        }
    }

    async getRecentPrices(exchange, minutes = 60) {
        const stmt = this.db.prepare(`
            SELECT * FROM price_history 
            WHERE exchange = ? 
            AND timestamp > ? 
            ORDER BY timestamp DESC
        `);

        try {
            const cutoff = Date.now() - (minutes * 60 * 1000);
            return stmt.all(exchange, cutoff);
        } catch (error) {
            logger.error('Error fetching recent prices:', error);
            throw error;
        }
    }

    async close() {
        if (this.db) {
            try {
                this.db.close();
                logger.info('Database connection closed');
            } catch (error) {
                logger.error('Error closing database:', error);
                throw error;
            }
        }
    }

    async cleanup() {
        const retentionPeriod = 7 * 24 * 60 * 60 * 1000; // 7 days
        const cutoff = Date.now() - retentionPeriod;

        const cleanupQueries = [
            `DELETE FROM price_history WHERE timestamp < ?`,
            `DELETE FROM opportunities WHERE timestamp < ?`,
            `DELETE FROM trades WHERE timestamp < ?`,
            `DELETE FROM exchange_status WHERE last_check < ?`
        ];

        try {
            this.db.transaction(() => {
                cleanupQueries.forEach(query => {
                    this.db.prepare(query).run(cutoff);
                });
            })();
            
            this.db.prepare('VACUUM').run();
            logger.info('Database cleanup completed');
        } catch (error) {
            logger.error('Error during database cleanup:', error);
            throw error;
        }
    }
}