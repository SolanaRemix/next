import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { MarginMode, PerpetualSide } from '@next/types';

export class RiskCheckDto {
  @IsIn(['long', 'short'])
  side!: PerpetualSide;

  @IsIn(['isolated', 'cross'])
  marginMode!: MarginMode;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0.00000001)
  @Max(1_000_000_000_000)
  entryPrice!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0.00000001)
  @Max(1_000_000_000_000)
  markPrice!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0.00000001)
  @Max(1_000_000_000)
  quantity!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsInt()
  @Min(1)
  @Max(100)
  leverage!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1_000_000_000_000)
  availableMargin!: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0.00000001)
  @Max(1_000_000_000_000)
  takeProfit?: number;

  @IsOptional()
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0.00000001)
  @Max(1_000_000_000_000)
  stopLoss?: number;
}
