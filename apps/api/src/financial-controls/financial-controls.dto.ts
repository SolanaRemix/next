import { IsBoolean, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateExecutionControlDto {
  @IsBoolean()
  enabled!: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Matches(/\S/)
  reason!: string;
}
