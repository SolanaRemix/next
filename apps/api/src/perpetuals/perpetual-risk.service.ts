import { Injectable } from '@nestjs/common';
import type {
  PerpetualRiskCheckRequest,
  PerpetualRiskCheckResult,
} from '@next/types';

const MAX_NOTIONAL = 1_000_000;
const MAINTENANCE_MARGIN_RATE = 0.005;
const CLOSE_FEE_BUFFER_RATE = 0.001;
const LIQUIDATION_BUFFER_RATE = MAINTENANCE_MARGIN_RATE + CLOSE_FEE_BUFFER_RATE;

@Injectable()
export class PerpetualRiskService {
  check(request: PerpetualRiskCheckRequest): PerpetualRiskCheckResult {
    const notional = request.entryPrice * request.quantity;
    const initialMargin = notional / request.leverage;
    const requiredMargin = initialMargin + notional * LIQUIDATION_BUFFER_RATE;
    const unrealizedPnlAtMark =
      (request.markPrice - request.entryPrice) *
      request.quantity *
      (request.side === 'long' ? 1 : -1);
    const maintenanceMarginAtMark =
      request.markPrice * request.quantity * MAINTENANCE_MARGIN_RATE;
    const equityAtMark =
      (request.marginMode === 'isolated' ? initialMargin : request.availableMargin) +
      unrealizedPnlAtMark;

    let estimatedLiquidationPrice: number;
    if (request.marginMode === 'isolated') {
      estimatedLiquidationPrice = request.side === 'long'
        ? (request.entryPrice - initialMargin / request.quantity) /
          (1 - LIQUIDATION_BUFFER_RATE)
        : (request.entryPrice + initialMargin / request.quantity) /
          (1 + LIQUIDATION_BUFFER_RATE);
    } else {
      estimatedLiquidationPrice = request.side === 'long'
        ? (request.entryPrice * request.quantity - request.availableMargin) /
          (request.quantity * (1 - LIQUIDATION_BUFFER_RATE))
        : (request.entryPrice * request.quantity + request.availableMargin) /
          (request.quantity * (1 + LIQUIDATION_BUFFER_RATE));
    }
    estimatedLiquidationPrice = Math.max(0, estimatedLiquidationPrice);

    const stopIsValid = request.stopLoss === undefined ||
      (request.side === 'long'
        ? request.stopLoss < request.entryPrice
        : request.stopLoss > request.entryPrice);
    const takeProfitIsValid = request.takeProfit === undefined ||
      (request.side === 'long'
        ? request.takeProfit > request.entryPrice
        : request.takeProfit < request.entryPrice);
    const immediatelyLiquidated = request.side === 'long'
      ? request.markPrice <= estimatedLiquidationPrice
      : request.markPrice >= estimatedLiquidationPrice;

    let reason: string | null = null;
    if (!Number.isFinite(notional) || notional > MAX_NOTIONAL) {
      reason = `Position notional exceeds the ${MAX_NOTIONAL.toLocaleString()} risk limit.`;
    } else if (!stopIsValid) {
      reason = 'Stop-loss must be below entry for a long or above entry for a short.';
    } else if (!takeProfitIsValid) {
      reason = 'Take-profit must be above entry for a long or below entry for a short.';
    } else if (request.availableMargin < requiredMargin) {
      reason = 'Available margin does not cover initial margin and the risk buffer.';
    } else if (immediatelyLiquidated || equityAtMark <= maintenanceMarginAtMark) {
      reason = 'The position would be at or beyond estimated liquidation at the current mark price.';
    }

    return {
      eligible: reason === null,
      reason,
      notional,
      initialMargin,
      requiredMargin,
      estimatedLiquidationPrice,
      unrealizedPnlAtMark,
      maintenanceMarginAtMark,
    };
  }
}
