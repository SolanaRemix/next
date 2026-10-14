import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsString, Length } from 'class-validator';

export const evmQuoteProviders = ['0x', '1inch', 'paraswap'] as const;

export class UpdateAggregatorControlDto {
  @IsArray()
  @ArrayMaxSize(evmQuoteProviders.length)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(evmQuoteProviders, { each: true })
  enabledProviders!: string[];

  @IsString()
  @Length(3, 500)
  reason!: string;
}
