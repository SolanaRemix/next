import { IsEthereumAddress, IsString, Matches } from 'class-validator';

export class EvmTokenScreeningDto {
  @IsString()
  @Matches(/^(?:1|10|56|137|8453|42161|43114|0x1|0xa|0x38|0x89|0x2105|0xa4b1|0xa86a)$/i)
  chainId!: string;

  @IsEthereumAddress()
  tokenAddress!: string;
}
