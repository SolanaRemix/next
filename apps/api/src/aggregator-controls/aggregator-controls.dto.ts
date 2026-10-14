import { Transform } from 'class-transformer';
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
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @Length(3, 500)
  reason!: string;
}
