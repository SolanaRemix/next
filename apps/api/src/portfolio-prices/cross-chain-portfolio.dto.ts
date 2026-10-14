import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class CrossChainPortfolioAccountDto {
  @IsString()
  @IsIn(['evm', 'solana'])
  chain!: 'evm' | 'solana';

  @IsString()
  @Matches(/^(?:0x(?:1|a|38|89|2105|a4b1|a86a)|mainnet-beta)$/i)
  chainId!: string;

  @IsString()
  @Matches(/^(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/)
  address!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique((address: unknown) => typeof address === 'string' ? address.toLowerCase() : address)
  @IsString({ each: true })
  @Matches(/^0x[a-fA-F0-9]{40}$/, { each: true })
  tokenAddresses!: string[];
}

export class CrossChainPortfolioDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ArrayUnique((account: unknown) => {
    if (typeof account !== 'object' || account === null) return account;
    const candidate = account as Record<string, unknown>;
    const address = typeof candidate.address === 'string' ? candidate.address.toLowerCase() : '';
    const chainId = typeof candidate.chainId === 'string' ? candidate.chainId.toLowerCase() : '';
    return `${String(candidate.chain)}:${chainId}:${address}`;
  })
  @ValidateNested({ each: true })
  @Type(() => CrossChainPortfolioAccountDto)
  accounts!: CrossChainPortfolioAccountDto[];
}
