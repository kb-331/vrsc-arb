import { describe, it, expect, beforeEach } from 'vitest';
import { PositionManager } from '../trading/positionManager.js';
import Decimal from 'decimal.js';

describe('PositionManager', () => {
    let positionManager;

    beforeEach(() => {
        positionManager = new PositionManager({
            maxPositionSize: 1000,
            maxTotalExposure: 5000,
            maxPositionsPerExchange: 3
        });
    });

    it('should open a valid position', async () => {
        const position = await positionManager.openPosition({
            exchange: 'safetrade',
            side: 'buy',
            amount: '100',
            price: '5'
        });

        expect(position).toBeTruthy();
        expect(position.status).toBe('open');
        expect(position.amount).toBe('100');
        expect(position.entryPrice).toBe('5');
    });

    it('should reject position exceeding size limit', async () => {
        const position = await positionManager.openPosition({
            exchange: 'safetrade',
            side: 'buy',
            amount: '1000',
            price: '5'
        });

        expect(position).toBeNull();
    });

    it('should calculate PnL correctly', async () => {
        const position = await positionManager.openPosition({
            exchange: 'safetrade',
            side: 'buy',
            amount: '100',
            price: '5'
        });

        await positionManager.updatePosition(position.id, {
            currentPrice: '6'
        });

        const updatedPosition = positionManager.getPosition(position.id);
        expect(new Decimal(updatedPosition.unrealizedPnL)).toEqual(new Decimal('100'));
    });

    it('should handle take profit targets', async () => {
        const position = await positionManager.openPosition({
            exchange: 'safetrade',
            side: 'buy',
            amount: '100',
            price: '5'
        });

        let targetHit = false;
        positionManager.on('takeProfitHit', () => {
            targetHit = true;
        });

        await positionManager.updatePosition(position.id, {
            currentPrice: '5.1'
        });

        expect(targetHit).toBe(true);
    });

    it('should handle stop loss', async () => {
        const position = await positionManager.openPosition({
            exchange: 'safetrade',
            side: 'buy',
            amount: '100',
            price: '5'
        });

        let stopLossTriggered = false;
        positionManager.on('stopLossTriggered', () => {
            stopLossTriggered = true;
        });

        await positionManager.updatePosition(position.id, {
            currentPrice: '4.97'
        });

        expect(stopLossTriggered).toBe(true);
    });
});