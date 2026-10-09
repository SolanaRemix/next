import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsString, Matches } from 'class-validator';

const supportedChainIds = ['0x1', '0xa', '0x38', '0x89', '0x2105', '0xa4b1', '0xa86a'];

export class EvmPortfolioPricesDto {
  @IsString()
  @IsIn(supportedChainIds)
  chainId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique((address: unknown) => typeof address === 'string' ? address.toLowerCase() : address)
  @IsString({ each: true })
  @Matches(/^0x[a-fA-F0-9]{40}$/, { each: true })
  tokenAddresses!: string[];
}
