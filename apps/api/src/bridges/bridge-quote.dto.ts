import { IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';

export const solanaChainId = 1151111081099710;
export const bridgeQuoteChainIds = [1, 10, 56, 137, 8453, 42161, 43114, solanaChainId] as const;

const tokenOrWalletAddressPattern =
  /^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;

export class BridgeQuoteDto {
  @IsInt()
  @IsIn(bridgeQuoteChainIds)
  fromChainId!: number;

  @IsInt()
  @IsIn(bridgeQuoteChainIds)
  toChainId!: number;

  @IsString()
  @Matches(tokenOrWalletAddressPattern)
  fromToken!: string;

  @IsString()
  @Matches(tokenOrWalletAddressPattern)
  toToken!: string;

  @IsString()
  @Matches(/^[1-9]\d{0,77}$/)
  fromAmount!: string;

  @IsString()
  @Matches(tokenOrWalletAddressPattern)
  fromAddress!: string;

  @IsString()
  @Matches(tokenOrWalletAddressPattern)
  toAddress!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  slippageBps!: number;
}
