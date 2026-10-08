import { PerpetualRiskService } from './perpetual-risk.service.js';

describe('PerpetualRiskService', () => {
  const service = new PerpetualRiskService();
  const validRequest = {
    side: 'long' as const,
    marginMode: 'isolated' as const,
    entryPrice: 100,
    markPrice: 100,
    quantity: 1,
    leverage: 5,
    availableMargin: 25,
  };

  it('calculates margin, liquidation estimate, and mark-to-market PnL', () => {
    const result = service.check({ ...validRequest, markPrice: 105 });

    expect(result.initialMargin).toBe(20);
    expect(result.requiredMargin).toBe(20.6);
    expect(result.unrealizedPnlAtMark).toBe(5);
    expect(result.estimatedLiquidationPrice).toBeCloseTo(80.48);
    expect(result.eligible).toBe(true);
  });

  it('rejects a position that would already be liquidated at the mark', () => {
    const result = service.check({ ...validRequest, markPrice: 80 });

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/liquidation/i);
  });

  it('rejects insufficient margin and invalid long stop-loss values', () => {
    expect(service.check({ ...validRequest, availableMargin: 20 }).reason).toMatch(/margin/i);
    expect(service.check({ ...validRequest, stopLoss: 101 }).reason).toMatch(/stop-loss/i);
  });

  it('applies short-side price direction and take-profit validation', () => {
    const short = service.check({
      ...validRequest,
      side: 'short',
      markPrice: 95,
      takeProfit: 90,
      stopLoss: 110,
    });

    expect(short.eligible).toBe(true);
    expect(short.unrealizedPnlAtMark).toBe(5);
    expect(short.estimatedLiquidationPrice).toBeGreaterThan(100);
  });

  it('enforces the position notional cap', () => {
    const result = service.check({
      ...validRequest,
      entryPrice: 100_001,
      quantity: 10,
      availableMargin: 1_000_000,
    });

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/notional/i);
  });
});
