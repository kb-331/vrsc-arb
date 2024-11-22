import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettlementManager } from '../trading/settlementManager.js';
import Decimal from 'decimal.js';

describe('SettlementManager', () => {
    let settlementManager;
    let mockBalanceManager;
    let mockOrderManager;

    beforeEach(() => {
        mockBalanceManager = {
            getBalance: vi.fn().mockResolvedValue(new Decimal(1000))
        };

        mockOrderManager = {
            getOrder: vi.fn().mockResolvedValue({
                status: 'filled',
                totalCost: '1000'
            }),
            cancelOrder: vi.fn().mockResolvedValue(true)
        };

        settlementManager = new SettlementManager(
            mockBalanceManager,
            mockOrderManager
        );
    });

    it('should successfully settle arbitrage', async () => {
        const buyOrder = {
            id: '1',
            exchange: 'safetrade',
            totalCost: '1000'
        };

        const sellOrder = {
            id: '2',
            exchange: 'tradeogre',
            totalCost: '1010'
        };

        const result = await settlementManager.settleArbitrage(
            buyOrder,
            sellOrder
        );

        expect(result.success).toBe(true);
        expect(result.profit).toBeTruthy();
    });

    it('should handle failed buy confirmation', async () => {
        mockOrderManager.getOrder.mockResolvedValueOnce({
            status: 'cancelled'
        });

        const result = await settlementManager.settleArbitrage(
            { id: '1', exchange: 'safetrade' },
            { id: '2', exchange: 'tradeogre' }
        );

        expect(result.success).toBe(false);
        expect(mockOrderManager.cancelOrder).toHaveBeenCalled();
    });

    it('should verify balances correctly', async () => {
        let balanceChecks = 0;
        mockBalanceManager.getBalance.mockImplementation(() => {
            balanceChecks++;
            return Promise.resolve(new Decimal(1000));
        });

        await settlementManager.settleArbitrage(
            { id: '1', exchange: 'safetrade', totalCost: '1000' },
            { id: '2', exchange: 'tradeogre', totalCost: '1010' }
        );

        expect(balanceChecks).toBeGreaterThanOrEqual(6); // 3 confirmations × 2 exchanges
    });

    it('should calculate profit correctly', async () => {
        const result = await settlementManager.settleArbitrage(
            { id: '1', exchange: 'safetrade', totalCost: '1000' },
            { id: '2', exchange: 'tradeogre', totalCost: '1010' }
        );

        expect(result.profit.amount).toBe('10');
        expect(result.profit.percent).toBe('1');
    });
});