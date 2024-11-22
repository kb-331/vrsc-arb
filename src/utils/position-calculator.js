import { logger } from './logger.js';
import Decimal from 'decimal.js';

export class PositionCalculator {
    constructor(config = {}) {
        this.config = {
            maxPositionSize: config.maxPositionSize || 1000, // $1000 max position
            minPositionSize: config.minPositionSize || 10,   // $10 min position
            maxSlippage: config.maxSlippage || 0.003,       // 0.3% max slippage
            volumeImpact: config.volumeImpact || 0.1,       // 10% max volume impact
            ...config
        };
    }

    calculateOptimalPosition(opportunity, marketData) {
        try {
            const { buyExchange, sellExchange, buyPrice, sellPrice } = opportunity;
            const spread = new Decimal(sellPrice).minus(buyPrice).div(buyPrice);
            
            // Calculate base position size from spread
            let position = this._calculateBasePosition(spread);
            
            // Adjust for liquidity
            position = this._adjustForLiquidity(position, marketData);
            
            // Adjust for volatility
            position = this._adjustForVolatility(position, marketData.volatility);
            
            // Final validation
            return this._validatePosition(position, opportunity);
        } catch (error) {
            logger.error('Error calculating position:', error);
            return null;
        }
    }

    _calculateBasePosition(spread) {
        const spreadBps = spread.mul(10000);
        let position;

        if (spreadBps.lt(10)) { // < 0.1%
            return new Decimal(0);
        } else if (spreadBps.lt(20)) { // 0.1% - 0.2%
            position = this.config.minPositionSize;
        } else if (spreadBps.lt(50)) { // 0.2% - 0.5%
            position = this.config.minPositionSize * 2;
        } else {
            position = this.config.minPositionSize * 3;
        }

        return new Decimal(Math.min(position, this.config.maxPositionSize));
    }

    _adjustForLiquidity(position, marketData) {
        const { buyVolume, sellVolume } = marketData;
        const minVolume = Decimal.min(buyVolume, sellVolume);
        const maxPosition = minVolume.mul(this.config.volumeImpact);
        
        return Decimal.min(position, maxPosition);
    }

    _adjustForVolatility(position, volatility) {
        if (!volatility) return position;
        
        const volatilityFactor = new Decimal(1).minus(
            Decimal.min(new Decimal(volatility).div(100), new Decimal(0.5))
        );
        
        return position.mul(volatilityFactor);
    }

    _validatePosition(position, opportunity) {
        if (position.lessThan(this.config.minPositionSize)) {
            logger.debug('Position size below minimum');
            return null;
        }

        if (position.greaterThan(this.config.maxPositionSize)) {
            position = new Decimal(this.config.maxPositionSize);
        }

        return {
            usdAmount: position.toFixed(2),
            coinAmount: position.div(opportunity.buyPrice).toFixed(8),
            maxSlippage: this.config.maxSlippage
        };
    }
}