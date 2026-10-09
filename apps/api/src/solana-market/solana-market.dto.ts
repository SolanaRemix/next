import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SolanaMarketSearchDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9 ._-]+$/)
  query!: string;
}
