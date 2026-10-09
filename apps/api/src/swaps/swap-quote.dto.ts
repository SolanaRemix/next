import { IsIn, IsInt, IsNumber, IsString, Matches, Max, Min } from 'class-validator';

export class SwapQuoteDto {
  @IsInt()
  @IsIn([1, 10, 56, 137, 8453, 42161, 43114])
  chainId!: number;

  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  sellToken!: string;

  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/)
  buyToken!: string;

  @IsString()
  @Matches(/^[1-9]\d{0,77}$/)
  sellAmount!: string;

  @IsInt()
  @Min(0)
  @Max(36)
  sellDecimals!: number;

  @IsInt()
  @Min(0)
  @Max(36)
  buyDecimals!: number;

  @IsNumber({ allowInfinity: false, allowNaN: false })
  @IsInt()
  @Min(1)
  @Max(5000)
  maxSlippageBps!: number;
}
