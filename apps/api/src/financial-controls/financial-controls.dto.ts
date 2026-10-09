import { IsBoolean, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateExecutionControlDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
