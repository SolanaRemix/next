import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsString, Matches } from 'class-validator';

export class SolanaPortfolioPricesDto {
  @IsString()
  @IsIn(['mainnet-beta'])
  chainId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, { each: true })
  tokenMints!: string[];
}
