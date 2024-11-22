import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { format } from 'date-fns';

export class SystemMonitor extends EventEmitter {
    constructor() {
        super();
        this.screen = blessed.screen();
        this.grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen });
        this.metrics = new Map();
        this.setupDashboard();
    }

    setupDashboard() {
        // Exchange Status
        this.exchangeTable = this.grid.set(0, 0, 4, 6, contrib.table, {
            keys: true,
            fg: 'white',
            selectedFg: 'white',
            selectedBg: 'blue',
            interactive: true,
            label: 'Exchange Status',
            columnSpacing: 2,
            columnWidth: [15, 10, 10, 15]
        });

        // Opportunities Log
        this.opportunityLog = this.grid.set(4, 0, 4, 6, contrib.log, {
            fg: "green",
            selectedFg: "green",
            label: 'Arbitrage Opportunities'
        });

        // Error Log
        this.errorLog = this.grid.set(8, 0, 4, 6, contrib.log, {
            fg: "red",
            selectedFg: "red",
            label: 'Error Log'
        });

        // Profit Chart
        this.profitLine = this.grid.set(0, 6, 6, 6, contrib.line, {
            style: { line: "yellow", text: "green", baseline: "black" },
            xLabelPadding: 3,
            xPadding: 5,
            label: 'Profit History'
        });

        // System Metrics
        this.metricsTable = this.grid.set(6, 6, 6, 6, contrib.table, {
            keys: true,
            fg: 'white',
            selectedFg: 'white',
            selectedBg: 'blue',
            interactive: true,
            label: 'System Metrics',
            columnSpacing: 2,
            columnWidth: [20, 20]
        });

        this.screen.key(['escape', 'q', 'C-c'], () => {
            return process.exit(0);
        });
    }

    updateExchangeStatus(statuses) {
        const data = statuses.map(status => [
            status.name,
            status.state,
            status.operational ? 'Yes' : 'No',
            format(status.timestamp, 'HH:mm:ss')
        ]);

        this.exchangeTable.setData({
            headers: ['Exchange', 'State', 'Operational', 'Last Update'],
            data: data
        });

        this.screen.render();
    }

    logOpportunity(opportunity) {
        const message = `${format(new Date(), 'HH:mm:ss')} - ` +
            `${opportunity.buyExchange} -> ${opportunity.sellExchange} ` +
            `Spread: ${opportunity.spreadPercent.toFixed(2)}% ` +
            `Profit: $${opportunity.profit.amount}`;

        this.opportunityLog.log(message);
        this.screen.render();
    }

    logError(error) {
        const message = `${format(new Date(), 'HH:mm:ss')} - ${error.message}`;
        this.errorLog.log(message);
        this.screen.render();
    }

    updateProfitChart(profits) {
        const data = {
            x: profits.map(p => format(p.timestamp, 'HH:mm')),
            y: profits.map(p => p.amount)
        };

        this.profitLine.setData([{
            x: data.x,
            y: data.y,
            style: { line: 'yellow' }
        }]);

        this.screen.render();
    }

    updateMetrics(metrics) {
        const data = Object.entries(metrics).map(([key, value]) => [
            key,
            typeof value === 'number' ? value.toFixed(2) : value.toString()
        ]);

        this.metricsTable.setData({
            headers: ['Metric', 'Value'],
            data: data
        });

        this.screen.render();
    }

    start() {
        this.screen.render();
    }
}