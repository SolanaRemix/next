import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const publicKeyPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class SolanaSwapOrderDto {
  @IsString()
  @Matches(publicKeyPattern)
  inputMint!: string;

  @IsString()
  @Matches(publicKeyPattern)
  outputMint!: string;

  @IsString()
  @Matches(/^[1-9]\d{0,19}$/)
  amount!: string;

  @IsString()
  @Matches(publicKeyPattern)
  taker!: string;

  @IsString()
  @Matches(uuidPattern)
  idempotencyKey!: string;
}

export class SolanaSwapExecuteDto {
  @IsString()
  @Matches(uuidPattern)
  executionId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,128}$/)
  requestId!: string;

  @IsString()
  @MinLength(4)
  @MaxLength(1644)
  @Matches(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  signedTransaction!: string;

  @IsString()
  @Matches(uuidPattern)
  idempotencyKey!: string;
}
