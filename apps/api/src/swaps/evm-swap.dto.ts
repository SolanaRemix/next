import {
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const supportedChainIds = [1, 10, 56, 137, 8453, 42161, 43114];
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EvmSwapOrderDto {
  @IsInt()
  @IsIn(supportedChainIds)
  chainId!: number;

  @IsString()
  @Matches(addressPattern)
  sellToken!: string;

  @IsString()
  @Matches(addressPattern)
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

  @IsString()
  @Matches(addressPattern)
  taker!: string;

  @IsString()
  @Matches(uuidPattern)
  idempotencyKey!: string;
}

export class EvmSwapExecuteDto {
  @IsString()
  @Matches(uuidPattern)
  executionId!: string;

  @IsString()
  @Matches(/^0x[a-fA-F0-9]{64}$/)
  transactionHash!: string;

  @IsString()
  @Matches(uuidPattern)
  idempotencyKey!: string;
}
