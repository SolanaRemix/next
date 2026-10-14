import { IsString, Matches } from 'class-validator';

export class SolanaTokenScreeningDto {
  @IsString()
  @Matches(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  mint!: string;
}
